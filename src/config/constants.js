/**
 * Domain constants for IFAS. Everything that is an ENUM in the database or a
 * fixed list (permissions, roles) is defined here once and referenced by the
 * schema, the validators, the seed data and the business rules.
 */

// ── Workspace types ────────────────────────────────────────────────────────
const WORKSPACE_TYPES = ['PERSONAL', 'BUSINESS', 'ORGANIZATION'];

// ── Account types ───────────────────────────────────────────────────────────
const ACCOUNT_TYPES = ['BANK', 'MOBILE_MONEY', 'CASH'];

// ── Category types ───────────────────────────────────────────────────────────
const CATEGORY_TYPES = ['INCOME', 'EXPENSE'];

// ── Transaction types & status ──────────────────────────────────────────────
const TXN_TYPES = ['INCOME', 'EXPENSE', 'TRANSFER'];
const TXN_STATUSES = ['POSTED', 'VOID'];

// ── Alert enums ──────────────────────────────────────────────────────────────
const ALERT_TYPES = ['UNUSUAL_SPENDING', 'BUDGET_THRESHOLD', 'OVER_BUDGET'];
const ALERT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'];
const ALERT_STATUSES = ['OPEN', 'REVIEWED', 'DISMISSED'];

// ── Import statuses ─────────────────────────────────────────────────────────
const IMPORT_STATUSES = ['PREVIEW', 'CONFIRMED', 'CANCELLED'];

// ── Permission codes ─────────────────────────────────────────────────────────
const PERMISSIONS = {
  WORKSPACE_MANAGE: 'workspace.manage',
  MEMBERS_MANAGE: 'members.manage',
  DEPARTMENTS_MANAGE: 'departments.manage',
  ACCOUNTS_MANAGE: 'accounts.manage',
  TRANSACTIONS_VIEW: 'transactions.view',
  TRANSACTIONS_CREATE: 'transactions.create',
  TRANSACTIONS_EDIT: 'transactions.edit',
  TRANSACTIONS_IMPORT: 'transactions.import',
  BUDGETS_MANAGE: 'budgets.manage',
  GOALS_MANAGE: 'goals.manage',
  DASHBOARD_VIEW: 'dashboard.view',
  REPORTS_GENERATE: 'reports.generate',
  ANALYTICS_VIEW: 'analytics.view',
  ALERTS_REVIEW: 'alerts.review',
  ASSISTANT_USE: 'assistant.use',
  // Platform Administrator only — manages platform accounts & settings, NOT
  // any workspace's financial data.
  PLATFORM_ADMIN: 'platform.admin',
};

// All permission codes as a flat array (used by the permission middleware).
const ALL_PERMISSION_CODES = Object.values(PERMISSIONS);

// ── Roles ────────────────────────────────────────────────────────────────────
// scope: WORKSPACE roles belong to a workspace member; PLATFORM roles are
// assigned to a user account globally and grant no financial data access.
const ROLES = {
  // PERSONAL
  PERSONAL_OWNER: 'PERSONAL Owner',
  // BUSINESS
  BUSINESS_OWNER: 'BUSINESS Owner',
  BUSINESS_MANAGER: 'BUSINESS Manager',
  BUSINESS_STAFF: 'BUSINESS Staff',
  BUSINESS_VIEWER: 'BUSINESS Viewer',
  // ORGANIZATION
  ORG_ADMIN: 'ORGANIZATION Admin',
  ORG_DEPT_HEAD: 'ORGANIZATION Department Head',
  ORG_FINANCE_OFFICER: 'ORGANIZATION Finance Officer',
  ORG_MEMBER: 'ORGANIZATION Member',
  // PLATFORM
  PLATFORM_ADMIN: 'Platform Administrator',
};

/**
 * Role -> permission codes. The seed data writes this mapping into
 * role_permissions. PLATFORM_ADMIN intentionally has NO financial permissions.
 */
