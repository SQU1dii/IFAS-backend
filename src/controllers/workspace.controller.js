const workspaceService = require('../services/workspace.service');
const asyncHandler = require('../utils/asyncHandler');

function ip(req) { return req.ip || null; }

// ── Workspaces ────────────────────────────────────────────────────────────────
const list = asyncHandler(async (req, res) => {
  const workspaces = await workspaceService.listWorkspaces(req.user.id);
  res.json({ workspaces });
});

const create = asyncHandler(async (req, res) => {
  const workspace = await workspaceService.createWorkspace(req.body, req.user.id, ip(req));
  res.status(201).json({ workspace });
});

const getOne = asyncHandler(async (req, res) => {
  // req.workspace and req.membership are already populated by loadMembership.
  // We just need to attach the permission codes.
  const { workspace, membership } = req;
  const permissions = membership ? Array.from(membership.permissions) : [];
  res.json({
    workspace: {
      ...workspace,
      role: membership?.role_name ?? null,
      permissions,
    },
  });
});

const update = asyncHandler(async (req, res) => {
  const workspace = await workspaceService.updateWorkspace(Number(req.params.workspaceId), req.body);
  res.json({ workspace });
});

// ── Members ───────────────────────────────────────────────────────────────────
const listMembers = asyncHandler(async (req, res) => {
  const members = await workspaceService.listMembers(Number(req.params.workspaceId));
  res.json({ members });
});

const addMember = asyncHandler(async (req, res) => {
  const members = await workspaceService.addMember({
    workspaceId:   Number(req.params.workspaceId),
    targetUserId:  req.body.user_id,
    roleName:      req.body.role_name,
    departmentId:  req.body.department_id ?? null,
  }, req.user.id, ip(req));
  res.status(201).json({ members });
});

const updateMember = asyncHandler(async (req, res) => {
  const members = await workspaceService.updateMember({
    workspaceId:  Number(req.params.workspaceId),
    memberId:     Number(req.params.memberId),
    roleName:     req.body.role_name,
    departmentId: req.body.department_id,
  }, req.user.id, ip(req));
  res.json({ members });
});

const removeMember = asyncHandler(async (req, res) => {
  await workspaceService.removeMember({
    workspaceId: Number(req.params.workspaceId),
    memberId:    Number(req.params.memberId),
  }, req.user.id, ip(req));
  res.json({ message: 'Member removed.' });
});

// ── Departments ───────────────────────────────────────────────────────────────
const listDepts = asyncHandler(async (req, res) => {
  const departments = await workspaceService.listDepartments(Number(req.params.workspaceId));
  res.json({ departments });
});

const createDept = asyncHandler(async (req, res) => {
  const dept = await workspaceService.createDepartment({
    workspaceId: Number(req.params.workspaceId),
    name:        req.body.name,
  }, req.user.id, ip(req));
  res.status(201).json({ department: dept });
});

const updateDept = asyncHandler(async (req, res) => {
  const dept = await workspaceService.updateDepartment({
    workspaceId: Number(req.params.workspaceId),
    deptId:      Number(req.params.deptId),
    name:        req.body.name,
  }, req.user.id, ip(req));
  res.json({ department: dept });
});

const deleteDept = asyncHandler(async (req, res) => {
  await workspaceService.deleteDepartment({
    workspaceId: Number(req.params.workspaceId),
    deptId:      Number(req.params.deptId),
  }, req.user.id, ip(req));
  res.json({ message: 'Department deleted.' });
});

module.exports = {
  list, create, getOne, update,
  listMembers, addMember, updateMember, removeMember,
  listDepts, createDept, updateDept, deleteDept,
};
