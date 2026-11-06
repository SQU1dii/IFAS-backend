-- =====================================================================
-- IFAS — Intelligent Financial Analytics System
-- MySQL 8 schema (InnoDB, utf8mb4, 3NF). Run against an empty database `ifas`.
--
-- Core principle: every financial record belongs to exactly one workspace.
-- Composite foreign keys such as (workspace_id, account_id) make it
-- structurally impossible for a transaction to reference another workspace's
-- accounts/categories/departments, even if the application layer had a bug.
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS ifas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ifas;

-- ── Users ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email            VARCHAR(255) NOT NULL,
  password_hash    VARCHAR(255) NOT NULL,
  full_name        VARCHAR(255) NOT NULL,
  phone            VARCHAR(40) NULL,
  is_platform_admin TINYINT(1) NOT NULL DEFAULT 0,
  is_active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Workspaces ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspaces (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name            VARCHAR(255) NOT NULL,
  workspace_type  ENUM('PERSONAL','BUSINESS','ORGANIZATION') NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'KES',
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_workspaces_created_by (created_by),
  CONSTRAINT fk_workspaces_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Roles & permissions (global RBAC) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name            VARCHAR(80) NOT NULL,
  scope           ENUM('WORKSPACE','PLATFORM') NOT NULL DEFAULT 'WORKSPACE',
  description     VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS permissions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code            VARCHAR(60) NOT NULL,
  description     VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_permissions_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id         BIGINT UNSIGNED NOT NULL,
  permission_id   BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  KEY idx_rp_permission (permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Departments (ORGANIZATION only) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id    BIGINT UNSIGNED NOT NULL,
  name            VARCHAR(120) NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_departments_ws_name (workspace_id, name),
  CONSTRAINT fk_departments_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Workspace members ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_members (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id    BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  role_id         BIGINT UNSIGNED NOT NULL,
  department_id   BIGINT UNSIGNED NULL,
  joined_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_members_ws_user (workspace_id, user_id),
  KEY idx_members_user (user_id),
  KEY idx_members_department (department_id),
  CONSTRAINT fk_members_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_members_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE RESTRICT,
  CONSTRAINT fk_members_department FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Accounts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id     BIGINT UNSIGNED NOT NULL,
  name             VARCHAR(120) NOT NULL,
  account_type     ENUM('BANK','MOBILE_MONEY','CASH') NOT NULL,
  opening_balance  DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_accounts_ws_name (workspace_id, name),
  -- candidate key for composite FK from transactions
  UNIQUE KEY uq_accounts_ws_id (workspace_id, id),
  KEY idx_accounts_ws (workspace_id),
  CONSTRAINT fk_accounts_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Categories ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id    BIGINT UNSIGNED NOT NULL,
  name            VARCHAR(120) NOT NULL,
  category_type   ENUM('INCOME','EXPENSE') NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_ws_name (workspace_id, name),
  UNIQUE KEY uq_categories_ws_id (workspace_id, id),
  KEY idx_categories_ws (workspace_id),
  CONSTRAINT fk_categories_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── CSV imports ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS csv_imports (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id    BIGINT UNSIGNED NOT NULL,
  created_by      BIGINT UNSIGNED NOT NULL,
  file_name       VARCHAR(255) NOT NULL,
  status          ENUM('PREVIEW','CONFIRMED','CANCELLED') NOT NULL DEFAULT 'PREVIEW',
  accepted_count  INT UNSIGNED NOT NULL DEFAULT 0,
  duplicate_count INT UNSIGNED NOT NULL DEFAULT 0,
  rejected_count  INT UNSIGNED NOT NULL DEFAULT 0,
  preview         JSON NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at    DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_imports_ws (workspace_id),
  KEY idx_imports_created_by (created_by),
  CONSTRAINT fk_imports_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  CONSTRAINT fk_imports_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Transactions ────────────────────────────────────────────────────────
-- Never deleted — only voided (status = VOID). Money is DECIMAL(14,2).
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
  KEY idx_txn_ws_date (workspace_id, txn_date),
  KEY idx_txn_ws_type (workspace_id, txn_type),
  KEY idx_txn_ws_status (workspace_id, status),
  KEY idx_txn_ws_account (workspace_id, account_id),
  KEY idx_txn_ws_category (workspace_id, category_id),
  KEY idx_txn_ws_department (workspace_id, department_id),
  KEY idx_txn_import (import_id),
  CONSTRAINT fk_txn_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  CONSTRAINT fk_txn_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_txn_voided_by FOREIGN KEY (voided_by) REFERENCES users (id) ON DELETE SET NULL,
  -- Composite FKs guarantee an account/category/department belongs to the SAME workspace.
  CONSTRAINT fk_txn_account FOREIGN KEY (workspace_id, account_id) REFERENCES accounts (workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_txn_to_account FOREIGN KEY (workspace_id, to_account_id) REFERENCES accounts (workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_txn_category FOREIGN KEY (workspace_id, category_id) REFERENCES categories (workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_txn_department FOREIGN KEY (workspace_id, department_id) REFERENCES departments (workspace_id, id) ON DELETE SET NULL,
  CONSTRAINT fk_txn_import FOREIGN KEY (import_id) REFERENCES csv_imports (id) ON DELETE SET NULL,
  CONSTRAINT chk_txn_amount_positive CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- candidate key so composite FK can reference departments(workspace_id, id)
ALTER TABLE departments ADD UNIQUE KEY uq_departments_ws_id (workspace_id, id);

-- ── Budgets ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budgets (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id     BIGINT UNSIGNED NOT NULL,
  category_id      BIGINT UNSIGNED NULL,
  department_id    BIGINT UNSIGNED NULL,
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  amount_limit     DECIMAL(14,2) NOT NULL,
  alert_threshold  TINYINT UNSIGNED NOT NULL DEFAULT 80,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_budgets_ws_period (workspace_id, period_start, period_end),
  KEY idx_budgets_ws_category (workspace_id, category_id),
  KEY idx_budgets_ws_department (workspace_id, department_id),
  CONSTRAINT fk_budgets_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  CONSTRAINT fk_budgets_category FOREIGN KEY (workspace_id, category_id) REFERENCES categories (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_budgets_department FOREIGN KEY (workspace_id, department_id) REFERENCES departments (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT chk_budgets_period CHECK (period_end >= period_start),
  CONSTRAINT chk_budgets_limit CHECK (amount_limit > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Savings goals (PERSONAL only — enforced in service layer) ────────────
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
  CONSTRAINT chk_goals_target CHECK (target_amount > 0),
  CONSTRAINT chk_goals_saved CHECK (saved_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Forecasts & values ──────────────────────────────────────────────────
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
  CONSTRAINT fk_forecasts_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  CONSTRAINT fk_forecasts_category FOREIGN KEY (workspace_id, category_id) REFERENCES categories (workspace_id, id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS forecast_values (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  forecast_id     BIGINT UNSIGNED NOT NULL,
  period          DATE NOT NULL,
  value           DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_fv_forecast (forecast_id),
  CONSTRAINT fk_fv_forecast FOREIGN KEY (forecast_id) REFERENCES forecasts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Alerts ──────────────────────────────────────────────────────────────
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
  KEY idx_alerts_ws_type (workspace_id, alert_type),
  CONSTRAINT fk_alerts_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  CONSTRAINT fk_alerts_transaction FOREIGN KEY (workspace_id, transaction_id) REFERENCES transactions (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_alerts_budget FOREIGN KEY (budget_id) REFERENCES budgets (id) ON DELETE SET NULL,
  CONSTRAINT fk_alerts_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Recommendations (generated from analytics) ───────────────────────────
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

-- ── Assistant conversations & messages ──────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id    BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  title           VARCHAR(255) NOT NULL DEFAULT 'New conversation',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_conv_ws (workspace_id),
  KEY idx_conv_user (user_id),
  CONSTRAINT fk_conv_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  CONSTRAINT fk_conv_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

-- ── Refresh tokens (hashed) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  token_hash      CHAR(64) NOT NULL,
  expires_at      DATETIME NOT NULL,
  revoked_at      DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_hash (token_hash),
  KEY idx_refresh_user (user_id),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Audit log ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id    BIGINT UNSIGNED NULL,
  user_id         BIGINT UNSIGNED NULL,
  action          VARCHAR(80) NOT NULL,
  entity_type     VARCHAR(60) NULL,
  entity_id       BIGINT UNSIGNED NULL,
  metadata        JSON NULL,
  ip_address      VARCHAR(45) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_ws (workspace_id),
  KEY idx_audit_user (user_id),
  KEY idx_audit_action (action),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_audit_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Default category templates ──────────────────────────────────────────
-- Helper table: when a workspace is created the service inserts categories
-- matching its type from this catalogue (mirrors the IFAS training data).
CREATE TABLE IF NOT EXISTS category_templates (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_type  ENUM('PERSONAL','BUSINESS','ORGANIZATION') NOT NULL,
  name            VARCHAR(120) NOT NULL,
  category_type   ENUM('INCOME','EXPENSE') NOT NULL,
  sort_order      INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cat_tmpl (workspace_type, name, category_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
-- end of schema.sql
