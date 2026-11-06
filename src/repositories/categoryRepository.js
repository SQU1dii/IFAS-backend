const { getKnex } = require('../config/database');

const T = 'categories';
function db() { return getKnex(); }

async function list(workspaceId, { type } = {}) {
  const q = db()(T).where({ workspace_id: workspaceId }).orderBy('name');
  if (type) q.where({ category_type: type });
  return q;
}

async function findById(workspaceId, id) {
  return db()(T).where({ workspace_id: workspaceId, id }).first();
}

async function findByName(workspaceId, name) {
  return db()(T).where({ workspace_id: workspaceId }).where('name', name).first();
}

async function create(workspaceId, { name, category_type }) {
  const [id] = await db()(T).insert({ workspace_id: workspaceId, name, category_type });
  return findById(workspaceId, id);
}

async function update(workspaceId, id, patch) {
  await db()(T).where({ workspace_id: workspaceId, id }).update(patch);
  return findById(workspaceId, id);
}

async function remove(workspaceId, id) {
  return db()(T).where({ workspace_id: workspaceId, id }).del();
}

/** Seed default categories from category_templates for a new workspace. */
async function seedDefaults(workspaceId, workspaceType, trx) {
  const db_ = trx || getKnex();
  const templates = await db_('category_templates').where({ workspace_type: workspaceType }).orderBy('sort_order');
  if (!templates.length) return [];
  const rows = templates.map((t) => ({ workspace_id: workspaceId, name: t.name, category_type: t.category_type }));
  await db_(T).insert(rows);
  return db_(T).where({ workspace_id: workspaceId });
}

module.exports = { list, findById, findByName, create, update, remove, seedDefaults };
