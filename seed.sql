-- =====================================================================
-- IFAS seed data: roles, permissions, role_permissions and the default
-- category templates per workspace type. Run after schema.sql.
-- =====================================================================

USE ifas;
SET FOREIGN_KEY_CHECKS = 0;

-- Clean seed tables (safe to re-run)
TRUNCATE TABLE role_permissions;
TRUNCATE TABLE permissions;
TRUNCATE TABLE roles;
TRUNCATE TABLE category_templates;
SET FOREIGN_KEY_CHECKS = 1;

-- ── Permissions ───────────────────────────────────────────────────────────
INSERT INTO permissions (code, description) VALUES
('workspace.manage',     'Create, update and configure a workspace'),
('members.manage',       'Invite, remove members and assign roles'),
('departments.manage',  'Create and manage departments'),
('accounts.manage',      'Create and manage accounts'),
('transactions.view',    'View transactions'),
('transactions.create',  'Create transactions'),
('transactions.edit',    'Edit and void transactions'),
('transactions.import',  'Import transactions from CSV'),
('budgets.manage',       'Create and manage budgets'),
('goals.manage',         'Create and manage savings goals'),
('dashboard.view',       'View the workspace dashboard'),
('reports.generate',     'Generate reports'),
('analytics.view',       'View analytics: forecast, unusual spending, recommendations'),
('alerts.review',        'Review and dismiss alerts'),
('assistant.use',        'Use the AI financial assistant'),
('platform.admin',       'Platform administration: manage user accounts & settings');

-- ── Roles ────────────────────────────────────────────────────────────────
INSERT INTO roles (name, scope, description) VALUES
('PERSONAL Owner',              'WORKSPACE', 'Owner of a personal workspace'),
('BUSINESS Owner',              'WORKSPACE', 'Owner of a business workspace'),
('BUSINESS Manager',            'WORKSPACE', 'Business manager'),
('BUSINESS Staff',              'WORKSPACE', 'Business staff member'),
('BUSINESS Viewer',             'WORKSPACE', 'Read-only business viewer'),
('ORGANIZATION Admin',         'WORKSPACE', 'Organization administrator'),
('ORGANIZATION Department Head','WORKSPACE', 'Head of an organization department (own dept only)'),
('ORGANIZATION Finance Officer','WORKSPACE', 'Organization finance officer'),
('ORGANIZATION Member',         'WORKSPACE', 'Organization member / viewer'),
('Platform Administrator',      'PLATFORM',  'Platform-level administrator (no financial data access)');

-- ── role_permissions mapping ────────────────────────────────────────────
-- PERSONAL Owner: full access incl. savings goals
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p WHERE r.name = 'PERSONAL Owner'
  AND p.code IN (
    'workspace.manage','members.manage','accounts.manage','transactions.view',
    'transactions.create','transactions.edit','transactions.import','budgets.manage',
    'goals.manage','dashboard.view','reports.generate','analytics.view',
    'alerts.review','assistant.use');

-- BUSINESS Owner: full access except savings goals (PERSONAL-only)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p WHERE r.name = 'BUSINESS Owner'
  AND p.code IN (
    'workspace.manage','members.manage','departments.manage','accounts.manage',
    'transactions.view','transactions.create','transactions.edit','transactions.import',
    'budgets.manage','dashboard.view','reports.generate','analytics.view',
    'alerts.review','assistant.use');

-- BUSINESS Manager: operations, no member/role management
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p WHERE r.name = 'BUSINESS Manager'
  AND p.code IN (
    'departments.manage','accounts.manage','transactions.view','transactions.create',
    'transactions.edit','transactions.import','budgets.manage','dashboard.view',
    'reports.generate','analytics.view','alerts.review','assistant.use');

-- BUSINESS Staff: record day-to-day activity
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p WHERE r.name = 'BUSINESS Staff'
  AND p.code IN (
    'transactions.view','transactions.create','transactions.edit','transactions.import',
    'dashboard.view','analytics.view','assistant.use');

-- BUSINESS Viewer: read only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p WHERE r.name = 'BUSINESS Viewer'
  AND p.code IN (
    'transactions.view','dashboard.view','reports.generate','analytics.view','assistant.use');

-- ORGANIZATION Admin: like business owner, for orgs
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p WHERE r.name = 'ORGANIZATION Admin'
  AND p.code IN (
    'workspace.manage','members.manage','departments.manage','accounts.manage',
    'transactions.view','transactions.create','transactions.edit','transactions.import',
    'budgets.manage','dashboard.view','reports.generate','analytics.view',
    'alerts.review','assistant.use');

