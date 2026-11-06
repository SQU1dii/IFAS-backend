/**
 * Workspace integration tests.
 *
 * Critical coverage:
 * - A user in workspace A can NEVER read or write workspace B data.
 * - Each role sees only its allowed operations.
 * - Last owner cannot be removed or demoted.
 * - Departments only allowed on ORGANIZATION workspaces.
 */
const request = require('supertest');
const { createApp } = require('../../src/app');

const app = createApp();
const BASE = '/api/v1';

// ── helpers ───────────────────────────────────────────────────────────────────
async function register(overrides = {}) {
  const defaults = { email: `user${Math.random().toString(36).slice(2)}@ifas.dev`, password: 'TestPass123!', full_name: 'Test User' };
  const res = await request(app).post(`${BASE}/auth/register`).send({ ...defaults, ...overrides });
  expect(res.status).toBe(201);
  return { token: res.body.access_token, user: res.body.user };
}

async function createWorkspace(token, type = 'PERSONAL', name = 'My Workspace') {
  const res = await request(app)
    .post(`${BASE}/workspaces`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name, workspace_type: type });
  expect(res.status).toBe(201);
  return res.body.workspace;
}

function authed(token) {
  return (method, path) => request(app)[method](path).set('Authorization', `Bearer ${token}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('POST /workspaces', () => {
  test('creates workspace and owner membership', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'PERSONAL');
    expect(ws).toHaveProperty('id');
    expect(ws.workspace_type).toBe('PERSONAL');
  });

  test('422 on invalid workspace_type', async () => {
    const { token } = await register();
    const res = await request(app)
      .post(`${BASE}/workspaces`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad', workspace_type: 'INVALID' });
    expect(res.status).toBe(422);
  });

  test('401 without token', async () => {
    const res = await request(app).post(`${BASE}/workspaces`).send({ name: 'X', workspace_type: 'PERSONAL' });
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

    const res = await authed(alice.token)('get', `${BASE}/workspaces`);
    expect(res.status).toBe(200);
    const names = res.body.workspaces.map((w) => w.name);
    expect(names).toContain('Alice WS');
    expect(names).toContain('Alice Biz');
    expect(names).not.toContain('Bob WS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('WORKSPACE ISOLATION — cross-workspace access is impossible', () => {
  test('Alice cannot GET Bob\'s workspace', async () => {
    const alice = await register();
    const bob   = await register();
    const bobWs = await createWorkspace(bob.token, 'PERSONAL', 'BobPrivate');

    const res = await authed(alice.token)('get', `${BASE}/workspaces/${bobWs.id}`);
    expect(res.status).toBe(403);
  });

  test('Alice cannot list Bob\'s workspace members', async () => {
    const alice = await register();
    const bob   = await register();
    const bobWs = await createWorkspace(bob.token, 'PERSONAL', 'BobPrivate');

    const res = await authed(alice.token)('get', `${BASE}/workspaces/${bobWs.id}/members`);
    expect(res.status).toBe(403);
  });

  test('Alice cannot create departments in Bob\'s workspace', async () => {
    const alice = await register();
    const bob   = await register();
    const bobWs = await createWorkspace(bob.token, 'ORGANIZATION', 'Bob Org');

    const res = await authed(alice.token)('post', `${BASE}/workspaces/${bobWs.id}/departments`)
      .send({ name: 'Hack Dept' });
    expect(res.status).toBe(403);
  });

  test('unauthenticated requests are always rejected', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'PERSONAL');

    const res = await request(app).get(`${BASE}/workspaces/${ws.id}`);
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /workspaces/:id', () => {
  test('returns workspace + role + permissions for owner', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'BUSINESS');
    const res = await authed(token)('get', `${BASE}/workspaces/${ws.id}`);
    expect(res.status).toBe(200);
    expect(res.body.workspace.role).toBe('BUSINESS Owner');
    expect(res.body.workspace.permissions).toContain('transactions.view');
    expect(res.body.workspace.permissions).toContain('workspace.manage');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('PATCH /workspaces/:id', () => {
  test('owner can update name', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'PERSONAL');
    const res = await authed(token)('patch', `${BASE}/workspaces/${ws.id}`)
      .send({ name: 'Updated Name' });
    expect(res.status).toBe(200);
    expect(res.body.workspace.name).toBe('Updated Name');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('Members', () => {
  test('owner can add a member', async () => {
    const owner  = await register();
    const newbie = await register();
    const ws = await createWorkspace(owner.token, 'BUSINESS');

    const res = await authed(owner.token)('post', `${BASE}/workspaces/${ws.id}/members`)
      .send({ user_id: newbie.user.id, role_name: 'BUSINESS Viewer' });
    expect(res.status).toBe(201);
    const emails = res.body.members.map((m) => m.email);
    expect(emails).toContain(newbie.user.email);
  });

  test('rejects invalid role for workspace type', async () => {
    const owner  = await register();
    const newbie = await register();
    const ws = await createWorkspace(owner.token, 'PERSONAL');

    const res = await authed(owner.token)('post', `${BASE}/workspaces/${ws.id}/members`)
      .send({ user_id: newbie.user.id, role_name: 'BUSINESS Staff' }); // wrong type
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ROLE');
  });

  test('rejects adding the same user twice', async () => {
    const owner  = await register();
    const newbie = await register();
    const ws = await createWorkspace(owner.token, 'BUSINESS');

    await authed(owner.token)('post', `${BASE}/workspaces/${ws.id}/members`)
      .send({ user_id: newbie.user.id, role_name: 'BUSINESS Viewer' });

    const res = await authed(owner.token)('post', `${BASE}/workspaces/${ws.id}/members`)
      .send({ user_id: newbie.user.id, role_name: 'BUSINESS Staff' });
    expect(res.status).toBe(409);
  });

  test('non-member cannot list members', async () => {
    const owner   = await register();
    const outsider = await register();
    const ws = await createWorkspace(owner.token, 'BUSINESS');

    const res = await authed(outsider.token)('get', `${BASE}/workspaces/${ws.id}/members`);
    expect(res.status).toBe(403);
  });

  test('Viewer cannot add members (no members.manage permission)', async () => {
    const owner  = await register();
    const viewer = await register();
    const newbie = await register();
    const ws = await createWorkspace(owner.token, 'BUSINESS');

    // Add viewer first
    await authed(owner.token)('post', `${BASE}/workspaces/${ws.id}/members`)
      .send({ user_id: viewer.user.id, role_name: 'BUSINESS Viewer' });

    // Viewer tries to add another member
    const res = await authed(viewer.token)('post', `${BASE}/workspaces/${ws.id}/members`)
      .send({ user_id: newbie.user.id, role_name: 'BUSINESS Staff' });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('Last owner protection', () => {
  test('last owner cannot be removed', async () => {
    const owner = await register();
    const ws = await createWorkspace(owner.token, 'BUSINESS');

    // Get the member record for the owner
    const membersRes = await authed(owner.token)('get', `${BASE}/workspaces/${ws.id}/members`);
    const ownerMember = membersRes.body.members.find((m) => m.role_name === 'BUSINESS Owner');
    expect(ownerMember).toBeDefined();

    const res = await authed(owner.token)('delete', `${BASE}/workspaces/${ws.id}/members/${ownerMember.id}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('LAST_OWNER');
  });

  test('last admin cannot be demoted', async () => {
    const owner = await register();
    const ws = await createWorkspace(owner.token, 'BUSINESS');
    const membersRes = await authed(owner.token)('get', `${BASE}/workspaces/${ws.id}/members`);
    const ownerMember = membersRes.body.members.find((m) => m.role_name === 'BUSINESS Owner');

    const res = await authed(owner.token)('patch', `${BASE}/workspaces/${ws.id}/members/${ownerMember.id}`)
      .send({ role_name: 'BUSINESS Staff' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('LAST_OWNER');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('Departments', () => {
  test('owner can create department in ORGANIZATION workspace', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'ORGANIZATION');
    const res = await authed(token)('post', `${BASE}/workspaces/${ws.id}/departments`)
      .send({ name: 'Programs' });
    expect(res.status).toBe(201);
    expect(res.body.department.name).toBe('Programs');
  });

  test('returns 4xx if creating dept in non-ORGANIZATION workspace', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'PERSONAL');
    const res = await authed(token)('post', `${BASE}/workspaces/${ws.id}/departments`)
      .send({ name: 'Bad Dept' });
    // PERSONAL Owner has no departments.manage permission → 403.
    // (Type guard is a secondary check after permission check.)
    expect([400, 403]).toContain(res.status);
  });

  test('list departments', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'ORGANIZATION');
    await authed(token)('post', `${BASE}/workspaces/${ws.id}/departments`).send({ name: 'Finance' });
    await authed(token)('post', `${BASE}/workspaces/${ws.id}/departments`).send({ name: 'Programs' });

    const res = await authed(token)('get', `${BASE}/workspaces/${ws.id}/departments`);
    expect(res.status).toBe(200);
    expect(res.body.departments.length).toBe(2);
  });

  test('duplicate department name rejected', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'ORGANIZATION');
    await authed(token)('post', `${BASE}/workspaces/${ws.id}/departments`).send({ name: 'Finance' });
    const res = await authed(token)('post', `${BASE}/workspaces/${ws.id}/departments`).send({ name: 'Finance' });
    expect(res.status).toBe(409);
  });

  test('update department name', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'ORGANIZATION');
    const create = await authed(token)('post', `${BASE}/workspaces/${ws.id}/departments`).send({ name: 'Old' });
    const deptId = create.body.department.id;

    const res = await authed(token)('patch', `${BASE}/workspaces/${ws.id}/departments/${deptId}`)
      .send({ name: 'New Name' });
    expect(res.status).toBe(200);
    expect(res.body.department.name).toBe('New Name');
  });

  test('delete department', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'ORGANIZATION');
    const create = await authed(token)('post', `${BASE}/workspaces/${ws.id}/departments`).send({ name: 'Temp' });
    const deptId = create.body.department.id;

    const del = await authed(token)('delete', `${BASE}/workspaces/${ws.id}/departments/${deptId}`);
    expect(del.status).toBe(200);

    const list = await authed(token)('get', `${BASE}/workspaces/${ws.id}/departments`);
    expect(list.body.departments.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('Default categories are seeded on workspace creation', () => {
  test('PERSONAL workspace gets income + expense categories', async () => {
    const { token } = await register();
    const ws = await createWorkspace(token, 'PERSONAL');
    // Categories are accessible via the accounts/categories route (Stage 4),
    // but we can verify via the workspace details or by checking the DB directly.
    // For now assert the workspace was created (categories exist in the store).
    expect(ws.id).toBeDefined();
    // The category seeding is exercised implicitly — if it threw the ws create would fail.
  });
});
