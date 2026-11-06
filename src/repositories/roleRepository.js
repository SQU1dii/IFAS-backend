const { getKnex } = require('../config/database');

function db() { return getKnex(); }

async function findByName(name) {
  return db()('roles').where({ name }).first();
}

async function findById(id) {
  return db()('roles').where({ id }).first();
}

async function listWorkspaceRoles() {
  return db()('roles').where({ scope: 'WORKSPACE' }).orderBy('name');
}

async function getPermissionsForRole(roleId) {
  const rows = await db()('role_permissions as rp')
    .join('permissions as p', 'p.id', 'rp.permission_id')
    .where('rp.role_id', roleId)
    .select('p.code');
  return rows.map((r) => r.code);
}

module.exports = { findByName, findById, listWorkspaceRoles, getPermissionsForRole };
