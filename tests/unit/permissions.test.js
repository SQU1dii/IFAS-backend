'use strict';
/**
 * Unit tests for the permission constants and the requirePermission middleware.
 */
const { ROLES, ROLE_PERMISSIONS, PERMISSIONS, ROLES_BY_WORKSPACE_TYPE, OWNER_ROLES } = require('../../src/config/constants');

// ── Role → permission mapping sanity checks ───────────────────────────────────
describe('Role-permission constants', () => {
  test('PERSONAL Owner has all required financial permissions', () => {
    const codes = new Set(ROLE_PERMISSIONS[ROLES.PERSONAL_OWNER]);
    expect(codes.has(PERMISSIONS.TRANSACTIONS_VIEW)).toBe(true);
    expect(codes.has(PERMISSIONS.TRANSACTIONS_CREATE)).toBe(true);
    expect(codes.has(PERMISSIONS.GOALS_MANAGE)).toBe(true);
    expect(codes.has(PERMISSIONS.WORKSPACE_MANAGE)).toBe(true);
  });

  test('PERSONAL Owner does NOT have departments.manage', () => {
    const codes = new Set(ROLE_PERMISSIONS[ROLES.PERSONAL_OWNER]);
    expect(codes.has(PERMISSIONS.DEPARTMENTS_MANAGE)).toBe(false);
  });

  test('Platform Admin has NO financial permissions', () => {
    const financialCodes = new Set([
      PERMISSIONS.TRANSACTIONS_VIEW, PERMISSIONS.TRANSACTIONS_CREATE,
      PERMISSIONS.ACCOUNTS_MANAGE,   PERMISSIONS.BUDGETS_MANAGE,
      PERMISSIONS.DASHBOARD_VIEW,    PERMISSIONS.REPORTS_GENERATE,
    ]);
    const platformAdminCodes = new Set(ROLE_PERMISSIONS[ROLES.PLATFORM_ADMIN]);
    for (const code of financialCodes) {
      expect(platformAdminCodes.has(code)).toBe(false);
    }
  });

  test('BUSINESS Viewer cannot create transactions', () => {
    const codes = new Set(ROLE_PERMISSIONS[ROLES.BUSINESS_VIEWER]);
    expect(codes.has(PERMISSIONS.TRANSACTIONS_CREATE)).toBe(false);
    expect(codes.has(PERMISSIONS.TRANSACTIONS_VIEW)).toBe(true);
  });

  test('BUSINESS Viewer cannot manage members', () => {
    const codes = new Set(ROLE_PERMISSIONS[ROLES.BUSINESS_VIEWER]);
    expect(codes.has(PERMISSIONS.MEMBERS_MANAGE)).toBe(false);
  });

  test('ORGANIZATION Department Head has budgets.manage', () => {
    const codes = new Set(ROLE_PERMISSIONS[ROLES.ORG_DEPT_HEAD]);
    expect(codes.has(PERMISSIONS.BUDGETS_MANAGE)).toBe(true);
  });

  test('ORGANIZATION Department Head does NOT have workspace.manage', () => {
    const codes = new Set(ROLE_PERMISSIONS[ROLES.ORG_DEPT_HEAD]);
    expect(codes.has(PERMISSIONS.WORKSPACE_MANAGE)).toBe(false);
  });
});

// ── ROLES_BY_WORKSPACE_TYPE ───────────────────────────────────────────────────
describe('ROLES_BY_WORKSPACE_TYPE', () => {
  test('PERSONAL workspace has PERSONAL Owner', () => {
    expect(ROLES_BY_WORKSPACE_TYPE.PERSONAL).toContain(ROLES.PERSONAL_OWNER);
  });

  test('PERSONAL workspace does not have BUSINESS roles', () => {
    expect(ROLES_BY_WORKSPACE_TYPE.PERSONAL).not.toContain(ROLES.BUSINESS_OWNER);
  });

  test('BUSINESS workspace has Staff and Viewer roles', () => {
    expect(ROLES_BY_WORKSPACE_TYPE.BUSINESS).toContain(ROLES.BUSINESS_STAFF);
    expect(ROLES_BY_WORKSPACE_TYPE.BUSINESS).toContain(ROLES.BUSINESS_VIEWER);
  });

  test('ORGANIZATION workspace has Dept Head role', () => {
    expect(ROLES_BY_WORKSPACE_TYPE.ORGANIZATION).toContain(ROLES.ORG_DEPT_HEAD);
  });
});

// ── requirePermission middleware ──────────────────────────────────────────────
describe('requirePermission middleware', () => {
  const requirePermission = require('../../src/middleware/requirePermission');

  function makeReq(permSet, isAdmin = false) {
    return {
      membership: permSet === null ? null : { permissions: new Set(Array.isArray(permSet) ? permSet : [permSet]) },
      user: { is_platform_admin: isAdmin },
    };
  }

  test('allows request when permission is present', () => {
    const req  = makeReq(['transactions.view']);
    const next = jest.fn();
    requirePermission('transactions.view')(req, {}, next);
    expect(next).toHaveBeenCalledWith(); // no error
  });

  test('blocks request when permission is absent', () => {
    const req  = makeReq(['transactions.view']);
    const next = jest.fn();
    requirePermission('transactions.create')(req, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  });

  test('blocks platform admin from financial routes', () => {
    const req  = makeReq(null, true); // no membership (platform admin)
    const next = jest.fn();
    requirePermission('transactions.view')(req, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  });
});

// ── budget calculation helpers ─────────────────────────────────────────────────
describe('Budget percentage calculation', () => {
  function pctUsed(spent, limit, threshold) {
    const pct = limit > 0 ? (spent / limit) * 100 : 0;
    return {
      percent_used: Math.round(pct * 100) / 100,
      is_threshold: pct >= threshold,
      is_over:      pct >= 100,
    };
  }

  test('under threshold', () => {
    const r = pctUsed(6000, 10000, 80);
    expect(r.percent_used).toBe(60);
    expect(r.is_threshold).toBe(false);
    expect(r.is_over).toBe(false);
  });

  test('at threshold boundary', () => {
    const r = pctUsed(8000, 10000, 80);
    expect(r.is_threshold).toBe(true);
    expect(r.is_over).toBe(false);
  });

  test('over budget', () => {
    const r = pctUsed(12000, 10000, 80);
    expect(r.is_over).toBe(true);
    expect(r.percent_used).toBe(120);
  });
});
