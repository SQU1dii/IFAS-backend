/**
 * Workspace service.
 *
 * Enforces:
 * - Category defaults are seeded on workspace creation.
 * - The last owner/admin of a workspace cannot be removed or demoted.
 * - Departments are only allowed on ORGANIZATION workspaces.
 * - Savings goals only allowed on PERSONAL workspaces (enforced here and in
 *   the budgets/goals service).
 * - Role assignments must be valid for the workspace type.
 */
const { getKnex } = require('../config/database');
const workspaceRepo  = require('../repositories/workspaceRepository');
const memberRepo     = require('../repositories/memberRepository');
const roleRepo       = require('../repositories/roleRepository');
const departmentRepo = require('../repositories/departmentRepository');
const categoryRepo   = require('../repositories/categoryRepository');
const userRepo       = require('../repositories/userRepository');
const audit          = require('../repositories/auditRepository');
const { notFound, conflict, forbidden, badRequest } = require('../utils/errors');
const { ROLES, ROLES_BY_WORKSPACE_TYPE, OWNER_ROLES, PERMISSIONS } = require('../config/constants');

function db() { return getKnex(); }

/**
 * Map a frontend simple role (owner/admin/manager/member/viewer) to the
 * correct workspace role NAME for the given workspace type.
 */
function _resolveRoleName(workspaceType, simpleRole) {
  const r = String(simpleRole || '').toLowerCase();
  const allowed = ROLES_BY_WORKSPACE_TYPE[workspaceType] || [];
  if (allowed.includes(simpleRole)) return simpleRole; // already a full role name
  if (workspaceType === 'PERSONAL') return ROLES.PERSONAL_OWNER;
  if (workspaceType === 'BUSINESS') {
    if (r === 'owner' || r === 'admin') return ROLES.BUSINESS_OWNER;
    if (r === 'manager') return ROLES.BUSINESS_MANAGER;
    if (r === 'viewer') return ROLES.BUSINESS_VIEWER;
    return ROLES.BUSINESS_STAFF; // member
  }
  if (workspaceType === 'ORGANIZATION') {
    if (r === 'owner' || r === 'admin') return ROLES.ORG_ADMIN;
    if (r === 'manager') return ROLES.ORG_FINANCE_OFFICER;
    if (r === 'viewer') return ROLES.ORG_MEMBER;
    return ROLES.ORG_MEMBER; // member
  }
  return allowed[0];
}

// ── Workspace CRUD ────────────────────────────────────────────────────────────

async function createWorkspace({ name, workspace_type, currency = 'KES' }, userId, ipAddress) {
  let workspace;
  // Use a transaction so the workspace + owner membership + default categories
  // are either all created or none.
  await db().transaction(async (trx) => {
    const [wsId] = await trx('workspaces').insert({ name, workspace_type, currency, created_by: userId });
    workspace = await trx('workspaces').where({ id: wsId }).first();

    // Assign the owner role for this workspace type.
    const ownerRoleName = OWNER_ROLES[workspace_type][0];
    const role = await trx('roles').where({ name: ownerRoleName }).first();
    if (!role) throw new Error(`Role '${ownerRoleName}' not found in seed data.`);

    await trx('workspace_members').insert({ workspace_id: wsId, user_id: userId, role_id: role.id });

    // Seed default categories.
    const templates = await trx('category_templates').where({ workspace_type }).orderBy('sort_order');
    if (templates.length) {
      await trx('categories').insert(templates.map((t) => ({
        workspace_id: wsId, name: t.name, category_type: t.category_type,
      })));
    }
  });

  await audit.log({ workspace_id: workspace.id, user_id: userId, action: 'workspace.create', entity_type: 'workspace', entity_id: workspace.id, ip_address: ipAddress });
  return workspace;
}

async function getWorkspaceWithRole(workspaceId, userId) {
  const workspace = await workspaceRepo.findById(workspaceId);
  if (!workspace) throw notFound('Workspace not found.', 'WORKSPACE_NOT_FOUND');

  const membership = await memberRepo.findMembership(workspaceId, userId);
  if (!membership) throw forbidden('Not a member of this workspace.', 'NOT_A_MEMBER');
  const permissions = await memberRepo.findPermissionCodes(membership.role_id);

  return { ...workspace, role: membership.role_name, permissions };
}

async function listWorkspaces(userId) {
  return workspaceRepo.findAllForUser(userId);
}

async function updateWorkspace(workspaceId, patch) {
  const ws = await workspaceRepo.findById(workspaceId);
  if (!ws) throw notFound('Workspace not found.', 'WORKSPACE_NOT_FOUND');
  return workspaceRepo.update(workspaceId, patch);
}

// ── Members ───────────────────────────────────────────────────────────────────

