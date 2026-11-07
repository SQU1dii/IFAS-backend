'use strict';
const workspaceService = require('../services/workspace.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const { mapWorkspace, mapMember, mapDepartment } = require('../utils/mappers');

function ip(req) { return req.ip || null; }
function wsId(req) { return Number(req.params.workspaceId); }

// ── Workspaces ────────────────────────────────────────────────────────────────
const list = asyncHandler(async (req, res) => {
  const workspaces = await workspaceService.listWorkspaces(req.user.id);
  // Each row already has role_name + department_id from the join.
  const data = workspaces.map((w) => mapWorkspace(w, w.role_name, []));
  ok(res, data);
});

const create = asyncHandler(async (req, res) => {
  // Accept both `workspace_type` (API) and `type` (frontend).
  const body = {
    name: req.body.name,
    workspace_type: req.body.workspace_type || req.body.type,
    currency: req.body.currency || 'KES',
  };
  const ws = await workspaceService.createWorkspace(body, req.user.id, ip(req));
  // Return with the caller as owner + their permissions.
  const { ROLES, ROLE_PERMISSIONS } = require('../config/constants');
  const ownerRole = ROLES_BY_WS(ws.workspace_type);
  created(res, mapWorkspace(ws, ownerRole, ROLE_PERMISSIONS[ownerRole] || []), null, 'Workspace created.');
});

function ROLES_BY_WS(type) {
  if (type === 'PERSONAL') return require('../config/constants').ROLES.PERSONAL_OWNER;
  if (type === 'BUSINESS') return require('../config/constants').ROLES.BUSINESS_OWNER;
  return require('../config/constants').ROLES.ORG_ADMIN;
}

const getOne = asyncHandler(async (req, res) => {
  // req.workspace + req.membership already populated by loadMembership.
  const { workspace, membership } = req;
  const permissions = membership ? Array.from(membership.permissions) : [];
  ok(res, mapWorkspace(workspace, membership?.role_name, permissions));
});

const update = asyncHandler(async (req, res) => {
  const patch = {};
  if (req.body.name) patch.name = req.body.name;
  if (req.body.currency) patch.currency = req.body.currency;
  const ws = await workspaceService.updateWorkspace(wsId(req), patch);
  ok(res, mapWorkspace(ws, req.membership?.role_name, Array.from(req.membership?.permissions || [])));
});

// ── Members ───────────────────────────────────────────────────────────────────
const listMembers = asyncHandler(async (req, res) => {
  const members = await workspaceService.listMembers(wsId(req));
  ok(res, members.map(mapMember));
});

const addMember = asyncHandler(async (req, res) => {
  const members = await workspaceService.addMember({
    workspaceId:  wsId(req),
    targetUserId: req.body.user_id,
    email:        req.body.email,
    roleName:     req.body.role_name,
    simpleRole:   req.body.role,
    departmentId: req.body.department_id ?? null,
  }, req.user.id, ip(req));
  created(res, members.map(mapMember), null, 'Member added.');
});

const updateMember = asyncHandler(async (req, res) => {
  const members = await workspaceService.updateMember({
    workspaceId:  wsId(req),
    memberId:     Number(req.params.memberId),
    roleName:     req.body.role_name,
    simpleRole:   req.body.role,
    departmentId: req.body.department_id,
  }, req.user.id, ip(req));
  ok(res, members.map(mapMember));
});

const removeMember = asyncHandler(async (req, res) => {
  await workspaceService.removeMember({ workspaceId: wsId(req), memberId: Number(req.params.memberId) }, req.user.id, ip(req));
  ok(res, {}, null, 'Member removed.');
});

// ── Departments ───────────────────────────────────────────────────────────────
const listDepts = asyncHandler(async (req, res) => {
  const departments = await workspaceService.listDepartments(wsId(req));
  ok(res, departments.map(mapDepartment));
});

const createDept = asyncHandler(async (req, res) => {
  const dept = await workspaceService.createDepartment({
    workspaceId: wsId(req),
    name:        req.body.name,
    budget:      req.body.budget,
    head_name:   req.body.head_name,
  }, req.user.id, ip(req));
  created(res, mapDepartment(dept));
});

const updateDept = asyncHandler(async (req, res) => {
  const dept = await workspaceService.updateDepartment({
    workspaceId: wsId(req),
    deptId:      Number(req.params.deptId),
    name:        req.body.name,
    budget:      req.body.budget,
    head_name:   req.body.head_name,
  }, req.user.id, ip(req));
  ok(res, mapDepartment(dept));
});

const deleteDept = asyncHandler(async (req, res) => {
  await workspaceService.deleteDepartment({ workspaceId: wsId(req), deptId: Number(req.params.deptId) }, req.user.id, ip(req));
  ok(res, {}, null, 'Department deleted.');
});

module.exports = {
  list, create, getOne, update,
  listMembers, addMember, updateMember, removeMember,
  listDepts, createDept, updateDept, deleteDept,
};