-- ORGANIZATION Department Head: own department only (scoping enforced in middleware)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p WHERE r.name = 'ORGANIZATION Department Head'
  AND p.code IN (
    'transactions.view','transactions.create','transactions.edit','transactions.import',
    'budgets.manage','dashboard.view','reports.generate','analytics.view',
    'alerts.review','assistant.use');

-- ORGANIZATION Finance Officer: full financial mgmt, no member management
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p WHERE r.name = 'ORGANIZATION Finance Officer'
  AND p.code IN (
    'departments.manage','accounts.manage','transactions.view','transactions.create',
    'transactions.edit','transactions.import','budgets.manage','dashboard.view',
    'reports.generate','analytics.view','alerts.review','assistant.use');

-- ORGANIZATION Member / Viewer: read only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p WHERE r.name = 'ORGANIZATION Member'
  AND p.code IN (
    'transactions.view','dashboard.view','reports.generate','analytics.view','assistant.use');

-- Platform Administrator: only platform.admin (no financial data)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p WHERE r.name = 'Platform Administrator'
  AND p.code IN ('platform.admin');

-- ── Default category templates ───────────────────────────────────────────
-- PERSONAL
INSERT INTO category_templates (workspace_type, name, category_type, sort_order) VALUES
('PERSONAL','Salary','INCOME',1),
('PERSONAL','Side Income','INCOME',2),
('PERSONAL','Rent','EXPENSE',1),
('PERSONAL','Groceries','EXPENSE',2),
('PERSONAL','Transport','EXPENSE',3),
('PERSONAL','Utilities','EXPENSE',4),
('PERSONAL','Airtime and Data','EXPENSE',5),
('PERSONAL','Dining Out','EXPENSE',6),
('PERSONAL','Entertainment','EXPENSE',7),
('PERSONAL','Health','EXPENSE',8),
('PERSONAL','Education','EXPENSE',9),
('PERSONAL','Clothing','EXPENSE',10),
('PERSONAL','Personal Care','EXPENSE',11),
('PERSONAL','Miscellaneous','EXPENSE',12);

-- BUSINESS
INSERT INTO category_templates (workspace_type, name, category_type, sort_order) VALUES
('BUSINESS','Sales','INCOME',1),
('BUSINESS','Other Income','INCOME',2),
('BUSINESS','Stock Purchases','EXPENSE',1),
('BUSINESS','Rent','EXPENSE',2),
('BUSINESS','Salaries','EXPENSE',3),
('BUSINESS','Utilities','EXPENSE',4),
('BUSINESS','Transport and Delivery','EXPENSE',5),
('BUSINESS','Marketing','EXPENSE',6),
('BUSINESS','Repairs and Maintenance','EXPENSE',7),
('BUSINESS','Packaging and Supplies','EXPENSE',8),
('BUSINESS','Bank and Mobile Charges','EXPENSE',9),
('BUSINESS','Licenses and Permits','EXPENSE',10),
('BUSINESS','Owner Drawings','EXPENSE',11),
('BUSINESS','Miscellaneous','EXPENSE',12);

-- ORGANIZATION
INSERT INTO category_templates (workspace_type, name, category_type, sort_order) VALUES
('ORGANIZATION','Grants','INCOME',1),
('ORGANIZATION','Donations','INCOME',2),
('ORGANIZATION','Membership Fees','INCOME',3),
('ORGANIZATION','Fundraising','INCOME',4),
('ORGANIZATION','Training Materials','EXPENSE',1),
('ORGANIZATION','Facilitator Fees','EXPENSE',2),
('ORGANIZATION','Participant Support','EXPENSE',3),
('ORGANIZATION','Venue Hire','EXPENSE',4),
('ORGANIZATION','Catering','EXPENSE',5),
('ORGANIZATION','Printing and Publicity','EXPENSE',6),
('ORGANIZATION','Transport','EXPENSE',7),
('ORGANIZATION','Salaries','EXPENSE',8),
('ORGANIZATION','Rent','EXPENSE',9),
('ORGANIZATION','Utilities','EXPENSE',10),
('ORGANIZATION','Office Supplies','EXPENSE',11),
('ORGANIZATION','Equipment','EXPENSE',12),
('ORGANIZATION','Software and Subscriptions','EXPENSE',13),
('ORGANIZATION','Bank Charges','EXPENSE',14),
('ORGANIZATION','Audit and Compliance','EXPENSE',15),
('ORGANIZATION','Miscellaneous','EXPENSE',16);

-- end of seed.sql
