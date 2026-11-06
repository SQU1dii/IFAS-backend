const { getKnex } = require('../config/database');

const T = 'workspaces';
function db() { return getKnex(); }

async function findById(id) {
  return db()(T).where({ id }).first();
}

async function findAllForUser(userId) {
  return db()('workspace_members as wm')
    .join('workspaces as w', 'w.id', 'wm.workspace_id')
    .join('roles as r', 'r.id', 'wm.role_id')
    .where('wm.user_id', userId)
    .select(
      'w.id', 'w.name', 'w.workspace_type', 'w.currency',
      'w.created_by', 'w.created_at', 'w.updated_at',
      'r.name as role_name', 'wm.department_id',
    );
}

async function create({ name, workspace_type, currency = 'KES', created_by }) {
  const [id] = await db()(T).insert({ name, workspace_type, currency, created_by });
  return findById(id);
}

async function update(id, patch) {
  await db()(T).where({ id }).update(patch);
  return findById(id);
}

module.exports = { findById, findAllForUser, create, update };
