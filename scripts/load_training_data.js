/**
 * IFAS Training Data Loader
 * Loads synthetic training data from IFAS_training_data/ into the database.
 * Creates 3 workspaces (PERSONAL, BUSINESS, ORGANIZATION) with full financial data.
 *
 * Usage: node scripts/load_training_data.js
 */
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const csv = require('csv-parse/sync');
const bcrypt = require('bcryptjs');
const { getKnex } = require('../src/config/database');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', 'IFAS_training_data');
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);

async function readCsv(filename) {
  const content = fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8');
  return csv.parse(content, { columns: true, skip_empty_lines: true });
}

async function main() {
  const knex = getKnex();

  console.log('🔄 Loading IFAS training data...\n');

  // ──────────────────────────────────────────────────────────────
  // 1. Create/find a test user
  // ──────────────────────────────────────────────────────────────
  const testEmail = 'training@ifas.local';
  let user = await knex('users').where({ email: testEmail }).first();

  if (!user) {
    const passwordHash = await bcrypt.hash('Training123!', BCRYPT_ROUNDS);
    const [userId] = await knex('users').insert({
      email: testEmail,
      password_hash: passwordHash,
      full_name: 'Training User',
      phone: null,
      is_platform_admin: false,
      is_active: true,
    });
    user = await knex('users').where({ id: userId }).first();
    console.log(`✅ Created training user: ${user.email} (id: ${user.id})`);
  } else {
    console.log(`✅ Using existing training user: ${user.email} (id: ${user.id})`);
  }

  // ──────────────────────────────────────────────────────────────
  // 2. Load reference data: roles, permissions (already seeded)
  // ──────────────────────────────────────────────────────────────
  const personalOwnerRole = await knex('roles').where({ name: 'PERSONAL Owner' }).first();
  const businessOwnerRole = await knex('roles').where({ name: 'BUSINESS Owner' }).first();
  const orgAdminRole = await knex('roles').where({ name: 'ORGANIZATION Admin' }).first();

  if (!personalOwnerRole || !businessOwnerRole || !orgAdminRole) {
    console.error('❌ Required roles not found. Run migrations/seeds first.');
    process.exit(1);
  }

  // ──────────────────────────────────────────────────────────────
  // 3. Create workspaces
  // ──────────────────────────────────────────────────────────────
  const workspaceTypes = ['PERSONAL', 'BUSINESS', 'ORGANIZATION'];
  const roleMap = {
    PERSONAL: personalOwnerRole.id,
    BUSINESS: businessOwnerRole.id,
    ORGANIZATION: orgAdminRole.id,
  };

  const workspaces = {};
  for (const wsType of workspaceTypes) {
    const existing = await knex('workspaces').where({ name: `Training ${wsType} Workspace` }).first();
    if (existing) {
      workspaces[wsType] = existing;
      console.log(`✅ Workspace exists: ${existing.name} (id: ${existing.id})`);
    } else {
      const [wsId] = await knex('workspaces').insert({
        name: `Training ${wsType} Workspace`,
        workspace_type: wsType,
        currency: 'KES',
        created_by: user.id,
      });
      const ws = await knex('workspaces').where({ id: wsId }).first();
      workspaces[wsType] = ws;
      console.log(`✅ Created workspace: ${ws.name} (id: ${ws.id})`);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 4. Add user as member of each workspace
  // ──────────────────────────────────────────────────────────────
  for (const wsType of workspaceTypes) {
    const ws = workspaces[wsType];
    const existing = await knex('workspace_members')
      .where({ workspace_id: ws.id, user_id: user.id })
      .first();
    if (!existing) {
      await knex('workspace_members').insert({
        workspace_id: ws.id,
        user_id: user.id,
        role_id: roleMap[wsType],
        department_id: null,
      });
      console.log(`✅ Added user to ${ws.name} as owner`);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 5. Load accounts, categories, departments for each workspace
  // ──────────────────────────────────────────────────────────────
  const accountsCsv = await readCsv('accounts.csv');
  const categoriesCsv = await readCsv('categories.csv');
  const departmentsCsv = await readCsv('departments.csv');

  for (const wsType of workspaceTypes) {
    const ws = workspaces[wsType];
    console.log(`\n📦 Setting up ${wsType} workspace (id: ${ws.id})...`);

    // Accounts
    const wsAccounts = accountsCsv.filter(r => r.workspace_type === wsType);
    for (const acc of wsAccounts) {
      const exists = await knex('accounts').where({ workspace_id: ws.id, name: acc.account_name }).first();
      if (!exists) {
        await knex('accounts').insert({
          workspace_id: ws.id,
          name: acc.account_name,
          account_type: acc.account_type,
          opening_balance: parseFloat(acc.opening_balance) || 0,
        });
        console.log(`  💳 Account: ${acc.account_name} (${acc.account_type})`);
      }
    }

    // Categories
    const wsCategories = categoriesCsv.filter(r => r.workspace_type === wsType);
    for (const cat of wsCategories) {
      const exists = await knex('categories').where({ workspace_id: ws.id, name: cat.category_name }).first();
      if (!exists) {
        await knex('categories').insert({
          workspace_id: ws.id,
          name: cat.category_name,
          category_type: cat.category_type,
        });
        console.log(`  🏷️  Category: ${cat.category_name} (${cat.category_type})`);
      }
    }

    // Departments (only ORGANIZATION)
    if (wsType === 'ORGANIZATION') {
      const wsDepts = departmentsCsv.filter(r => r.workspace_type === wsType);
      for (const dept of wsDepts) {
        const exists = await knex('departments').where({ workspace_id: ws.id, name: dept.department_name }).first();
        if (!exists) {
          await knex('departments').insert({
            workspace_id: ws.id,
            name: dept.department_name,
            budget: 0,
            head_name: null,
          });
          console.log(`  🏢 Department: ${dept.department_name}`);
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 6. Load transactions for each workspace
  // ──────────────────────────────────────────────────────────────
  const transactionFiles = {
    PERSONAL: 'transactions_personal.csv',
    BUSINESS: 'transactions_business.csv',
    ORGANIZATION: 'transactions_organization.csv',
  };

  // Load anomaly labels for reference
  const anomalyLabels = await readCsv('anomaly_labels.csv');
  const anomalyMap = new Map(anomalyLabels.map(r => [r.ref, { is_anomaly: r.is_anomaly === '1', anomaly_type: r.anomaly_type }]));

  for (const wsType of workspaceTypes) {
    const ws = workspaces[wsType];
    const filename = transactionFiles[wsType];
    console.log(`\n💰 Loading transactions for ${wsType} from ${filename}...`);

    const transactions = await readCsv(filename);

    // Build lookups
    const accounts = await knex('accounts').where({ workspace_id: ws.id });
    const accountByName = new Map(accounts.map(a => [a.name.toLowerCase(), a]));

    const categories = await knex('categories').where({ workspace_id: ws.id });
    const categoryByName = new Map(categories.map(c => [c.name.toLowerCase(), c]));

    let departments = await knex('departments').where({ workspace_id: ws.id });
    const departmentByName = new Map(departments.map(d => [d.name.toLowerCase(), d]));

    let imported = 0;
    let skipped = 0;

    // Process in batches
    const BATCH_SIZE = 500;
    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
      const batch = transactions.slice(i, i + BATCH_SIZE);
      const toInsert = [];

      for (const row of batch) {
        // Check for duplicate (same date, amount, account, description)
        const account = accountByName.get(row.account.toLowerCase());
        if (!account) {
          console.warn(`  ⚠️  Account not found: ${row.account}`);
          skipped++;
          continue;
        }

        let categoryId = null;
        if (row.category && row.category.trim() && row.type.toLowerCase() !== 'transfer') {
          const category = categoryByName.get(row.category.toLowerCase());
          if (!category) {
            console.warn(`  ⚠️  Category not found: ${row.category}`);
            skipped++;
            continue;
          }
          categoryId = category.id;
        }

        let toAccountId = null;
        if (row.type.toLowerCase() === 'transfer' && row.to_account) {
          const toAccount = accountByName.get(row.to_account.toLowerCase());
          if (!toAccount) {
            console.warn(`  ⚠️  To-account not found: ${row.to_account}`);
            skipped++;
            continue;
          }
          toAccountId = toAccount.id;
        }

        let departmentId = null;
        if (row.department && row.department.trim()) {
          const dept = departmentByName.get(row.department.toLowerCase());
          if (dept) departmentId = dept.id;
        }

        // Check duplicate
        const existing = await knex('transactions')
          .where({
            workspace_id: ws.id,
            txn_date: row.date,
            amount: parseFloat(row.amount),
            account_id: account.id,
            description: row.description,
            status: 'POSTED',
          })
          .first();

        if (existing) {
          skipped++;
          continue;
        }

        toInsert.push({
          workspace_id: ws.id,
          account_id: account.id,
          to_account_id: toAccountId,
          category_id: categoryId,
          department_id: departmentId,
          import_id: null,
          created_by: user.id,
          txn_type: row.type.toUpperCase(),
          amount: parseFloat(row.amount),
          txn_date: row.date,
          description: row.description,
          status: 'POSTED',
          created_at: new Date(),
          updated_at: new Date(),
        });
      }

      if (toInsert.length > 0) {
        await knex('transactions').insert(toInsert);
        imported += toInsert.length;
      }

      if (i % 5000 === 0 && i > 0) {
        console.log(`  📊 Progress: ${imported} imported, ${skipped} skipped...`);
      }
    }

    console.log(`  ✅ ${wsType}: ${imported} transactions imported, ${skipped} skipped (duplicates)`);
  }

  // ──────────────────────────────────────────────────────────────
  // 7. Load budgets
  // ──────────────────────────────────────────────────────────────
  console.log('\n📊 Loading budgets...');
  const budgetsCsv = await readCsv('budgets.csv');
  let budgetCount = 0;

  for (const wsType of workspaceTypes) {
    const ws = workspaces[wsType];
    const wsBudgets = budgetsCsv.filter(r => r.workspace_type === wsType);

    const categories = await knex('categories').where({ workspace_id: ws.id });
    const categoryByName = new Map(categories.map(c => [c.name.toLowerCase(), c]));

    let departments = await knex('departments').where({ workspace_id: ws.id });
    const departmentByName = new Map(departments.map(d => [d.name.toLowerCase(), d]));

    for (const row of wsBudgets) {
      let categoryId = null;
      if (row.category && row.category.trim()) {
        const cat = categoryByName.get(row.category.toLowerCase());
        if (cat) categoryId = cat.id;
      }

      let departmentId = null;
      if (row.department && row.department.trim()) {
        const dept = departmentByName.get(row.department.toLowerCase());
        if (dept) departmentId = dept.id;
      }

      const exists = await knex('budgets').where({
        workspace_id: ws.id,
        category_id: categoryId,
        department_id: departmentId,
        period_start: row.period_start,
        period_end: row.period_end,
      }).first();

      if (!exists) {
        await knex('budgets').insert({
          workspace_id: ws.id,
          category_id: categoryId,
          department_id: departmentId,
          period_start: row.period_start,
          period_end: row.period_end,
          amount_limit: parseFloat(row.amount_limit),
          alert_threshold: parseInt(row.alert_threshold, 10),
          notes: `Training data budget for ${wsType}`,
        });
        budgetCount++;
      }
    }
  }
  console.log(`  ✅ ${budgetCount} budgets loaded`);

  // ──────────────────────────────────────────────────────────────
  // 8. Load savings goals
  // ──────────────────────────────────────────────────────────────
  console.log('\n🎯 Loading savings goals...');
  const savingsCsv = await readCsv('savings_goals.csv');
  let goalCount = 0;

  for (const row of savingsCsv) {
    const ws = workspaces[row.workspace_type];
    if (!ws) continue;

    const exists = await knex('savings_goals').where({
      workspace_id: ws.id,
      name: row.goal_name,
    }).first();

    if (!exists) {
      await knex('savings_goals').insert({
        workspace_id: ws.id,
        name: row.goal_name,
        target_amount: parseFloat(row.target_amount),
        saved_amount: parseFloat(row.saved_amount) || 0,
        target_date: row.target_date || null,
      });
      goalCount++;
      console.log(`  🎯 ${ws.name}: ${row.goal_name} (KES ${row.target_amount})`);
    }
  }
  console.log(`  ✅ ${goalCount} savings goals loaded`);

  // ──────────────────────────────────────────────────────────────
  // 9. Summary
  // ──────────────────────────────────────────────────────────────
  console.log('\n📈 Summary:');
  for (const wsType of workspaceTypes) {
    const ws = workspaces[wsType];
    const txnCount = await knex('transactions').where({ workspace_id: ws.id }).count('* as c').first();
    const accCount = await knex('accounts').where({ workspace_id: ws.id }).count('* as c').first();
    const catCount = await knex('categories').where({ workspace_id: ws.id }).count('* as c').first();
    const budCount = await knex('budgets').where({ workspace_id: ws.id }).count('* as c').first();
    const goalCount2 = await knex('savings_goals').where({ workspace_id: ws.id }).count('* as c').first();

    console.log(`  ${ws.name} (${wsType}):`);
    console.log(`    💳 Accounts: ${accCount.c}`);
    console.log(`    🏷️  Categories: ${catCount.c}`);
    console.log(`    💰 Transactions: ${txnCount.c}`);
    console.log(`    📊 Budgets: ${budCount.c}`);
    console.log(`    🎯 Savings Goals: ${goalCount2.c}`);
  }

  console.log('\n✅ Training data load complete!');
  console.log(`\n🔐 Login: ${testEmail} / Training123!`);
  console.log('🚀 Run `npm run dev` and start testing!');

  await knex.destroy();
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});