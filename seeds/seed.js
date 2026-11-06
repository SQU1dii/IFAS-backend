/**
 * IFAS seed data (Knex). Mirrors seed.sql: inserts roles, permissions,
 * role_permissions and the default category templates. Idempotent.
 */
const C = require('../src/config/constants');

exports.seed = async function (knex) {
  // Order matters: clear children first.
  await knex('role_permissions').del();
  await knex('permissions').del();
  await knex('roles').del();
  await knex('category_templates').del();

  // Permissions
  const permissionRows = C.ALL_PERMISSION_CODES.map((code) => ({
    code,
    description: code,
  }));
  const permissionIds = await knex('permissions').insert(permissionRows, ['id', 'code']);
  const permByCode = Object.fromEntries(permissionIds.map((p) => [p.code, p.id]));

  // Roles
  const roleNames = Object.values(C.ROLES);
  const roleRows = roleNames.map((name) => ({
    name,
    scope: name === C.ROLES.PLATFORM_ADMIN ? 'PLATFORM' : 'WORKSPACE',
    description: name,
  }));
  const roleIds = await knex('roles').insert(roleRows, ['id', 'name']);
  const roleByName = Object.fromEntries(roleIds.map((r) => [r.name, r.id]));

  // role_permissions mapping
  const rpRows = [];
  for (const [roleName, codes] of Object.entries(C.ROLE_PERMISSIONS)) {
    const roleId = roleByName[roleName];
    for (const code of codes) {
      rpRows.push({ role_id: roleId, permission_id: permByCode[code] });
    }
  }
  if (rpRows.length) await knex('role_permissions').insert(rpRows);

  // Category templates
  const tmplRows = [];
  let order = 0;
  for (const [wsType, cats] of Object.entries(C.DEFAULT_CATEGORIES)) {
    for (const name of cats.income) {
      tmplRows.push({ workspace_type: wsType, name, category_type: 'INCOME', sort_order: ++order });
    }
    for (const name of cats.expense) {
      tmplRows.push({ workspace_type: wsType, name, category_type: 'EXPENSE', sort_order: ++order });
    }
  }
  await knex('category_templates').insert(tmplRows);
};
