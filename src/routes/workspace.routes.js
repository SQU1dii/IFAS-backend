/**
 * Workspace routes  /api/v1/workspaces
 *
 * All routes under /:workspaceId run: authenticate → loadMembership → check
 *
 * GET    /workspaces                               list my workspaces
 * POST   /workspaces                               create workspace
 * GET    /workspaces/:workspaceId                  get workspace + my role + permissions
 * PATCH  /workspaces/:workspaceId                  update name / currency
 *
 * Members
 * GET    /workspaces/:workspaceId/members          list members
 * POST   /workspaces/:workspaceId/members          invite member
 * PATCH  /workspaces/:workspaceId/members/:memberId  change role
 * DELETE /workspaces/:workspaceId/members/:memberId  remove member
 *
 * Departments (ORGANIZATION only)
 * GET    /workspaces/:workspaceId/departments
 * POST   /workspaces/:workspaceId/departments
 * PATCH  /workspaces/:workspaceId/departments/:deptId
 * DELETE /workspaces/:workspaceId/departments/:deptId
 *
 * Roles catalogue  (read-only — useful for client dropdowns)
 * GET    /workspaces/:workspaceId/roles
 */
const express = require('express');
const authenticate = require('../middleware/authenticate');
const loadMembership = require('../middleware/loadMembership');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/workspace.controller');
const {
  createWorkspaceSchema, updateWorkspaceSchema,
  addMemberSchema, updateMemberSchema,
  createDepartmentSchema, updateDepartmentSchema,
} = require('../validators/workspace.validators');
const asyncHandler = require('../utils/asyncHandler');
const roleRepo = require('../repositories/roleRepository');

const router = express.Router();

// Shared middleware for all /:workspaceId/* routes.
const wsGuard = [authenticate, loadMembership];

// ── No workspace-id needed ──────────────────────────────────────────────────
router.get('/',  authenticate, ctrl.list);
router.post('/', authenticate, validate(createWorkspaceSchema), ctrl.create);

// ── Workspace detail ────────────────────────────────────────────────────────
router.get(  '/:workspaceId', ...wsGuard, requirePermission('dashboard.view'), ctrl.getOne);
router.patch('/:workspaceId', ...wsGuard, requirePermission('workspace.manage'), validate(updateWorkspaceSchema), ctrl.update);

// ── Roles catalogue ─────────────────────────────────────────────────────────
router.get('/:workspaceId/roles', ...wsGuard, requirePermission('dashboard.view'),
  asyncHandler(async (req, res) => {
    const roles = await roleRepo.listWorkspaceRoles();
    res.json({ roles });
  }),
);

// ── Members ─────────────────────────────────────────────────────────────────
router.get(   '/:workspaceId/members',            ...wsGuard, requirePermission('members.manage'), ctrl.listMembers);
router.post(  '/:workspaceId/members',            ...wsGuard, requirePermission('members.manage'), validate(addMemberSchema), ctrl.addMember);
router.patch( '/:workspaceId/members/:memberId',  ...wsGuard, requirePermission('members.manage'), validate(updateMemberSchema), ctrl.updateMember);
router.delete('/:workspaceId/members/:memberId',  ...wsGuard, requirePermission('members.manage'), ctrl.removeMember);

// ── Departments ─────────────────────────────────────────────────────────────
router.get(   '/:workspaceId/departments',          ...wsGuard, requirePermission('dashboard.view'),        ctrl.listDepts);
router.post(  '/:workspaceId/departments',          ...wsGuard, requirePermission('departments.manage'),    validate(createDepartmentSchema), ctrl.createDept);
router.patch( '/:workspaceId/departments/:deptId',  ...wsGuard, requirePermission('departments.manage'),    validate(updateDepartmentSchema), ctrl.updateDept);
router.delete('/:workspaceId/departments/:deptId',  ...wsGuard, requirePermission('departments.manage'),    ctrl.deleteDept);

module.exports = router;
