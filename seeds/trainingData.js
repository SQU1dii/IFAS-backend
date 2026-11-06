'use strict';
/**
 * Training-data seeder.
 *
 * Seeds three demo workspaces (PERSONAL, BUSINESS, ORGANIZATION) using the
 * IFAS simulated training data in IFAS_training_data/. This creates a rich
 * environment for:
 *   - testing the forecasting endpoint
 *   - exercising the unusual-spending detector
 *   - demonstrating the AI assistant
 *   - running the assistant_eval_questions.csv evaluation
 *
 * This seed is SEPARATE from the RBAC seed and is only run explicitly:
 *   NODE_ENV=development node seeds/trainingData.js
 *
 * It is NOT run automatically by `npm run db:setup` so production is unaffected.
 *
 * Prerequisites: schema migrated, RBAC seed applied, a demo user exists.
 */
const path = require('path');
const fs   = require('fs');
const { parse } = require('csv-parse/sync');

const ROOT = path.join(__dirname, '..', 'IFAS_training_data');

function readCsv(name) {
  const file = path.join(ROOT, name);
  if (!fs.existsSync(file)) { console.warn(`Training file not found: ${file}`); return []; }
  return parse(fs.readFileSync(file, 'utf8'), { columns: true, skip_empty_lines: true, trim: true });
}

