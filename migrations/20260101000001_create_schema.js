/**
 * IFAS schema — portable Knex schema builder.
 *
 * Runs unchanged on MySQL 8 (production) and on the in-memory SQLite used by
 * the test suite. The authoritative MySQL DDL lives in schema.sql; this
 * migration is what the application actually applies via `knex migrate:latest`.
 *
 * NOTE: schema.sql adds MySQL CHECK constraints (amount > 0, etc.) at the DB
 * level. This builder omits raw CHECKs for portability; the same rules are
 * enforced in the service/validator layer so behaviour is identical.
 */
const C = require('../src/config/constants');

exports.up = function (knex) {
  return knex.schema
    .createTable('users', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.string('email', 255).notNullable().unique();
      t.string('password_hash', 255).notNullable();
      t.string('full_name', 255).notNullable();
      t.string('phone', 40).nullable();
      t.boolean('is_platform_admin').notNullable().defaultTo(false);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
      t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
    })

    .createTable('workspaces', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.string('name', 255).notNullable();
      t.enu('workspace_type', C.WORKSPACE_TYPES).notNullable();
      t.string('currency', 3).notNullable().defaultTo('KES');
      t.bigInteger('created_by').unsigned().nullable();
      t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
      t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
      t.foreign('created_by').references('users.id').onDelete('SET NULL');
    })

    .createTable('roles', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.string('name', 80).notNullable().unique();
      t.enu('scope', ['WORKSPACE', 'PLATFORM']).notNullable().defaultTo('WORKSPACE');
      t.string('description', 255).nullable();
    })

    .createTable('permissions', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.string('code', 60).notNullable().unique();
      t.string('description', 255).nullable();
    })

    .createTable('role_permissions', (t) => {
      t.bigInteger('role_id').unsigned().notNullable().references('roles.id').onDelete('CASCADE');
      t.bigInteger('permission_id').unsigned().notNullable().references('permissions.id').onDelete('CASCADE');
      t.primary(['role_id', 'permission_id']);
    })

    .createTable('departments', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('workspace_id').unsigned().notNullable().references('workspaces.id').onDelete('CASCADE');
      t.string('name', 120).notNullable();
      t.decimal('budget', 14, 2).notNullable().defaultTo(0);
      t.string('head_name', 255).nullable();
      t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['workspace_id', 'name']);
      // candidate key for composite FK from transactions
      t.unique(['workspace_id', 'id']);
    })

    .createTable('workspace_members', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('workspace_id').unsigned().notNullable().references('workspaces.id').onDelete('CASCADE');
      t.bigInteger('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
      t.bigInteger('role_id').unsigned().notNullable().references('roles.id').onDelete('RESTRICT');
      t.bigInteger('department_id').unsigned().nullable().references('departments.id').onDelete('SET NULL');
      t.datetime('joined_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['workspace_id', 'user_id']);
    })

    .createTable('accounts', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('workspace_id').unsigned().notNullable().references('workspaces.id').onDelete('CASCADE');
      t.string('name', 120).notNullable();
      t.enu('account_type', C.ACCOUNT_TYPES).notNullable();
      t.decimal('opening_balance', 14, 2).notNullable().defaultTo(0);
      t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['workspace_id', 'name']);
      t.unique(['workspace_id', 'id']); // composite FK candidate key
    })

    .createTable('categories', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('workspace_id').unsigned().notNullable().references('workspaces.id').onDelete('CASCADE');
      t.string('name', 120).notNullable();
      t.enu('category_type', C.CATEGORY_TYPES).notNullable();
      t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['workspace_id', 'name']);
      t.unique(['workspace_id', 'id']); // composite FK candidate key
    })

    .createTable('csv_imports', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('workspace_id').unsigned().notNullable().references('workspaces.id').onDelete('CASCADE');
      t.bigInteger('created_by').unsigned().notNullable().references('users.id').onDelete('CASCADE');
      t.string('file_name', 255).notNullable();
      t.enu('status', C.IMPORT_STATUSES).notNullable().defaultTo('PREVIEW');
      t.integer('accepted_count').unsigned().notNullable().defaultTo(0);
      t.integer('duplicate_count').unsigned().notNullable().defaultTo(0);
      t.integer('rejected_count').unsigned().notNullable().defaultTo(0);
      t.json('preview').nullable();
      t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
      t.datetime('confirmed_at').nullable();
    })

    .createTable('transactions', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('workspace_id').unsigned().notNullable().references('workspaces.id').onDelete('CASCADE');
      t.bigInteger('account_id').unsigned().notNullable();
      t.bigInteger('to_account_id').unsigned().nullable();
      t.bigInteger('category_id').unsigned().nullable();
      t.bigInteger('department_id').unsigned().nullable();
      t.bigInteger('import_id').unsigned().nullable();
      t.bigInteger('created_by').unsigned().notNullable().references('users.id').onDelete('RESTRICT');
      t.enu('txn_type', C.TXN_TYPES).notNullable();
      t.decimal('amount', 14, 2).notNullable();
      t.date('txn_date').notNullable();
      t.string('description', 255).notNullable();
      t.enu('status', C.TXN_STATUSES).notNullable().defaultTo('POSTED');
      t.string('void_reason', 255).nullable();
      t.bigInteger('voided_by').unsigned().nullable().references('users.id').onDelete('SET NULL');
      t.datetime('voided_at').nullable();
      t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
      t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());

      t.unique(['workspace_id', 'id']); // composite FK candidate key
      // Composite foreign keys guarantee same-workspace references.
      t.foreign(['workspace_id', 'account_id']).references(['workspace_id', 'id']).inTable('accounts').onDelete('RESTRICT');
      t.foreign(['workspace_id', 'to_account_id']).references(['workspace_id', 'id']).inTable('accounts').onDelete('RESTRICT');
      t.foreign(['workspace_id', 'category_id']).references(['workspace_id', 'id']).inTable('categories').onDelete('RESTRICT');
      t.foreign(['workspace_id', 'department_id']).references(['workspace_id', 'id']).inTable('departments').onDelete('SET NULL');
      t.foreign('import_id').references('csv_imports.id').onDelete('SET NULL');

      t.index(['workspace_id', 'txn_date'], 'idx_txn_ws_date');
      t.index(['workspace_id', 'txn_type'], 'idx_txn_ws_type');
      t.index(['workspace_id', 'status'], 'idx_txn_ws_status');
    })

    .createTable('budgets', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('workspace_id').unsigned().notNullable().references('workspaces.id').onDelete('CASCADE');
      t.bigInteger('category_id').unsigned().nullable();
      t.bigInteger('department_id').unsigned().nullable();
      t.date('period_start').notNullable();
      t.date('period_end').notNullable();
      t.decimal('amount_limit', 14, 2).notNullable();
      t.tinyint('alert_threshold').unsigned().notNullable().defaultTo(80);
      t.string('notes', 500).nullable();
      t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
      t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
      t.foreign(['workspace_id', 'category_id']).references(['workspace_id', 'id']).inTable('categories').onDelete('CASCADE');
      t.foreign(['workspace_id', 'department_id']).references(['workspace_id', 'id']).inTable('departments').onDelete('CASCADE');
      t.index(['workspace_id', 'period_start', 'period_end'], 'idx_budgets_ws_period');
    })

    .createTable('savings_goals', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('workspace_id').unsigned().notNullable().references('workspaces.id').onDelete('CASCADE');
      t.string('name', 255).notNullable();
      t.decimal('target_amount', 14, 2).notNullable();
      t.decimal('saved_amount', 14, 2).notNullable().defaultTo(0);
      t.date('target_date').nullable();
      t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
      t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
    })

    .createTable('forecasts', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('workspace_id').unsigned().notNullable().references('workspaces.id').onDelete('CASCADE');
      t.bigInteger('category_id').unsigned().nullable();
      t.integer('horizon').unsigned().notNullable();
      t.decimal('mape', 8, 4).nullable();
      t.string('model', 80).nullable();
      t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
      t.foreign(['workspace_id', 'category_id']).references(['workspace_id', 'id']).inTable('categories').onDelete('SET NULL');
    })

    .createTable('forecast_values', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('forecast_id').unsigned().notNullable().references('forecasts.id').onDelete('CASCADE');
      t.date('period').notNullable();
      t.decimal('value', 14, 2).notNullable();
    })

    .createTable('alerts', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('workspace_id').unsigned().notNullable().references('workspaces.id').onDelete('CASCADE');
      t.enu('alert_type', C.ALERT_TYPES).notNullable();
      t.enu('severity', C.ALERT_SEVERITIES).notNullable().defaultTo('MEDIUM');
      t.string('reason', 500).notNullable();
      t.enu('status', C.ALERT_STATUSES).notNullable().defaultTo('OPEN');
      t.bigInteger('transaction_id').unsigned().nullable();
      t.bigInteger('budget_id').unsigned().nullable().references('budgets.id').onDelete('SET NULL');
      t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
      t.datetime('reviewed_at').nullable();
      t.bigInteger('reviewed_by').unsigned().nullable().references('users.id').onDelete('SET NULL');
      t.foreign(['workspace_id', 'transaction_id']).references(['workspace_id', 'id']).inTable('transactions').onDelete('CASCADE');
      t.index(['workspace_id', 'status'], 'idx_alerts_ws_status');
    })

    .createTable('recommendations', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('workspace_id').unsigned().notNullable().references('workspaces.id').onDelete('CASCADE');
      t.text('recommendation').notNullable();
      t.enu('source', ['analytics', 'assistant']).notNullable().defaultTo('analytics');
      t.datetime('dismissed_at').nullable();
      t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    })

    .createTable('conversations', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('workspace_id').unsigned().notNullable().references('workspaces.id').onDelete('CASCADE');
      t.bigInteger('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
      t.string('title', 255).notNullable().defaultTo('New conversation');
      t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
      t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
    })

    .createTable('messages', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('conversation_id').unsigned().notNullable().references('conversations.id').onDelete('CASCADE');
      t.enu('role', ['user', 'assistant']).notNullable();
      t.text('content').notNullable();
      t.json('context_snapshot').nullable();
      t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    })

    .createTable('refresh_tokens', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
      t.string('token_hash', 64).notNullable().unique();
      t.datetime('expires_at').notNullable();
      t.datetime('revoked_at').nullable();
      t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    })

    .createTable('audit_log', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('workspace_id').unsigned().nullable().references('workspaces.id').onDelete('CASCADE');
      t.bigInteger('user_id').unsigned().nullable().references('users.id').onDelete('SET NULL');
      t.string('action', 80).notNullable();
      t.string('entity_type', 60).nullable();
      t.bigInteger('entity_id').unsigned().nullable();
      t.json('metadata').nullable();
      t.string('ip_address', 45).nullable();
      t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
      t.index('workspace_id', 'idx_audit_ws');
      t.index('action', 'idx_audit_action');
    })

    .createTable('category_templates', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.enu('workspace_type', C.WORKSPACE_TYPES).notNullable();
      t.string('name', 120).notNullable();
      t.enu('category_type', C.CATEGORY_TYPES).notNullable();
      t.integer('sort_order').unsigned().notNullable().defaultTo(0);
      t.unique(['workspace_type', 'name', 'category_type']);
    })
    .createTable('savings_contributions', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('workspace_id').unsigned().notNullable().references('workspaces.id').onDelete('CASCADE');
      t.bigInteger('goal_id').unsigned().notNullable().references('savings_goals.id').onDelete('CASCADE');
      t.date('date').notNullable();
      t.decimal('amount', 14, 2).notNullable();
      t.enu('type', ['contribution', 'withdrawal']).notNullable().defaultTo('contribution');
      t.string('notes', 500).nullable();
      t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
      t.index(['workspace_id', 'goal_id'], 'idx_contrib_ws_goal');
    })
    .createTable('notifications', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
      t.bigInteger('workspace_id').unsigned().nullable().references('workspaces.id').onDelete('CASCADE');
      t.string('type', 60).notNullable();
      t.string('title', 255).notNullable();
      t.text('body').nullable();
      t.boolean('is_read').notNullable().defaultTo(false);
      t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
      t.index('user_id', 'idx_notif_user');
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('notifications')
    .dropTableIfExists('savings_contributions')
    .dropTableIfExists('category_templates')
    .dropTableIfExists('audit_log')
    .dropTableIfExists('refresh_tokens')
    .dropTableIfExists('messages')
    .dropTableIfExists('conversations')
    .dropTableIfExists('recommendations')
    .dropTableIfExists('alerts')
    .dropTableIfExists('forecast_values')
    .dropTableIfExists('forecasts')
    .dropTableIfExists('savings_goals')
    .dropTableIfExists('budgets')
    .dropTableIfExists('transactions')
    .dropTableIfExists('csv_imports')
    .dropTableIfExists('categories')
    .dropTableIfExists('accounts')
    .dropTableIfExists('workspace_members')
    .dropTableIfExists('departments')
    .dropTableIfExists('role_permissions')
    .dropTableIfExists('permissions')
    .dropTableIfExists('roles')
    .dropTableIfExists('workspaces')
    .dropTableIfExists('users');
};
