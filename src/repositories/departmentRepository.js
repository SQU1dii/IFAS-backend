'use strict';
const { getKnex } = require('../config/database');
const T = 'departments';
const db = () => getKnex();

async function list(workspaceId) {
  return db()(T).where({ workspace_id: workspaceId }).orderBy('name');
}

async function findById(workspaceId, id) {
  return db()(T).where({ workspace_id: workspaceId, id }).first();
}

async function create(workspaceId, { name, budget = 0, head_name = '' }) {
  const [id] = await db()(T).insert({ workspace_id: workspaceId, name, budget, head_name });
  return findById(workspaceId, id);
}

async function update(workspaceId, id, patch) {
  await db()(T).where({ workspace_id: workspaceId, id }).update(patch);
  return findById(workspaceId, id);
}

async function remove(workspaceId, id) {
  return db()(T).where({ workspace_id: workspaceId, id }).del();
}

module.exports = { list, findById, create, update, remove };
