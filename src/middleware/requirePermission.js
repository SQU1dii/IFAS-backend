/**
 * requirePermission(code) — middleware factory.
 *
 * Must be used AFTER loadMembership. Checks that req.membership.permissions
 * contains the given permission code; throws 403 otherwise.
 *
 * Usage:
 *   router.get('/', requirePermission('transactions.view'), handler)
 *
 * Platform admins (req.membership === null) are blocked from all financial
 * permission codes — they only access platform-admin routes.
 */
const { forbidden } = require('../utils/errors');

function requirePermission(code) {
  return (req, res, next) => {
    if (!req.membership) {
      return next(forbidden('Platform administrators cannot access workspace financial data.', 'FORBIDDEN'));
    }
    if (!req.membership.permissions.has(code)) {
      return next(forbidden(`Your role does not grant the '${code}' permission.`, 'INSUFFICIENT_PERMISSION'));
    }
    next();
  };
}

/**
 * requirePlatformAdmin — only lets platform admins through.
 * Used for admin-only routes (user management, platform settings).
 */
function requirePlatformAdmin(req, res, next) {
  if (!req.user?.is_platform_admin) {
    return next(forbidden('Platform administrator access required.', 'FORBIDDEN'));
  }
  next();
}

module.exports = requirePermission;
module.exports.requirePlatformAdmin = requirePlatformAdmin;
