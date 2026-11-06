const { getKnex } = require('../config/database');

function db() { return getKnex(); }

/**
 * Load a single membership with role name and permission codes.
 * This is the hot path called by loadMembership middleware on every request.
 */
async function findMembership(workspaceId, userId) {
  return db()('workspace_members as wm')
    .join('roles as r', 'r.id', 'wm.role_id')
    .where({ 'wm.workspace_id': workspaceId, 'wm.user_id': userId })
    .select('wm.*', 'r.name as role_name', 'r.scope as role_scope')
    .first();
}

/**
 * Load permission codes for a role id.
 */
async function findPermissionCodes(roleId) {
  const rows = await db()('role_permissions as rp')
    .join('permissions as p', 'p.id', 'rp.permission_id')
    .where('rp.role_id', roleId)
    .select('p.code');
  return rows.map((r) => r.code);
}

async function listMembers(workspaceId) {
  return db()('workspace_members as wm')
    .join('users as u',       'u.id',  'wm.user_id')
    .join('roles as r',       'r.id',  'wm.role_id')
    .leftJoin('departments as d', 'd.id', 'wm.department_id')
    .where('wm.workspace_id', workspaceId)
    .select(
      'wm.id', 'wm.workspace_id', 'wm.user_id', 'wm.joined_at',
      'u.email', 'u.full_name',
      'r.id as role_id', 'r.name as role_name',
      'd.id as department_id', 'd.name as department_name',
    );
}

async function addMember({ workspace_id, user_id, role_id, department_id = null }) {
  const [id] = await db()('workspace_members').insert({
    workspace_id, user_id, role_id, department_id,
  });
  return id;
}

async function updateMember(memberId, patch) {
  return db()('workspace_members').where({ id: memberId }).update(patch);
}

async function removeMember(memberId) {
  return db()('workspace_members').where({ id: memberId }).del();
}

async function countOwners(workspaceId, ownerRoleIds) {
  const rows = await db()('workspace_members')
    .where({ workspace_id: workspaceId })
    .whereIn('role_id', ownerRoleIds)
    .count('id as cnt');
  return Number(rows[0]?.cnt ?? 0);
}

async function findMemberById(memberId) {
  return db()('workspace_members as wm')
    .join('roles as r', 'r.id', 'wm.role_id')
    .where('wm.id', memberId)
    .select('wm.*', 'r.name as role_name')
    .first();
}

module.exports = {
  findMembership, findPermissionCodes, listMembers,
  addMember, updateMember, removeMember, countOwners, findMemberById,
};