async function listMembers(workspaceId) {
  return memberRepo.listMembers(workspaceId);
}

async function addMember({ workspaceId, targetUserId, roleName, departmentId, email, simpleRole }, actorId, ipAddress) {
  const workspace = await workspaceRepo.findById(workspaceId);
  if (!workspace) throw notFound('Workspace not found.', 'WORKSPACE_NOT_FOUND');

  // Resolve the target user: by user_id (API) or by email (frontend invite).
  let user = null;
  if (targetUserId) {
    user = await userRepo.findById(targetUserId);
  } else if (email) {
    user = await userRepo.findByEmail(email);
  }
  if (!user) throw notFound('User not found. They must register first before being invited.', 'USER_NOT_FOUND');

  // Resolve the role name — accept either a full role name (API) or a simple
  // role string (frontend: owner/admin/manager/member/viewer).
  const resolvedRoleName = _resolveRoleName(workspace.workspace_type, roleName || simpleRole);
  const allowed = ROLES_BY_WORKSPACE_TYPE[workspace.workspace_type];
  if (!allowed.includes(resolvedRoleName)) {
    throw badRequest(`Role is not valid for ${workspace.workspace_type} workspaces.`, { role: `Must be one of: ${allowed.join(', ')}` }, 'INVALID_ROLE');
  }

  // Department required/forbidden based on role and type.
  if (workspace.workspace_type !== 'ORGANIZATION' && departmentId) {
    throw badRequest('Department is only valid for ORGANIZATION workspaces.', null, 'INVALID_DEPARTMENT');
  }
  if (resolvedRoleName === ROLES.ORG_DEPT_HEAD && !departmentId) {
    throw badRequest('Department Head must be assigned to a department.', { department_id: 'Required for Department Head' }, 'DEPT_HEAD_NEEDS_DEPT');
  }

  // Check not already a member.
  const existing = await memberRepo.findMembership(workspaceId, user.id);
  if (existing) throw conflict('User is already a member of this workspace.', null, 'ALREADY_MEMBER');

  const role = await roleRepo.findByName(resolvedRoleName);
  if (!role) throw badRequest('Role not found.', null, 'ROLE_NOT_FOUND');

  await memberRepo.addMember({ workspace_id: workspaceId, user_id: user.id, role_id: role.id, department_id: departmentId ?? null });
  await audit.log({ workspace_id: workspaceId, user_id: actorId, action: 'members.add', entity_type: 'user', entity_id: user.id, ip_address: ipAddress, metadata: { role_name: resolvedRoleName } });

  return memberRepo.listMembers(workspaceId);
}

async function updateMember({ workspaceId, memberId, roleName, simpleRole, departmentId }, actorId, ipAddress) {
  const workspace = await workspaceRepo.findById(workspaceId);
  if (!workspace) throw notFound('Workspace not found.', 'WORKSPACE_NOT_FOUND');

  const member = await memberRepo.findMemberById(memberId);
  if (!member || member.workspace_id !== workspaceId) throw notFound('Member not found.', 'MEMBER_NOT_FOUND');

  const patch = {};

  const roleInput = roleName || simpleRole;
  if (roleInput !== undefined) {
    const resolvedRoleName = _resolveRoleName(workspace.workspace_type, roleInput);
    const allowed = ROLES_BY_WORKSPACE_TYPE[workspace.workspace_type];
    if (!allowed.includes(resolvedRoleName)) {
      throw badRequest(`Role is not valid for this workspace.`, { role: `Must be one of: ${allowed.join(', ')}` }, 'INVALID_ROLE');
    }
    const role = await roleRepo.findByName(resolvedRoleName);
    if (!role) throw badRequest('Role not found.', null, 'ROLE_NOT_FOUND');

    // Guard: last owner/admin cannot be demoted.
    const ownerRoleNames = OWNER_ROLES[workspace.workspace_type];
    if (ownerRoleNames.includes(member.role_name) && !ownerRoleNames.includes(resolvedRoleName)) {
      const ownerRoles = await Promise.all(ownerRoleNames.map((n) => roleRepo.findByName(n)));
      const ownerRoleIds = ownerRoles.filter(Boolean).map((r) => r.id);
      const ownerCount = await memberRepo.countOwners(workspaceId, ownerRoleIds);
      if (ownerCount <= 1) {
        throw forbidden('The last owner/admin of a workspace cannot be demoted.', 'LAST_OWNER');
      }
    }
    patch.role_id = role.id;
  }

  if (departmentId !== undefined) {
    if (workspace.workspace_type !== 'ORGANIZATION' && departmentId) {
      throw badRequest('Department is only valid for ORGANIZATION workspaces.', null, 'INVALID_DEPARTMENT');
    }
    patch.department_id = departmentId ?? null;
  }

  if (!Object.keys(patch).length) throw badRequest('Nothing to update.', null, 'NOTHING_TO_UPDATE');

  await memberRepo.updateMember(memberId, patch);
  await audit.log({ workspace_id: workspaceId, user_id: actorId, action: 'members.update', entity_type: 'workspace_member', entity_id: memberId, ip_address: ipAddress, metadata: patch });

  return memberRepo.listMembers(workspaceId);
}

