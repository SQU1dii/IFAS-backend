/**
 * Frontend-alignment additions.
 *
 * The Vue frontend expects a few extra columns/tables beyond the original
 * IFAS spec so its views work without recalculation:
 *  - departments.budget / departments.head_name (org dashboards show these)
 *  - budgets.notes
 *  - savings_contributions (deposit/withdrawal history per goal)
 *  - notifications (global bell dropdown)
 *
 * These are additive only — no existing columns are changed or removed.
 */
exports.up = function (knex) {
  return knex.schema
    .table('departments', (t) => {
      t.decimal('budget', 14, 2).notNullable().defaultTo(0);
      t.string('head_name', 255).nullable();
    })
    .table('budgets', (t) => {
      t.string('notes', 500).nullable();
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
    .table('budgets', (t) => t.dropColumn('notes'))
    .table('departments', (t) => { t.dropColumn('head_name'); t.dropColumn('budget'); });
};