const ROLE_PERMISSIONS = {
  // PERSONAL — single owner with everything
  [ROLES.PERSONAL_OWNER]: [
    PERMISSIONS.WORKSPACE_MANAGE,
    PERMISSIONS.MEMBERS_MANAGE,
    PERMISSIONS.ACCOUNTS_MANAGE,
    PERMISSIONS.TRANSACTIONS_VIEW,
    PERMISSIONS.TRANSACTIONS_CREATE,
    PERMISSIONS.TRANSACTIONS_EDIT,
    PERMISSIONS.TRANSACTIONS_IMPORT,
    PERMISSIONS.BUDGETS_MANAGE,
    PERMISSIONS.GOALS_MANAGE,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.REPORTS_GENERATE,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ALERTS_REVIEW,
    PERMISSIONS.ASSISTANT_USE,
  ],

  // BUSINESS Owner — everything (no savings goals: PERSONAL-only)
  [ROLES.BUSINESS_OWNER]: [
    PERMISSIONS.WORKSPACE_MANAGE,
    PERMISSIONS.MEMBERS_MANAGE,
    PERMISSIONS.DEPARTMENTS_MANAGE,
    PERMISSIONS.ACCOUNTS_MANAGE,
    PERMISSIONS.TRANSACTIONS_VIEW,
    PERMISSIONS.TRANSACTIONS_CREATE,
    PERMISSIONS.TRANSACTIONS_EDIT,
    PERMISSIONS.TRANSACTIONS_IMPORT,
    PERMISSIONS.BUDGETS_MANAGE,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.REPORTS_GENERATE,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ALERTS_REVIEW,
    PERMISSIONS.ASSISTANT_USE,
  ],

  // BUSINESS Manager — most operational powers, no member/role management
  [ROLES.BUSINESS_MANAGER]: [
    PERMISSIONS.DEPARTMENTS_MANAGE,
    PERMISSIONS.ACCOUNTS_MANAGE,
    PERMISSIONS.TRANSACTIONS_VIEW,
    PERMISSIONS.TRANSACTIONS_CREATE,
    PERMISSIONS.TRANSACTIONS_EDIT,
    PERMISSIONS.TRANSACTIONS_IMPORT,
    PERMISSIONS.BUDGETS_MANAGE,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.REPORTS_GENERATE,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ALERTS_REVIEW,
    PERMISSIONS.ASSISTANT_USE,
  ],

  // BUSINESS Staff — record day-to-day activity
  [ROLES.BUSINESS_STAFF]: [
    PERMISSIONS.TRANSACTIONS_VIEW,
    PERMISSIONS.TRANSACTIONS_CREATE,
    PERMISSIONS.TRANSACTIONS_EDIT,
    PERMISSIONS.TRANSACTIONS_IMPORT,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ASSISTANT_USE,
  ],

  // BUSINESS Viewer — read only
  [ROLES.BUSINESS_VIEWER]: [
    PERMISSIONS.TRANSACTIONS_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.REPORTS_GENERATE,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ASSISTANT_USE,
  ],

  // ORGANIZATION Admin — like business owner but for orgs
  [ROLES.ORG_ADMIN]: [
    PERMISSIONS.WORKSPACE_MANAGE,
    PERMISSIONS.MEMBERS_MANAGE,
    PERMISSIONS.DEPARTMENTS_MANAGE,
    PERMISSIONS.ACCOUNTS_MANAGE,
    PERMISSIONS.TRANSACTIONS_VIEW,
    PERMISSIONS.TRANSACTIONS_CREATE,
    PERMISSIONS.TRANSACTIONS_EDIT,
    PERMISSIONS.TRANSACTIONS_IMPORT,
    PERMISSIONS.BUDGETS_MANAGE,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.REPORTS_GENERATE,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ALERTS_REVIEW,
    PERMISSIONS.ASSISTANT_USE,
  ],

  // ORGANIZATION Department Head — own department only (scoped in middleware)
  [ROLES.ORG_DEPT_HEAD]: [
    PERMISSIONS.TRANSACTIONS_VIEW,
    PERMISSIONS.TRANSACTIONS_CREATE,
    PERMISSIONS.TRANSACTIONS_EDIT,
    PERMISSIONS.TRANSACTIONS_IMPORT,
    PERMISSIONS.BUDGETS_MANAGE,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.REPORTS_GENERATE,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ALERTS_REVIEW,
    PERMISSIONS.ASSISTANT_USE,
  ],

  // ORGANIZATION Finance Officer — full financial management, no member mgmt
  [ROLES.ORG_FINANCE_OFFICER]: [
    PERMISSIONS.DEPARTMENTS_MANAGE,
    PERMISSIONS.ACCOUNTS_MANAGE,
    PERMISSIONS.TRANSACTIONS_VIEW,
    PERMISSIONS.TRANSACTIONS_CREATE,
    PERMISSIONS.TRANSACTIONS_EDIT,
    PERMISSIONS.TRANSACTIONS_IMPORT,
    PERMISSIONS.BUDGETS_MANAGE,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.REPORTS_GENERATE,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ALERTS_REVIEW,
    PERMISSIONS.ASSISTANT_USE,
  ],

  // ORGANIZATION Member/Viewer — read only
  [ROLES.ORG_MEMBER]: [
    PERMISSIONS.TRANSACTIONS_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.REPORTS_GENERATE,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ASSISTANT_USE,
  ],

  // Platform Administrator — manages platform accounts & settings ONLY.
  // Deliberately has zero financial-data permissions.
  [ROLES.PLATFORM_ADMIN]: [
    PERMISSIONS.PLATFORM_ADMIN,
  ],
};

