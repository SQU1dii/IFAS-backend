/**
 * IFAS database setup script.
 * Runs directly via mysql2 — no piping, no PowerShell issues.
 * Usage: node scripts/setup_db.js
 */
'use strict';
require('dotenv').config();
const mysql = require('mysql2/promise');

const ROOT_PW = process.env.MYSQL_ROOT_PASSWORD || 'Mark0798078372!';

async function run() {
  // Connect as root to do admin tasks first
  const root = await mysql.createConnection({
    host: '127.0.0.1', port: 3306, user: 'root', password: ROOT_PW,
    multipleStatements: true,
  });
  console.log('Connected as root.');

  // Create database + user
  await root.query(`
    CREATE DATABASE IF NOT EXISTS ifas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE USER IF NOT EXISTS 'ifas'@'localhost' IDENTIFIED BY 'ifas_password';
    GRANT ALL PRIVILEGES ON ifas.* TO 'ifas'@'localhost';
    FLUSH PRIVILEGES;
  `);
  console.log('Database and user OK.');
  await root.end();

  // Connect as ifas user
  const db = await mysql.createConnection({
    host: '127.0.0.1', port: 3306, user: 'ifas', password: 'ifas_password',
    database: 'ifas', multipleStatements: true,
  });
  console.log('Connected as ifas.');

  // ── Helpers ────────────────────────────────────────────────────────────────
  async function tableExists(name) {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
       WHERE TABLE_SCHEMA='ifas' AND TABLE_NAME=?`, [name],
    );
    return rows[0].cnt > 0;
  }
  async function columnExists(table, column) {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA='ifas' AND TABLE_NAME=? AND COLUMN_NAME=?`,
      [table, column],
    );
    return rows[0].cnt > 0;
  }
  async function indexExists(table, key) {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA='ifas' AND TABLE_NAME=? AND CONSTRAINT_NAME=?`,
      [table, key],
    );
    return rows[0].cnt > 0;
  }
  async function exec(sql, label) {
    try { await db.query(sql); console.log('  OK:', label); }
    catch (e) { console.warn('  SKIP:', label, '—', e.message.split('\n')[0]); }
  }

  // ── 1. departments: add budget + head_name ──────────────────────────────
  if (!await columnExists('departments', 'budget'))
    await exec('ALTER TABLE departments ADD COLUMN budget DECIMAL(14,2) NOT NULL DEFAULT 0', 'departments.budget');
  if (!await columnExists('departments', 'head_name'))
    await exec('ALTER TABLE departments ADD COLUMN head_name VARCHAR(255) NULL', 'departments.head_name');

  // ── 2. Unique candidate keys for composite FKs ──────────────────────────
  if (!await indexExists('accounts', 'uq_accounts_ws_id'))
    await exec('ALTER TABLE accounts ADD UNIQUE KEY uq_accounts_ws_id (workspace_id, id)', 'accounts composite key');
  if (!await indexExists('categories', 'uq_categories_ws_id'))
    await exec('ALTER TABLE categories ADD UNIQUE KEY uq_categories_ws_id (workspace_id, id)', 'categories composite key');
  if (!await indexExists('departments', 'uq_departments_ws_id'))
    await exec('ALTER TABLE departments ADD UNIQUE KEY uq_departments_ws_id (workspace_id, id)', 'departments composite key');

  // ── 3. Create missing tables ─────────────────────────────────────────────
  const tables = {
    transactions: `
      CREATE TABLE transactions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        workspace_id BIGINT UNSIGNED NOT NULL,
        account_id BIGINT UNSIGNED NOT NULL,
        to_account_id BIGINT UNSIGNED NULL,
        category_id BIGINT UNSIGNED NULL,
        department_id BIGINT UNSIGNED NULL,
        import_id BIGINT UNSIGNED NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        txn_type ENUM('INCOME','EXPENSE','TRANSFER') NOT NULL,
        amount DECIMAL(14,2) NOT NULL,
        txn_date DATE NOT NULL,
        description VARCHAR(255) NOT NULL,
        status ENUM('POSTED','VOID') NOT NULL DEFAULT 'POSTED',
        void_reason VARCHAR(255) NULL,
        voided_by BIGINT UNSIGNED NULL,
        voided_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_transactions_ws_id (workspace_id, id),
        KEY idx_txn_ws_date (workspace_id, txn_date),
        KEY idx_txn_ws_type (workspace_id, txn_type),
        KEY idx_txn_ws_status (workspace_id, status),
        KEY idx_txn_import (import_id),
        CONSTRAINT fk_txn_workspace  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        CONSTRAINT fk_txn_created_by FOREIGN KEY (created_by)  REFERENCES users(id)      ON DELETE RESTRICT,
        CONSTRAINT fk_txn_voided_by  FOREIGN KEY (voided_by)   REFERENCES users(id)      ON DELETE SET NULL,
        CONSTRAINT fk_txn_account    FOREIGN KEY (workspace_id, account_id)    REFERENCES accounts(workspace_id,id)   ON DELETE RESTRICT,
        CONSTRAINT fk_txn_to_account FOREIGN KEY (workspace_id, to_account_id) REFERENCES accounts(workspace_id,id)   ON DELETE RESTRICT,
        CONSTRAINT fk_txn_category   FOREIGN KEY (workspace_id, category_id)   REFERENCES categories(workspace_id,id) ON DELETE RESTRICT,
        CONSTRAINT fk_txn_import_fk  FOREIGN KEY (import_id) REFERENCES csv_imports(id) ON DELETE SET NULL,
        CONSTRAINT chk_txn_amount_positive CHECK (amount > 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    budgets: `
      CREATE TABLE budgets (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        workspace_id BIGINT UNSIGNED NOT NULL,
        category_id BIGINT UNSIGNED NULL,
        department_id BIGINT UNSIGNED NULL,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        amount_limit DECIMAL(14,2) NOT NULL,
        alert_threshold TINYINT UNSIGNED NOT NULL DEFAULT 80,
        notes VARCHAR(500) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_budgets_ws_period (workspace_id, period_start, period_end),
        CONSTRAINT fk_budgets_workspace  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)  ON DELETE CASCADE,
        CONSTRAINT fk_budgets_category   FOREIGN KEY (workspace_id, category_id)   REFERENCES categories(workspace_id,id)  ON DELETE CASCADE,
        CONSTRAINT fk_budgets_department FOREIGN KEY (workspace_id, department_id) REFERENCES departments(workspace_id,id) ON DELETE CASCADE,
        CONSTRAINT chk_budgets_period CHECK (period_end >= period_start),
        CONSTRAINT chk_budgets_limit  CHECK (amount_limit > 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    savings_goals: `
      CREATE TABLE savings_goals (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        workspace_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(255) NOT NULL,
        target_amount DECIMAL(14,2) NOT NULL,
        saved_amount  DECIMAL(14,2) NOT NULL DEFAULT 0.00,
        target_date DATE NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_goals_ws (workspace_id),
        CONSTRAINT fk_goals_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    savings_contributions: `
      CREATE TABLE savings_contributions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        workspace_id BIGINT UNSIGNED NOT NULL,
        goal_id BIGINT UNSIGNED NOT NULL,
        date DATE NOT NULL,
        amount DECIMAL(14,2) NOT NULL,
        type ENUM('contribution','withdrawal') NOT NULL DEFAULT 'contribution',
        notes VARCHAR(500) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_contrib_ws_goal (workspace_id, goal_id),
        CONSTRAINT fk_contrib_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id)    ON DELETE CASCADE,
        CONSTRAINT fk_contrib_goal      FOREIGN KEY (goal_id)      REFERENCES savings_goals(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    forecasts: `
      CREATE TABLE forecasts (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        workspace_id BIGINT UNSIGNED NOT NULL,
        category_id BIGINT UNSIGNED NULL,
        horizon INT UNSIGNED NOT NULL,
        mape DECIMAL(8,4) NULL,
        model VARCHAR(80) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_forecasts_ws (workspace_id),
        CONSTRAINT fk_forecasts_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    forecast_values: `
      CREATE TABLE forecast_values (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        forecast_id BIGINT UNSIGNED NOT NULL,
        period DATE NOT NULL,
        value DECIMAL(14,2) NOT NULL,
        PRIMARY KEY (id),
        KEY idx_fv_forecast (forecast_id),
        CONSTRAINT fk_fv_forecast FOREIGN KEY (forecast_id) REFERENCES forecasts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    alerts: `
      CREATE TABLE alerts (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        workspace_id BIGINT UNSIGNED NOT NULL,
        alert_type ENUM('UNUSUAL_SPENDING','BUDGET_THRESHOLD','OVER_BUDGET') NOT NULL,
        severity ENUM('LOW','MEDIUM','HIGH') NOT NULL DEFAULT 'MEDIUM',
        reason VARCHAR(500) NOT NULL,
        status ENUM('OPEN','REVIEWED','DISMISSED') NOT NULL DEFAULT 'OPEN',
        transaction_id BIGINT UNSIGNED NULL,
        budget_id BIGINT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_at DATETIME NULL,
        reviewed_by BIGINT UNSIGNED NULL,
        PRIMARY KEY (id),
        KEY idx_alerts_ws_status (workspace_id, status),
        CONSTRAINT fk_alerts_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        CONSTRAINT fk_alerts_budget    FOREIGN KEY (budget_id)    REFERENCES budgets(id)    ON DELETE SET NULL,
        CONSTRAINT fk_alerts_reviewer  FOREIGN KEY (reviewed_by)  REFERENCES users(id)      ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    recommendations: `
      CREATE TABLE recommendations (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        workspace_id BIGINT UNSIGNED NOT NULL,
        recommendation TEXT NOT NULL,
        source ENUM('analytics','assistant') NOT NULL DEFAULT 'analytics',
        dismissed_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_recs_ws (workspace_id),
        CONSTRAINT fk_recs_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    conversations: `
      CREATE TABLE conversations (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        workspace_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        title VARCHAR(255) NOT NULL DEFAULT 'New conversation',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_conv_ws   (workspace_id),
        KEY idx_conv_user (user_id),
        CONSTRAINT fk_conv_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        CONSTRAINT fk_conv_user      FOREIGN KEY (user_id)      REFERENCES users(id)      ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    messages: `
      CREATE TABLE messages (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        conversation_id BIGINT UNSIGNED NOT NULL,
        role ENUM('user','assistant') NOT NULL,
        content TEXT NOT NULL,
        context_snapshot JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_msg_conv (conversation_id),
        CONSTRAINT fk_msg_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    refresh_tokens: `
      CREATE TABLE refresh_tokens (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        token_hash CHAR(64) NOT NULL,
        expires_at DATETIME NOT NULL,
        revoked_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_refresh_hash (token_hash),
        KEY idx_refresh_user (user_id),
        CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    audit_log: `
      CREATE TABLE audit_log (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        workspace_id BIGINT UNSIGNED NULL,
        user_id BIGINT UNSIGNED NULL,
        action VARCHAR(80) NOT NULL,
        entity_type VARCHAR(60) NULL,
        entity_id BIGINT UNSIGNED NULL,
        metadata JSON NULL,
        ip_address VARCHAR(45) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_audit_ws     (workspace_id),
        KEY idx_audit_user   (user_id),
        KEY idx_audit_action (action),
        CONSTRAINT fk_audit_user      FOREIGN KEY (user_id)      REFERENCES users(id)      ON DELETE SET NULL,
        CONSTRAINT fk_audit_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    category_templates: `
      CREATE TABLE category_templates (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        workspace_type ENUM('PERSONAL','BUSINESS','ORGANIZATION') NOT NULL,
        name VARCHAR(120) NOT NULL,
        category_type ENUM('INCOME','EXPENSE') NOT NULL,
        sort_order INT UNSIGNED NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        UNIQUE KEY uq_cat_tmpl (workspace_type, name, category_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    notifications: `
      CREATE TABLE notifications (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        workspace_id BIGINT UNSIGNED NULL,
        type VARCHAR(60) NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT NULL,
        is_read TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_notif_user (user_id),
        CONSTRAINT fk_notif_user FOREIGN KEY (user_id)      REFERENCES users(id)      ON DELETE CASCADE,
        CONSTRAINT fk_notif_ws   FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  };

  for (const [name, ddl] of Object.entries(tables)) {
    if (await tableExists(name)) {
      console.log('  SKIP: table', name, 'already exists');
    } else {
      await exec(ddl, `CREATE TABLE ${name}`);
    }
  }

  // ── 4. Seed RBAC + category templates ───────────────────────────────────
  const [cnt] = await db.query('SELECT COUNT(*) AS c FROM roles');
  if (cnt[0].c > 0) {
    console.log('  SKIP: roles already seeded');
  } else {
    console.log('Seeding RBAC...');
    // Use the Knex seed file directly
    const { seed } = require('../seeds/seed.js');
    const knex = require('knex')(require('../knexfile.js').development);
    await seed(knex);
    await knex.destroy();
    console.log('  RBAC seed done.');
  }

  await db.end();
  console.log('\nAll done — database is fully set up.');
  console.log('Next: npm run dev');
}

run().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
