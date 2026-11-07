'use strict';
/**
 * Financial integration tests — accounts, categories, transactions.
 * Uses the new frontend-aligned envelope and field names.
 */
const request = require('supertest');
const { createApp } = require('../../src/app');

const app  = createApp();
const BASE = '/api/v1';

async function register() {
  const res = await request(app).post(`${BASE}/auth/register`)
    .send({ email: `u${Date.now()}${Math.random().toString(36).slice(2)}@ifas.dev`, password: 'TestPass123!', name: 'Tester' });
  expect(res.status).toBe(201);
  return { token: res.body.data.accessToken, user: res.body.data.user };
}

async function createWorkspace(token, type = 'BUSINESS') {
  const res = await request(app).post(`${BASE}/workspaces`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `WS-${Date.now()}`, type });
  expect(res.status).toBe(201);
  return res.body.data;
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
  test('create account with frontend fields (type/balance) → mapped response', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token);
    const A  = api(token);

    const res = await A.post(`${BASE}/workspaces/${ws.id}/accounts`)
      .send({ name: 'Bank Account', type: 'BANK', balance: 50000 });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const acc = res.body.data;
    expect(acc.name).toBe('Bank Account');
    expect(acc.type).toBe('BANK');      // frontend field name
    expect(acc.balance).toBe(50000);    // frontend field name
    expect(acc.is_active).toBe(true);
    expect(acc).not.toHaveProperty('account_type');
    expect(acc).not.toHaveProperty('opening_balance');
  });

  test('duplicate account name rejected', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token);
    const A  = api(token);
    await A.post(`${BASE}/workspaces/${ws.id}/accounts`).send({ name: 'Savings', type: 'BANK' });
    const dup = await A.post(`${BASE}/workspaces/${ws.id}/accounts`).send({ name: 'Savings', type: 'BANK' });
    expect(dup.status).toBe(409);
  });

  test('ISOLATION: cannot create account in another workspace', async () => {
    const alice = await register();
    const bob   = await register();
    const bobWs = await createWorkspace(bob.token);
    const res = await api(alice.token).post(`${BASE}/workspaces/${bobWs.id}/accounts`)
      .send({ name: 'Hack', type: 'CASH' });
    expect(res.status).toBe(403);
  });

  test('list accounts returns envelope data array', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token);
    await api(token).post(`${BASE}/workspaces/${ws.id}/accounts`).send({ name: 'A1', type: 'BANK' });
    const res = await api(token).get(`${BASE}/workspaces/${ws.id}/accounts`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('Categories', () => {
  test('category has type (not category_type)', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'PERSONAL');
    const res = await api(token).get(`${BASE}/workspaces/${ws.id}/categories`);
    expect(res.status).toBe(200);
    const cat = res.body.data[0];
    expect(cat).toHaveProperty('type');
    expect(cat).not.toHaveProperty('category_type');
  });

  test('create custom category with type field', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token);
    const res = await api(token).post(`${BASE}/workspaces/${ws.id}/categories`)
      .send({ name: 'Custom', type: 'EXPENSE' });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('EXPENSE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('Transactions', () => {
  let token, ws, accountId, categoryId;

  beforeEach(async () => {
    const u = await register();
    token    = u.token;
    ws       = await createWorkspace(token, 'PERSONAL');
    const A  = api(token);

    const acc = await A.post(`${BASE}/workspaces/${ws.id}/accounts`)
      .send({ name: 'Bank', type: 'BANK', balance: 100000 });
    accountId = acc.body.data.id;

    const cats = await A.get(`${BASE}/workspaces/${ws.id}/categories`);
    const salCat = cats.body.data.find((c) => c.name === 'Salary') || cats.body.data[0];
    categoryId = salCat.id;
  });

  test('create INCOME with frontend fields (type/date) → mapped response', async () => {
    const A   = api(token);
    const res = await A.post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ type: 'income', amount: 50000, date: '2026-01-15', description: 'Salary', account_id: accountId, category_id: categoryId });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('income');
    expect(res.body.data.date).toBe('2026-01-15');
    expect(Number(res.body.data.amount)).toBe(50000);
    expect(res.body.data.account_name).toBe('Bank');
    expect(res.body.data).not.toHaveProperty('txn_type');
    expect(res.body.data).not.toHaveProperty('txn_date');
  });

  test('paginated list returns { data, meta }', async () => {
    const A = api(token);
    await A.post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ type: 'income', amount: 1000, date: '2026-02-01', description: 'Inc', account_id: accountId, category_id: categoryId });
    const res = await A.get(`${BASE}/workspaces/${ws.id}/transactions`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('total');
    expect(res.body.meta).toHaveProperty('total_pages');
  });

  test('list accepts frontend filter params (type/from/to)', async () => {
    const A = api(token);
    await A.post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ type: 'income', amount: 1000, date: '2026-02-01', description: 'Feb', account_id: accountId, category_id: categoryId });
    await A.post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ type: 'income', amount: 2000, date: '2026-03-01', description: 'Mar', account_id: accountId, category_id: categoryId });
    const res = await A.get(`${BASE}/workspaces/${ws.id}/transactions?from=2026-02-01&to=2026-02-28`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
  });

  test('INCOME without category_id → 422', async () => {
    const res = await api(token).post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ type: 'income', amount: 1000, date: '2026-01-01', description: 'Test', account_id: accountId });
    expect(res.status).toBe(422);
  });

  test('amount must be positive', async () => {
    const res = await api(token).post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ type: 'income', amount: -100, date: '2026-01-01', description: 'Test', account_id: accountId, category_id: categoryId });
    expect(res.status).toBe(422);
  });

  test('TRANSFER needs destination_account_id', async () => {
    const res = await api(token).post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ type: 'transfer', amount: 1000, date: '2026-01-01', description: 'Move', account_id: accountId });
    expect(res.status).toBe(422);
  });

  test('valid TRANSFER with destination_account_id', async () => {
    const A   = api(token);
    const acc2 = await A.post(`${BASE}/workspaces/${ws.id}/accounts`).send({ name: 'Savings', type: 'BANK' });
    const res = await A.post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ type: 'transfer', amount: 5000, date: '2026-01-10', description: 'Save', account_id: accountId, destination_account_id: acc2.body.data.id });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('transfer');
    expect(res.body.data.destination_account_id).toBe(acc2.body.data.id);
  });

  test('cross-workspace account rejected', async () => {
    const bob = await register();
    const bobWs = await createWorkspace(bob.token, 'PERSONAL');
    const bobAcc = await api(bob.token).post(`${BASE}/workspaces/${bobWs.id}/accounts`).send({ name: 'BobBank', type: 'BANK' });
    const res = await api(token).post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ type: 'income', amount: 100, date: '2026-01-01', description: 'Hack', account_id: bobAcc.body.data.id, category_id: categoryId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_IN_WORKSPACE');
  });

  test('void a transaction (via POST /void)', async () => {
    const A  = api(token);
    const cr = await A.post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ type: 'income', amount: 500, date: '2026-01-20', description: 'Test', account_id: accountId, category_id: categoryId });
    const vr = await A.post(`${BASE}/workspaces/${ws.id}/transactions/${cr.body.data.id}/void`)
      .send({ void_reason: 'Entry mistake' });
    expect(vr.status).toBe(200);
    expect(vr.body.data.status).toBe('VOID');
  });

  test('DELETE /transactions/:id voids the transaction (frontend "remove")', async () => {
    const A  = api(token);
    const cr = await A.post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ type: 'income', amount: 500, date: '2026-01-20', description: 'Del test', account_id: accountId, category_id: categoryId });
    const del = await A.delete(`${BASE}/workspaces/${ws.id}/transactions/${cr.body.data.id}`);
    expect(del.status).toBe(200);
    expect(del.body.data.status).toBe('VOID');
  });

  test('ISOLATION: cannot list another workspace transactions', async () => {
    const bob   = await register();
    const bobWs = await createWorkspace(bob.token, 'PERSONAL');
    const res = await api(token).get(`${BASE}/workspaces/${bobWs.id}/transactions`);
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('Permission enforcement', () => {
  test('Viewer role cannot create transactions', async () => {
    const owner  = await register();
    const viewer = await register();
    const ws     = await createWorkspace(owner.token, 'BUSINESS');
    const A      = api(owner.token);

    await A.post(`${BASE}/workspaces/${ws.id}/members`)
      .send({ user_id: viewer.user.id, role: 'viewer' });

    const acc = await A.post(`${BASE}/workspaces/${ws.id}/accounts`).send({ name: 'Till', type: 'CASH' });
    const cats = await A.get(`${BASE}/workspaces/${ws.id}/categories`);
    const catId = cats.body.data[0].id;

    const res = await api(viewer.token).post(`${BASE}/workspaces/${ws.id}/transactions`)
      .send({ type: 'income', amount: 100, date: '2026-01-01', description: 'X', account_id: acc.body.data.id, category_id: catId });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSION');
  });
});
