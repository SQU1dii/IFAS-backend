-- =========================================================
-- IFAS — complete the database setup
-- Safe to re-run: uses IF NOT EXISTS / IF EXISTS guards
-- =========================================================
USE ifas;
SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

-- ── 1. Add missing columns to existing tables ──────────────────────────────

-- departments: budget + head_name (migration 2) — guarded via information_schema
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA='ifas' AND TABLE_NAME='departments' AND COLUMN_NAME='budget');
SET @s := IF(@x=0, 'ALTER TABLE departments ADD COLUMN budget DECIMAL(14,2) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA='ifas' AND TABLE_NAME='departments' AND COLUMN_NAME='head_name');
SET @s := IF(@x=0, 'ALTER TABLE departments ADD COLUMN head_name VARCHAR(255) NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- budgets.notes (migration 2)
-- budgets table doesn't exist yet, so skip the ALTER — the CREATE below includes it

-- ── 2. Add unique candidate keys needed for composite FKs ──────────────────

-- accounts (workspace_id, id) candidate key
SET @x := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
           WHERE TABLE_SCHEMA='ifas' AND TABLE_NAME='accounts'
           AND CONSTRAINT_NAME='uq_accounts_ws_id');
SET @s := IF(@x=0,
  'ALTER TABLE accounts ADD UNIQUE KEY uq_accounts_ws_id (workspace_id, id)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- categories (workspace_id, id) candidate key
SET @x := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
           WHERE TABLE_SCHEMA='ifas' AND TABLE_NAME='categories'
           AND CONSTRAINT_NAME='uq_categories_ws_id');
SET @s := IF(@x=0,
  'ALTER TABLE categories ADD UNIQUE KEY uq_categories_ws_id (workspace_id, id)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- departments (workspace_id, id) candidate key
SET @x := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
           WHERE TABLE_SCHEMA='ifas' AND TABLE_NAME='departments'
           AND CONSTRAINT_NAME='uq_departments_ws_id');
SET @s := IF(@x=0,
  'ALTER TABLE departments ADD UNIQUE KEY uq_departments_ws_id (workspace_id, id)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 3. Create missing tables ───────────────────────────────────────────────

-- transactions
CREATE TABLE IF NOT EXISTS transactions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id    BIGINT UNSIGNED NOT NULL,
  account_id      BIGINT UNSIGNED NOT NULL,
  to_account_id   BIGINT UNSIGNED NULL,
  category_id     BIGINT UNSIGNED NULL,
  department_id   BIGINT UNSIGNED NULL,
  import_id       BIGINT UNSIGNED NULL,
  created_by      BIGINT UNSIGNED NOT NULL,
  txn_type        ENUM('INCOME','EXPENSE','TRANSFER') NOT NULL,
  amount          DECIMAL(14,2) NOT NULL,
  txn_date        DATE NOT NULL,
  description     VARCHAR(255) NOT NULL,
  status          ENUM('POSTED','VOID') NOT NULL DEFAULT 'POSTED',
  void_reason     VARCHAR(255) NULL,
  voided_by       BIGINT UNSIGNED NULL,
  voided_at       DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_transactions_ws_id (workspace_id, id),
  KEY idx_txn_ws_date   (workspace_id, txn_date),
  KEY idx_txn_ws_type   (workspace_id, txn_type),
  KEY idx_txn_ws_status (workspace_id, status),
  KEY idx_txn_import    (import_id),
  CONSTRAINT fk_txn_workspace   FOREIGN KEY (workspace_id) REFERENCES workspaces  (id) ON DELETE CASCADE,
  CONSTRAINT fk_txn_created_by  FOREIGN KEY (created_by)   REFERENCES users       (id) ON DELETE RESTRICT,
  CONSTRAINT fk_txn_voided_by   FOREIGN KEY (voided_by)    REFERENCES users       (id) ON DELETE SET NULL,
  CONSTRAINT fk_txn_account     FOREIGN KEY (workspace_id, account_id)    REFERENCES accounts   (workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_txn_to_account  FOREIGN KEY (workspace_id, to_account_id) REFERENCES accounts   (workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_txn_category    FOREIGN KEY (workspace_id, category_id)   REFERENCES categories (workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_txn_import_fk   FOREIGN KEY (import_id) REFERENCES csv_imports (id) ON DELETE SET NULL,
  CONSTRAINT chk_txn_amount_positive CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- budgets
CREATE TABLE IF NOT EXISTS budgets (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id     BIGINT UNSIGNED NOT NULL,
  category_id      BIGINT UNSIGNED NULL,
  department_id    BIGINT UNSIGNED NULL,
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  amount_limit     DECIMAL(14,2) NOT NULL,
  alert_threshold  TINYINT UNSIGNED NOT NULL DEFAULT 80,
  notes            VARCHAR(500) NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_budgets_ws_period (workspace_id, period_start, period_end),
  CONSTRAINT fk_budgets_workspace   FOREIGN KEY (workspace_id) REFERENCES workspaces  (id) ON DELETE CASCADE,
  CONSTRAINT fk_budgets_category    FOREIGN KEY (workspace_id, category_id)   REFERENCES categories  (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_budgets_department  FOREIGN KEY (workspace_id, department_id) REFERENCES departments (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT chk_budgets_period CHECK (period_end >= period_start),
  CONSTRAINT chk_budgets_limit  CHECK (amount_limit > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- savings_goals
CREATE TABLE IF NOT EXISTS savings_goals (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id    BIGINT UNSIGNED NOT NULL,
  name            VARCHAR(255) NOT NULL,
  target_amount   DECIMAL(14,2) NOT NULL,
  saved_amount    DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  target_date     DATE NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_goals_ws (workspace_id),
  CONSTRAINT fk_goals_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  CONSTRAINT chk_goals_target  CHECK (target_amount > 0),
  CONSTRAINT chk_goals_saved   CHECK (saved_amount  >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- savings_contributions (frontend: POST /savings-goals/:id/contributions)
CREATE TABLE IF NOT EXISTS savings_contributions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id    BIGINT UNSIGNED NOT NULL,
  goal_id         BIGINT UNSIGNED NOT NULL,
  date            DATE NOT NULL,
  amount          DECIMAL(14,2) NOT NULL,
  type            ENUM('contribution','withdrawal') NOT NULL DEFAULT 'contribution',
  notes           VARCHAR(500) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_contrib_ws_goal (workspace_id, goal_id),
  CONSTRAINT fk_contrib_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces   (id) ON DELETE CASCADE,
  CONSTRAINT fk_contrib_goal      FOREIGN KEY (goal_id)      REFERENCES savings_goals (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- forecasts
CREATE TABLE IF NOT EXISTS forecasts (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id    BIGINT UNSIGNED NOT NULL,
  category_id     BIGINT UNSIGNED NULL,
  horizon         INT UNSIGNED NOT NULL,
  mape            DECIMAL(8,4) NULL,
  model           VARCHAR(80) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_forecasts_ws (workspace_id),
  CONSTRAINT fk_forecasts_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- forecast_values
CREATE TABLE IF NOT EXISTS forecast_values (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  forecast_id BIGINT UNSIGNED NOT NULL,
  period      DATE NOT NULL,
  value       DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_fv_forecast (forecast_id),
  CONSTRAINT fk_fv_forecast FOREIGN KEY (forecast_id) REFERENCES forecasts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- alerts
CREATE TABLE IF NOT EXISTS alerts (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id    BIGINT UNSIGNED NOT NULL,
  alert_type      ENUM('UNUSUAL_SPENDING','BUDGET_THRESHOLD','OVER_BUDGET') NOT NULL,
  severity        ENUM('LOW','MEDIUM','HIGH') NOT NULL DEFAULT 'MEDIUM',
  reason          VARCHAR(500) NOT NULL,
  status          ENUM('OPEN','REVIEWED','DISMISSED') NOT NULL DEFAULT 'OPEN',
  transaction_id  BIGINT UNSIGNED NULL,
  budget_id       BIGINT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at     DATETIME NULL,
  reviewed_by     BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_alerts_ws_status (workspace_id, status),
  KEY idx_alerts_ws_type   (workspace_id, alert_type),
  CONSTRAINT fk_alerts_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  CONSTRAINT fk_alerts_budget    FOREIGN KEY (budget_id)    REFERENCES budgets    (id) ON DELETE SET NULL,
  CONSTRAINT fk_alerts_reviewer  FOREIGN KEY (reviewed_by)  REFERENCES users      (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- recommendations
CREATE TABLE IF NOT EXISTS recommendations (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id    BIGINT UNSIGNED NOT NULL,
  recommendation  TEXT NOT NULL,
  source          ENUM('analytics','assistant') NOT NULL DEFAULT 'analytics',
  dismissed_at    DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_recs_ws (workspace_id),
  CONSTRAINT fk_recs_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- conversations
CREATE TABLE IF NOT EXISTS conversations (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id    BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  title           VARCHAR(255) NOT NULL DEFAULT 'New conversation',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_conv_ws   (workspace_id),
  KEY idx_conv_user (user_id),
  CONSTRAINT fk_conv_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  CONSTRAINT fk_conv_user      FOREIGN KEY (user_id)      REFERENCES users      (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- messages
CREATE TABLE IF NOT EXISTS messages (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  role            ENUM('user','assistant') NOT NULL,
  content         TEXT NOT NULL,
  context_snapshot JSON NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_msg_conv (conversation_id),
  CONSTRAINT fk_msg_conv FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- refresh_tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  token_hash  CHAR(64) NOT NULL,
  expires_at  DATETIME NOT NULL,
  revoked_at  DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_hash (token_hash),
  KEY idx_refresh_user (user_id),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- audit_log
CREATE TABLE IF NOT EXISTS audit_log (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NULL,
  user_id      BIGINT UNSIGNED NULL,
  action       VARCHAR(80) NOT NULL,
  entity_type  VARCHAR(60) NULL,
  entity_id    BIGINT UNSIGNED NULL,
  metadata     JSON NULL,
  ip_address   VARCHAR(45) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_ws     (workspace_id),
  KEY idx_audit_user   (user_id),
  KEY idx_audit_action (action),
  CONSTRAINT fk_audit_user      FOREIGN KEY (user_id)      REFERENCES users      (id) ON DELETE SET NULL,
  CONSTRAINT fk_audit_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- category_templates
CREATE TABLE IF NOT EXISTS category_templates (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_type ENUM('PERSONAL','BUSINESS','ORGANIZATION') NOT NULL,
  name           VARCHAR(120) NOT NULL,
  category_type  ENUM('INCOME','EXPENSE') NOT NULL,
  sort_order     INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cat_tmpl (workspace_type, name, category_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- notifications
CREATE TABLE IF NOT EXISTS notifications (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  workspace_id BIGINT UNSIGNED NULL,
  type         VARCHAR(60) NOT NULL,
  title        VARCHAR(255) NOT NULL,
  body         TEXT NULL,
  is_read      TINYINT(1) NOT NULL DEFAULT 0,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notif_user (user_id),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id)      REFERENCES users      (id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_ws   FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
-- end
