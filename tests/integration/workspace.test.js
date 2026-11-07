'use strict';
/**
 * Workspace + permission tests — new contract:
 *   { success, data, meta, message }  envelope
 *   workspace.type (not workspace_type)
 *   member.role  (not role_name)
 */
const request = require('supertest');
const { createApp } = require('../../src/app');

const app  = createApp();
const BASE = '/api/v1';

async function register(overrides = {}) {
  const defaults = {
    email: `u${Date.now()}${Math.random().toString(36).slice(2)}@ifas.dev`,
    password: 'TestPass123!',
    name: 'Test User',
  };
  const res = await request(app).post(`${BASE}/auth/register`).send({ ...defaults, ...overrides });
  expect(res.status).toBe(201);
  return { token: res.body.data.accessToken, user: res.body.data.user, cookie: res.headers['set-cookie'] };
}

async function createWorkspace(token, type = 'PERSONAL', name = 'My Workspace') {
  const res = await request(app)
    .post(`${BASE}/workspaces`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name, type });
  expect(res.status).toBe(201);
  return res.body.data;
}

function authed(token) {
  return {
    get:    (p) => request(app).get(p).set('Authorization', `Bearer ${token}`),
    post:   (p) => request(app).post(p).set('Authorization', `Bearer ${token}`),
    patch:  (p) => request(app).patch(p).set('Authorization', `Bearer ${token}`),
    delete: (p) => request(app).delete(p).set('Authorization', `Bearer ${token}`),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('POST /workspaces', () => {
  test('201 creates workspace with type field', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'PERSONAL');
    expect(ws).toHaveProperty('id');
    expect(ws.type).toBe('PERSONAL');
  });

  test('201 accepts workspace_type field too', async () => {
    const { token } = await register();
    const res = await request(app).post(`${BASE}/workspaces`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'WS', workspace_type: 'BUSINESS' });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('BUSINESS');
  });

  test('422 on missing type', async () => {
    const { token } = await register();
    const res = await request(app).post(`${BASE}/workspaces`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad' });
    expect(res.status).toBe(422);
  });

  test('401 without token', async () => {
    const res = await request(app).post(`${BASE}/workspaces`).send({ name: 'X', type: 'PERSONAL' });
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /workspaces', () => {
  test('returns only the user\'s own workspaces', async () => {
    const alice = await register();
    const bob   = await register();
    await createWorkspace(alice.token, 'PERSONAL', 'Alice WS');
    await createWorkspace(alice.token, 'BUSINESS', 'Alice Biz');
    await createWorkspace(bob.token,   'PERSONAL', 'Bob WS');

    const res = await authed(alice.token).get(`${BASE}/workspaces`);
    expect(res.status).toBe(200);
    const names = res.body.data.map((w) => w.name);
    expect(names).toContain('Alice WS');
    expect(names).toContain('Alice Biz');
    expect(names).not.toContain('Bob WS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('WORKSPACE ISOLATION', () => {
  test('Alice cannot GET Bob\'s workspace', async () => {
    const alice = await register();
    const bob   = await register();
    const bobWs = await createWorkspace(bob.token, 'PERSONAL', 'BobPrivate');
    const res = await authed(alice.token).get(`${BASE}/workspaces/${bobWs.id}`);
    expect(res.status).toBe(403);
  });

  test('Alice cannot list Bob\'s members', async () => {
    const alice = await register();
    const bob   = await register();
    const bobWs = await createWorkspace(bob.token, 'PERSONAL', 'BobPrivate');
    const res = await authed(alice.token).get(`${BASE}/workspaces/${bobWs.id}/members`);
    expect(res.status).toBe(403);
  });

  test('unauthenticated always rejected', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'PERSONAL');
    const res = await request(app).get(`${BASE}/workspaces/${ws.id}`);
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /workspaces/:id', () => {
  test('returns workspace with my_role and my_permissions', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'BUSINESS');
    const res = await authed(token).get(`${BASE}/workspaces/${ws.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe('BUSINESS');
    expect(res.body.data.my_role).toBeTruthy();
    expect(Array.isArray(res.body.data.my_permissions)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('PATCH /workspaces/:id', () => {
  test('owner can update name', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'PERSONAL');
    const res = await authed(token).patch(`${BASE}/workspaces/${ws.id}`).send({ name: 'Updated Name' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Name');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('Members', () => {
  test('owner can add a member by user_id + role (simple role)', async () => {
    const owner  = await register();
    const newbie = await register();
    const ws = await createWorkspace(owner.token, 'BUSINESS');

    const res = await authed(owner.token).post(`${BASE}/workspaces/${ws.id}/members`)
      .send({ user_id: newbie.user.id, role: 'viewer' });
    expect(res.status).toBe(201);
    const emails = res.body.data.map((m) => m.email);
    expect(emails).toContain(newbie.user.email);
  });

  test('member returned with simplified role field', async () => {
    const owner  = await register();
    const newbie = await register();
    const ws = await createWorkspace(owner.token, 'BUSINESS');
    await authed(owner.token).post(`${BASE}/workspaces/${ws.id}/members`)
      .send({ user_id: newbie.user.id, role: 'viewer' });
    const list = await authed(owner.token).get(`${BASE}/workspaces/${ws.id}/members`);
    expect(list.status).toBe(200);
    const member = list.body.data.find((m) => m.user_id === newbie.user.id);
    expect(member).toBeDefined();
    expect(member.role).toBeDefined();
  });

  test('rejects adding the same user twice', async () => {
    const owner  = await register();
    const newbie = await register();
    const ws = await createWorkspace(owner.token, 'BUSINESS');
    await authed(owner.token).post(`${BASE}/workspaces/${ws.id}/members`)
      .send({ user_id: newbie.user.id, role: 'viewer' });
    const res = await authed(owner.token).post(`${BASE}/workspaces/${ws.id}/members`)
      .send({ user_id: newbie.user.id, role: 'member' });
    expect(res.status).toBe(409);
  });

  test('non-member cannot list members', async () => {
    const owner    = await register();
    const outsider = await register();
    const ws = await createWorkspace(owner.token, 'BUSINESS');
    const res = await authed(outsider.token).get(`${BASE}/workspaces/${ws.id}/members`);
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('Last owner protection', () => {
  test('last owner cannot be removed', async () => {
    const owner = await register();
    const ws = await createWorkspace(owner.token, 'BUSINESS');
    const list = await authed(owner.token).get(`${BASE}/workspaces/${ws.id}/members`);
    const ownerMember = list.body.data.find((m) => m.role === 'owner');
    expect(ownerMember).toBeDefined();
    const res = await authed(owner.token).delete(`${BASE}/workspaces/${ws.id}/members/${ownerMember.id}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('LAST_OWNER');
  });

  test('last owner cannot be demoted', async () => {
    const owner = await register();
    const ws = await createWorkspace(owner.token, 'BUSINESS');
    const list = await authed(owner.token).get(`${BASE}/workspaces/${ws.id}/members`);
    const ownerMember = list.body.data.find((m) => m.role === 'owner');
    const res = await authed(owner.token).patch(`${BASE}/workspaces/${ws.id}/members/${ownerMember.id}`)
      .send({ role: 'member' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('LAST_OWNER');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('Departments (ORGANIZATION only)', () => {
  test('owner can create department with budget + head_name', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'ORGANIZATION');
    const res = await authed(token).post(`${BASE}/workspaces/${ws.id}/departments`)
      .send({ name: 'Programs', budget: 500000, head_name: 'Alice' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Programs');
    expect(res.body.data.budget).toBe(500000);
    expect(res.body.data.head_name).toBe('Alice');
  });

  test('department response includes utilization_pct and status', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'ORGANIZATION');
    await authed(token).post(`${BASE}/workspaces/${ws.id}/departments`)
      .send({ name: 'Finance', budget: 100000 });
    const res = await authed(token).get(`${BASE}/workspaces/${ws.id}/departments`);
    expect(res.status).toBe(200);
    const dept = res.body.data[0];
    expect(dept).toHaveProperty('utilization_pct');
    expect(dept).toHaveProperty('status');
    expect(dept).toHaveProperty('remaining');
  });

  test('creating dept in PERSONAL workspace is forbidden (no permission)', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'PERSONAL');
    const res = await authed(token).post(`${BASE}/workspaces/${ws.id}/departments`)
      .send({ name: 'Bad' });
    expect([400, 403]).toContain(res.status);
  });

  test('ISOLATION: outsider cannot create dept in another workspace', async () => {
    const alice = await register();
    const bob   = await register();
    const bobWs = await createWorkspace(bob.token, 'ORGANIZATION');
    const res = await authed(alice.token).post(`${BASE}/workspaces/${bobWs.id}/departments`)
      .send({ name: 'Hack' });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('Default categories seeded on creation', () => {
  test('PERSONAL workspace gets INCOME + EXPENSE categories', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'PERSONAL');
    const res = await authed(token).get(`${BASE}/workspaces/${ws.id}/categories`);
    expect(res.status).toBe(200);
    const types = res.body.data.map((c) => c.type);
    expect(types).toContain('INCOME');
    expect(types).toContain('EXPENSE');
  });

  test('categories use type field (not category_type)', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'BUSINESS');
    const res = await authed(token).get(`${BASE}/workspaces/${ws.id}/categories`);
    expect(res.status).toBe(200);
    const cat = res.body.data[0];
    expect(cat).toHaveProperty('type');
    expect(cat).not.toHaveProperty('category_type');
  });
});