async function removeMember({ workspaceId, memberId }, actorId, ipAddress) {
  const workspace = await workspaceRepo.findById(workspaceId);
  if (!workspace) throw notFound('Workspace not found.', 'WORKSPACE_NOT_FOUND');

  const member = await memberRepo.findMemberById(memberId);
  if (!member || member.workspace_id !== workspaceId) throw notFound('Member not found.', 'MEMBER_NOT_FOUND');

  // Guard: last owner/admin.
  const ownerRoleNames = OWNER_ROLES[workspace.workspace_type];
  if (ownerRoleNames.includes(member.role_name)) {
    const ownerRoles = await Promise.all(ownerRoleNames.map((n) => roleRepo.findByName(n)));
    const ownerRoleIds = ownerRoles.filter(Boolean).map((r) => r.id);
    const ownerCount = await memberRepo.countOwners(workspaceId, ownerRoleIds);
    if (ownerCount <= 1) {
      throw forbidden('The last owner/admin of a workspace cannot be removed.', 'LAST_OWNER');
    }
  }

  await memberRepo.removeMember(memberId);
  await audit.log({ workspace_id: workspaceId, user_id: actorId, action: 'members.remove', entity_type: 'workspace_member', entity_id: memberId, ip_address: ipAddress });
}

// ── Departments (ORGANIZATION only) ───────────────────────────────────────────

function assertOrganization(workspace) {
  if (workspace.workspace_type !== 'ORGANIZATION') {
    throw badRequest('Departments are only available for ORGANIZATION workspaces.', null, 'NOT_ORGANIZATION');
  }
}

async function listDepartments(workspaceId) {
  const departments = await departmentRepo.list(workspaceId);
  // Enrich each with spent (sum of POSTED EXPENSE transactions for that dept).
  const txnRepo = require('../repositories/transactionRepository');
  for (const d of departments) {
    d.spent = await txnRepo.sumExpenses(workspaceId, { departmentId: d.id });
  }
  return departments;
}

async function createDepartment({ workspaceId, name, budget = 0, head_name = '' }, actorId, ipAddress) {
  const workspace = await workspaceRepo.findById(workspaceId);
  assertOrganization(workspace);
  const existing = await departmentRepo.list(workspaceId);
  if (existing.find((d) => d.name.toLowerCase() === name.toLowerCase())) {
    throw conflict(`A department named '${name}' already exists.`, { name: 'Already exists' }, 'DEPT_DUPLICATE');
  }
  const dept = await departmentRepo.create(workspaceId, { name, budget: Number(budget) || 0, head_name: head_name || '' });
  await audit.log({ workspace_id: workspaceId, user_id: actorId, action: 'departments.create', entity_type: 'department', entity_id: dept.id, ip_address: ipAddress });
  return dept;
}

async function updateDepartment({ workspaceId, deptId, name, budget, head_name }, actorId, ipAddress) {
  const workspace = await workspaceRepo.findById(workspaceId);
  assertOrganization(workspace);
  const dept = await departmentRepo.findById(workspaceId, deptId);
  if (!dept) throw notFound('Department not found.', 'DEPT_NOT_FOUND');
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (budget !== undefined) patch.budget = Number(budget);
  if (head_name !== undefined) patch.head_name = head_name;
  const updated = await departmentRepo.update(workspaceId, deptId, patch);
  await audit.log({ workspace_id: workspaceId, user_id: actorId, action: 'departments.update', entity_type: 'department', entity_id: deptId, ip_address: ipAddress });
  return updated;
}

async function deleteDepartment({ workspaceId, deptId }, actorId, ipAddress) {
  const workspace = await workspaceRepo.findById(workspaceId);
  assertOrganization(workspace);
  const dept = await departmentRepo.findById(workspaceId, deptId);
  if (!dept) throw notFound('Department not found.', 'DEPT_NOT_FOUND');
  await departmentRepo.remove(workspaceId, deptId);
  await audit.log({ workspace_id: workspaceId, user_id: actorId, action: 'departments.delete', entity_type: 'department', entity_id: deptId, ip_address: ipAddress });
}

module.exports = {
  createWorkspace, getWorkspaceWithRole, listWorkspaces, updateWorkspace,
  listMembers, addMember, updateMember, removeMember,
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
};