exports.seed = async function (knex) {
  console.log('Seeding IFAS training data...');

  // Ensure a demo admin user exists
  let owner = await knex('users').where({ email: 'demo@ifas.dev' }).first();
  if (!owner) {
    const bcrypt = require('bcryptjs');
    const [id] = await knex('users').insert({
      email: 'demo@ifas.dev',
      password_hash: await bcrypt.hash('Demo1234!', 10),
      full_name: 'IFAS Demo User',
      is_active: 1,
      is_platform_admin: 0,
    });
    owner = await knex('users').where({ id }).first();
  }
  const ownerId = owner.id;

  const accountCsv    = readCsv('accounts.csv');
  const categoryCsv   = readCsv('categories.csv');
  const departmentCsv = readCsv('departments.csv');
  const txnFiles = {
    PERSONAL:     readCsv('transactions_personal.csv'),
    BUSINESS:     readCsv('transactions_business.csv'),
    ORGANIZATION: readCsv('transactions_organization.csv'),
  };
  const budgetCsv = readCsv('budgets.csv');
  const goalCsv   = readCsv('savings_goals.csv');

  for (const wsType of ['PERSONAL', 'BUSINESS', 'ORGANIZATION']) {
    // Skip if workspace already exists for this demo user + type
    const existingWs = await knex('workspace_members as wm')
      .join('workspaces as w', 'w.id', 'wm.workspace_id')
      .where({ 'wm.user_id': ownerId, 'w.workspace_type': wsType })
      .first();
    if (existingWs) { console.log(`  Skipping ${wsType} — already seeded.`); continue; }

    console.log(`  Creating ${wsType} workspace...`);

    const ownerRoleName = wsType === 'PERSONAL' ? 'PERSONAL Owner'
      : wsType === 'BUSINESS' ? 'BUSINESS Owner' : 'ORGANIZATION Admin';
    const ownerRole = await knex('roles').where({ name: ownerRoleName }).first();

    const [wsId] = await knex('workspaces').insert({
      name: `IFAS Demo — ${wsType}`,
      workspace_type: wsType,
      currency: 'KES',
      created_by: ownerId,
    });

    await knex('workspace_members').insert({ workspace_id: wsId, user_id: ownerId, role_id: ownerRole.id });

    // Insert accounts
    const wsAccounts = accountCsv.filter((r) => r.workspace_type === wsType);
    for (const a of wsAccounts) {
      await knex('accounts').insert({
        workspace_id:   wsId,
        name:           a.account_name,
        account_type:   a.account_type,
        opening_balance: Number(a.opening_balance) || 0,
      }).catch(() => {}); // ignore duplicates
    }

    // Insert categories
    const wsCats = categoryCsv.filter((r) => r.workspace_type === wsType);
    for (const c of wsCats) {
      await knex('categories').insert({
        workspace_id:  wsId,
        name:          c.category_name,
        category_type: c.category_type,
      }).catch(() => {});
    }
    // Also ensure Transfers category exists
    await knex('categories').insert({ workspace_id: wsId, name: 'Transfers', category_type: 'EXPENSE' }).catch(() => {});
    await knex('categories').insert({ workspace_id: wsId, name: 'Savings',   category_type: 'EXPENSE' }).catch(() => {});

    // Insert departments (ORGANIZATION only)
    const deptIdMap = {};
    if (wsType === 'ORGANIZATION') {
      const wsDepts = departmentCsv.filter((r) => r.workspace_type === wsType);
      for (const d of wsDepts) {
        const [id] = await knex('departments').insert({ workspace_id: wsId, name: d.department_name }).catch(() => [null]);
        if (id) deptIdMap[d.department_name] = id;
      }
      // Refresh from DB in case insert was skipped
      const dbDepts = await knex('departments').where({ workspace_id: wsId });
      dbDepts.forEach((d) => { deptIdMap[d.name] = d.id; });
    }

    // Build lookup maps
    const dbAccounts   = await knex('accounts').where({ workspace_id: wsId });
    const dbCategories = await knex('categories').where({ workspace_id: wsId });
    const accByName    = Object.fromEntries(dbAccounts.map((a) => [a.name.toLowerCase(), a.id]));
    const catByName    = Object.fromEntries(dbCategories.map((c) => [c.name.toLowerCase(), c.id]));

    // Insert transactions in batches
    const txns     = txnFiles[wsType] || [];
    const BATCH    = 500;
    let inserted   = 0;
    for (let i = 0; i < txns.length; i += BATCH) {
      const batch   = txns.slice(i, i + BATCH);
      const rows    = batch.map((t) => {
        const acctId     = accByName[t.account?.toLowerCase()];
        const toAcctId   = t.to_account ? (accByName[t.to_account?.toLowerCase()] ?? null) : null;
        const catId      = t.type !== 'TRANSFER' ? (catByName[t.category?.toLowerCase()] ?? null) : null;
        const deptId     = t.department ? (deptIdMap[t.department] ?? null) : null;
        if (!acctId) return null; // skip unresolvable account
        return {
          workspace_id:  wsId,
          account_id:    acctId,
          to_account_id: toAcctId,
          category_id:   catId,
          department_id: deptId,
          created_by:    ownerId,
          txn_type:      t.type,
          amount:        Number(t.amount),
          txn_date:      t.date,
          description:   t.description,
          status:        'POSTED',
        };
      }).filter(Boolean);
      if (rows.length) { await knex('transactions').insert(rows); inserted += rows.length; }
    }
    console.log(`    Inserted ${inserted} transactions.`);

    // Insert budgets
    const wsBudgets = budgetCsv.filter((r) => r.workspace_type === wsType);
    for (const b of wsBudgets) {
      const catId  = b.category  ? (catByName[b.category?.toLowerCase()] ?? null) : null;
      const deptId = b.department? (deptIdMap[b.department] ?? null) : null;
      if (!catId && !deptId) continue;
      await knex('budgets').insert({
        workspace_id:    wsId,
        category_id:     catId,
        department_id:   deptId,
        period_start:    b.period_start,
        period_end:      b.period_end,
        amount_limit:    Number(b.amount_limit),
        alert_threshold: Number(b.alert_threshold) || 80,
      }).catch(() => {});
    }

    // Insert savings goals (PERSONAL only)
    if (wsType === 'PERSONAL') {
      const goals = goalCsv.filter((r) => r.workspace_type === wsType);
      for (const g of goals) {
        await knex('savings_goals').insert({
          workspace_id:  wsId,
          name:          g.goal_name,
          target_amount: Number(g.target_amount),
          saved_amount:  Number(g.saved_amount) || 0,
          target_date:   g.target_date || null,
        }).catch(() => {});
      }
    }

    console.log(`  ${wsType} workspace ready (id=${wsId}).`);
  }

  console.log('Training data seeding complete.');
  console.log('Login: demo@ifas.dev / Demo1234!');
};

// Allow direct execution: node seeds/trainingData.js
if (require.main === module) {
  require('dotenv').config();
  const knex = require('knex')(require('../knexfile').development);
  exports.seed(knex)
    .then(() => { knex.destroy(); process.exit(0); })
    .catch((e) => { console.error(e); knex.destroy(); process.exit(1); });
}
