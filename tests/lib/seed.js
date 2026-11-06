/**
 * Test helpers: seed RBAC data into the in-memory store and reset between tests.
 */
const C = require('../../src/config/constants');

async function seedRbac(knex) {
  const store = knex._store;

  const permIds = {};
  for (const code of C.ALL_PERMISSION_CODES) {
    const [id] = await knex('permissions').insert({ code, description: code });
    permIds[code] = id;
  }

  const roleIds = {};
  for (const name of Object.values(C.ROLES)) {
    const [id] = await knex('roles').insert({
      name,
      scope: name === C.ROLES.PLATFORM_ADMIN ? 'PLATFORM' : 'WORKSPACE',
      description: name,
    });
    roleIds[name] = id;
  }

  const rpRows = [];
  for (const [roleName, codes] of Object.entries(C.ROLE_PERMISSIONS)) {
    for (const code of codes) rpRows.push({ role_id: roleIds[roleName], permission_id: permIds[code] });
  }
  if (rpRows.length) await knex('role_permissions').insert(rpRows);

  // Category templates
  const tmplRows = [];
  let order = 0;
  for (const [wsType, cats] of Object.entries(C.DEFAULT_CATEGORIES)) {
    for (const name of cats.income) tmplRows.push({ workspace_type: wsType, name, category_type: 'INCOME', sort_order: ++order });
    for (const name of cats.expense) tmplRows.push({ workspace_type: wsType, name, category_type: 'EXPENSE', sort_order: ++order });
  }
  await knex('category_templates').insert(tmplRows);

  return { permIds, roleIds };
}

function registerConstraints(knex) {
  const store = knex._store;
  store.constraints.length = 0;
  store.registerCompositeFK('transactions', ['workspace_id', 'account_id'], 'accounts', ['workspace_id', 'id']);
  store.registerCompositeFK('transactions', ['workspace_id', 'to_account_id'], 'accounts', ['workspace_id', 'id']);
  store.registerCompositeFK('transactions', ['workspace_id', 'category_id'], 'categories', ['workspace_id', 'id']);
  store.registerCompositeFK('transactions', ['workspace_id', 'department_id'], 'departments', ['workspace_id', 'id']);
  store.registerCompositeFK('budgets', ['workspace_id', 'category_id'], 'categories', ['workspace_id', 'id']);
  store.registerCompositeFK('budgets', ['workspace_id', 'department_id'], 'departments', ['workspace_id', 'id']);
  store.registerCompositeFK('forecasts', ['workspace_id', 'category_id'], 'categories', ['workspace_id', 'id']);
  store.registerCompositeFK('alerts', ['workspace_id', 'transaction_id'], 'transactions', ['workspace_id', 'id']);
}

module.exports = { seedRbac, registerConstraints };
