'use strict';
/**
 * Financial integration tests — accounts, categories, transactions.
 * Critical: workspace isolation (user A can NEVER touch workspace B data).
 */
const request = require('supertest');
const { createApp } = require('../../src/app');

const app  = createApp();
const BASE = '/api/v1';

// ── helpers ───────────────────────────────────────────────────────────────────
async function register(n = '') {
  const res = await request(app).post(`${BASE}/auth/register`)
    .send({ email: `user${n}${Date.now()}@ifas.dev`, password: 'TestPass123!', full_name: `User ${n}` });
  expect(res.status).toBe(201);
  return { token: res.body.access_token, user: res.body.user };
}

async function createWorkspace(token, type = 'BUSINESS') {
  const res = await request(app).post(`${BASE}/workspaces`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `WS-${Date.now()}`, workspace_type: type });
  expect(res.status).toBe(201);
  return res.body.workspace;
}

function api(token) {
  return {
    get:    (p) => request(app).get(p).set('Authorization', `Bearer ${token}`),
    post:   (p) => request(app).post(p).set('Authorization', `Bearer ${token}`),
    patch:  (p) => request(app).patch(p).set('Authorization', `Bearer ${token}`),
    delete: (p) => request(app).delete(p).set('Authorization', `Bearer ${token}`),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('Accounts', () => {
  test('owner can create and list accounts', async () => {
    const { token } = await register('a');
    const ws = await createWorkspace(token);
    const A  = api(token);

    const cr = await A.post(`${BASE}/workspaces/${ws.id}/accounts`)
      .send({ name: 'Bank Account', account_type: 'BANK', opening_balance: 50000 });
    expect(cr.status).toBe(201);
    expect(cr.body.account.name).toBe('Bank Account');

    const list = await A.get(`${BASE}/workspaces/${ws.id}/accounts`);
    expect(list.status).toBe(200);
    // Default categories are seeded; accounts were created via this call only
    expect(list.body.accounts.length).toBeGreaterThanOrEqual(1);
  });

  test('duplicate account name rejected', async () => {
    const { token } = await register('b');
    const ws = await createWorkspace(token);
    const A  = api(token);

    await A.post(`${BASE}/workspaces/${ws.id}/accounts`).send({ name: 'Savings', account_type: 'BANK' });
    const dup = await A.post(`${BASE}/workspaces/${ws.id}/accounts`).send({ name: 'Savings', account_type: 'BANK' });
    expect(dup.status).toBe(409);
  });

  test('WORKSPACE ISOLATION: user cannot access another workspace accounts', async () => {
    const alice = await register('c');
    const bob   = await register('d');
    const wsB   = await createWorkspace(bob.token);
    // Alice creates an account in Bob's workspace — must be blocked
    const res = await api(alice.token).post(`${BASE}/workspaces/${wsB.id}/accounts`)
      .send({ name: 'Hack', account_type: 'CASH' });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('Categories', () => {
  test('default categories are seeded for new PERSONAL workspace', async () => {
    const { token } = await register('e');
    const ws = await createWorkspace(token, 'PERSONAL');
    const A  = api(token);
    const res = await A.get(`${BASE}/workspaces/${ws.id}/categories`);
    expect(res.status).toBe(200);
    const names = res.body.categories.map((c) => c.name);
    expect(names).toContain('Salary');
    expect(names).toContain('Groceries');
  });

  test('can create a custom category', async () => {
    const { token } = await register('f');
    const ws = await createWorkspace(token);
    const A  = api(token);
    const res = await A.post(`${BASE}/workspaces/${ws.id}/categories`)
      .send({ name: 'Custom Expense', category_type: 'EXPENSE' });
    expect(res.status).toBe(201);
    expect(res.body.category.category_type).toBe('EXPENSE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('Transactions', () => {
  let token, ws, accountId, categoryId;

  beforeEach(async () => {
    const u = await register('txn');
    token    = u.token;
    ws       = await createWorkspace(token, 'PERSONAL');
    const A  = api(token);

    const acc = await A.post(`${BASE}/workspaces/${ws.id}/accounts`)
      .send({ name: 'Bank', account_type: 'BANK', opening_balance: 100000 });
    accountId = acc.body.account.id;

    // Get a seeded category
    const cats = await A.get(`${BASE}/workspaces/${ws.id}/categories`);
    const salCat = cats.body.categories.find((c) => c.name === 'Salary');
    categoryId = salCat ? salCat.id : cats.body.categories[0].id;
  });

  test('create INCOME transaction', async () => {
    const A   = api(token);
    const res = await A.post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ txn_type: 'INCOME', amount: 50000, txn_date: '2026-01-15', description: 'Monthly salary', account_id: accountId, category_id: categoryId });
    expect(res.status).toBe(201);
    expect(res.body.transaction.status).toBe('POSTED');
    expect(Number(res.body.transaction.amount)).toBe(50000);
  });

  test('INCOME without category_id → 422', async () => {
    const A   = api(token);
    const res = await A.post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ txn_type: 'INCOME', amount: 1000, txn_date: '2026-01-01', description: 'Test', account_id: accountId });
    expect(res.status).toBe(422);
    expect(res.body.error.fields.category_id).toBeDefined();
  });

  test('amount must be positive', async () => {
    const A   = api(token);
    const res = await A.post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ txn_type: 'INCOME', amount: -100, txn_date: '2026-01-01', description: 'Test', account_id: accountId, category_id: categoryId });
    expect(res.status).toBe(422);
  });

  test('TRANSFER needs to_account_id', async () => {
    const A   = api(token);
    const res = await A.post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ txn_type: 'TRANSFER', amount: 1000, txn_date: '2026-01-01', description: 'Move', account_id: accountId });
    expect(res.status).toBe(422);
  });

  test('create valid TRANSFER', async () => {
    const A   = api(token);
    const acc2 = await A.post(`${BASE}/workspaces/${ws.id}/accounts`)
      .send({ name: 'Savings', account_type: 'BANK' });
    const acc2Id = acc2.body.account.id;

    const res = await A.post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ txn_type: 'TRANSFER', amount: 5000, txn_date: '2026-01-10', description: 'Monthly savings', account_id: accountId, to_account_id: acc2Id });
    expect(res.status).toBe(201);
    expect(res.body.transaction.txn_type).toBe('TRANSFER');
  });

  test('same account transfer rejected', async () => {
    const A   = api(token);
    const res = await A.post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ txn_type: 'TRANSFER', amount: 500, txn_date: '2026-01-01', description: 'Test', account_id: accountId, to_account_id: accountId });
    expect(res.status).toBe(422);
  });

  test('cross-workspace account rejected', async () => {
    const A    = api(token);
    const bob  = await register('bob');
    const bobWs = await createWorkspace(bob.token, 'PERSONAL');
    const bobA  = api(bob.token);
    const bobAcc = await bobA.post(`${BASE}/workspaces/${bobWs.id}/accounts`).send({ name: 'BobBank', account_type: 'BANK' });
    const bobAccId = bobAcc.body.account.id;

    // Alice tries to use Bob's account in her transaction
    const res = await A.post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ txn_type: 'INCOME', amount: 100, txn_date: '2026-01-01', description: 'Hack', account_id: bobAccId, category_id: categoryId });
    expect(res.status).toBe(400); // ACCOUNT_NOT_IN_WORKSPACE
  });

  test('list transactions with filters', async () => {
    const A = api(token);
    await A.post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ txn_type: 'INCOME', amount: 1000, txn_date: '2026-02-01', description: 'Inc', account_id: accountId, category_id: categoryId });
    await A.post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ txn_type: 'INCOME', amount: 2000, txn_date: '2026-03-01', description: 'Inc2', account_id: accountId, category_id: categoryId });

    const res = await A.get(`${BASE}/workspaces/${ws.id}/transactions?date_from=2026-02-01&date_to=2026-02-28`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.total).toBe(1);
  });

  test('void a transaction', async () => {
    const A   = api(token);
    const cr  = await A.post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ txn_type: 'INCOME', amount: 500, txn_date: '2026-01-20', description: 'Test', account_id: accountId, category_id: categoryId });
    const txnId = cr.body.transaction.id;

    const vr = await A.post(`${BASE}/workspaces/${ws.id}/transactions/${txnId}/void`)
      .send({ void_reason: 'Entry mistake' });
    expect(vr.status).toBe(200);
    expect(vr.body.transaction.status).toBe('VOID');
  });

  test('voided transaction cannot be voided again', async () => {
    const A   = api(token);
    const cr  = await A.post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ txn_type: 'INCOME', amount: 500, txn_date: '2026-01-20', description: 'Test', account_id: accountId, category_id: categoryId });
    const txnId = cr.body.transaction.id;
    await A.post(`${BASE}/workspaces/${ws.id}/transactions/${txnId}/void`).send({});
    const vr2 = await A.post(`${BASE}/workspaces/${ws.id}/transactions/${txnId}/void`).send({});
    expect(vr2.status).toBe(400);
    expect(vr2.body.error.code).toBe('ALREADY_VOID');
  });

  test('WORKSPACE ISOLATION: cannot list another workspace transactions', async () => {
    const bob   = await register('bob2');
    const bobWs = await createWorkspace(bob.token, 'PERSONAL');
    const A     = api(token);
    const res = await A.get(`${BASE}/workspaces/${bobWs.id}/transactions`);
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('Permission enforcement', () => {
  test('Viewer role cannot create transactions', async () => {
    const owner  = await register('own');
    const viewer = await register('view');
    const ws     = await createWorkspace(owner.token, 'BUSINESS');
    const A      = api(owner.token);

    // Add viewer
    await A.post(`${BASE}/workspaces/${ws.id}/members`)
      .send({ user_id: viewer.user.id, role_name: 'BUSINESS Viewer' });

    // Viewer tries to create transaction
    const acc = await A.post(`${BASE}/workspaces/${ws.id}/accounts`)
      .send({ name: 'Till', account_type: 'CASH' });
    const cats = await A.get(`${BASE}/workspaces/${ws.id}/categories`);
    const catId = cats.body.categories[0].id;

    const res = await api(viewer.token).post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ txn_type: 'INCOME', amount: 100, txn_date: '2026-01-01', description: 'X', account_id: acc.body.account.id, category_id: catId });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSION');
  });
});