/**
 * Which role each workspace type can assign to its members. Used by the
 * members service to validate role assignments.
 */
const ROLES_BY_WORKSPACE_TYPE = {
  PERSONAL: [ROLES.PERSONAL_OWNER],
  BUSINESS: [ROLES.BUSINESS_OWNER, ROLES.BUSINESS_MANAGER, ROLES.BUSINESS_STAFF, ROLES.BUSINESS_VIEWER],
  ORGANIZATION: [ROLES.ORG_ADMIN, ROLES.ORG_DEPT_HEAD, ROLES.ORG_FINANCE_OFFICER, ROLES.ORG_MEMBER],
};

/** The owning/admin roles per workspace type — the last one can't be removed/demoted. */
const OWNER_ROLES = {
  PERSONAL: [ROLES.PERSONAL_OWNER],
  BUSINESS: [ROLES.BUSINESS_OWNER],
  ORGANIZATION: [ROLES.ORG_ADMIN],
};

// ── Default categories per workspace type ────────────────────────────────────
// Mirrors the simulated training-data catalogues. New workspaces get these
// created automatically at workspace-creation time.
const DEFAULT_CATEGORIES = {
  PERSONAL: {
    income: ['Salary', 'Side Income'],
    expense: [
      'Rent', 'Groceries', 'Transport', 'Utilities', 'Airtime and Data',
      'Dining Out', 'Entertainment', 'Health', 'Education', 'Clothing',
      'Personal Care', 'Miscellaneous',
    ],
  },
  BUSINESS: {
    income: ['Sales', 'Other Income'],
    expense: [
      'Stock Purchases', 'Rent', 'Salaries', 'Utilities', 'Transport and Delivery',
      'Marketing', 'Repairs and Maintenance', 'Packaging and Supplies',
      'Bank and Mobile Charges', 'Licenses and Permits', 'Owner Drawings',
      'Miscellaneous',
    ],
  },
  ORGANIZATION: {
    income: ['Grants', 'Donations', 'Membership Fees', 'Fundraising'],
    expense: [
      'Training Materials', 'Facilitator Fees', 'Participant Support', 'Venue Hire',
      'Catering', 'Printing and Publicity', 'Transport', 'Salaries', 'Rent',
      'Utilities', 'Office Supplies', 'Equipment', 'Software and Subscriptions',
      'Bank Charges', 'Audit and Compliance', 'Miscellaneous',
    ],
  },
};

// Transfers are represented with a synthetic "Transfers" category used by the
// importer; it is created on demand when a transfer is imported/created.
const TRANSFER_CATEGORY_NAME = 'Transfers';

// ── Budget defaults ──────────────────────────────────────────────────────────
const DEFAULT_ALERT_THRESHOLD = 80; // percent

// ── Forecasting ──────────────────────────────────────────────────────────────
const MIN_FORECAST_MONTHS = 6;

module.exports = {
  WORKSPACE_TYPES,
  ACCOUNT_TYPES,
  CATEGORY_TYPES,
  TXN_TYPES,
  TXN_STATUSES,
  ALERT_TYPES,
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  IMPORT_STATUSES,
  PERMISSIONS,
  ALL_PERMISSION_CODES,
  ROLES,
  ROLE_PERMISSIONS,
  ROLES_BY_WORKSPACE_TYPE,
  OWNER_ROLES,
  DEFAULT_CATEGORIES,
  TRANSFER_CATEGORY_NAME,
  DEFAULT_ALERT_THRESHOLD,
  MIN_FORECAST_MONTHS,
};
