/**
 * loadMembership middleware.
 *
 * For every request to /workspaces/:workspaceId/... this:
 *   1. Verifies the workspace exists.
 *   2. Verifies the authenticated user is a member.
 *   3. Loads that member's role, permission codes, and (for Dept Heads) their
 *      department_id, then attaches them to req.membership.
 *
 * NEVER trusts workspace_id from the request body — it is always taken from
 * req.params.workspaceId which is set by the router.
 *
 * req.membership = {
 *   workspace_id, user_id, role_id, role_name, role_scope,
 *   department_id, permissions: Set<string>
 * }
 */
const workspaceRepo = require('../repositories/workspaceRepository');
const memberRepo = require('../repositories/memberRepository');
const { notFound, forbidden } = require('../utils/errors');

async function loadMembership(req, res, next) {
  try {
    const workspaceId = Number(req.params.workspaceId);
    if (!workspaceId) return next(notFound('Workspace not found.', 'WORKSPACE_NOT_FOUND'));

    // 1. Workspace must exist.
    const workspace = await workspaceRepo.findById(workspaceId);
    if (!workspace) return next(notFound('Workspace not found.', 'WORKSPACE_NOT_FOUND'));

    // 2. Platform admins can see settings but NOT financial data — they are
    //    not workspace members so we stop here for them. Routes that need
    //    platform-admin access use requirePlatformAdmin instead.
    if (req.user.is_platform_admin) {
      req.workspace = workspace;
      req.membership = null; // no membership
      return next();
    }

    // 3. Load membership.
    const membership = await memberRepo.findMembership(workspaceId, req.user.id);
    if (!membership) {
      return next(forbidden('You are not a member of this workspace.', 'NOT_A_MEMBER'));
    }

    // 4. Load permission codes.
    const codes = await memberRepo.findPermissionCodes(membership.role_id);
    const permissions = new Set(codes);

    req.workspace = workspace;
    req.membership = {
      workspace_id:  workspaceId,
      user_id:       req.user.id,
      role_id:       membership.role_id,
      role_name:     membership.role_name,
      role_scope:    membership.role_scope,
      department_id: membership.department_id ?? null,
      permissions,
    };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = loadMembership;
