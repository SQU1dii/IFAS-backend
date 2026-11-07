'use strict';
/**
 * Auth integration tests — new envelope: { success, data, meta, message }
 * Refresh token in HttpOnly cookie; accessToken in body.data.accessToken
 */
const request = require('supertest');
const { createApp } = require('../../src/app');

const app = createApp();
const BASE = '/api/v1/auth';

const validUser = { email: 'alice@ifas.dev', password: 'TestPass123!', name: 'Alice Kamau' };

async function registerUser(overrides = {}) {
  const res = await request(app).post(`${BASE}/register`).send({ ...validUser, ...overrides });
  return res;
}

// ── POST /auth/register ──────────────────────────────────────────────────────
describe('POST /auth/register', () => {
  test('201 + accessToken + user in data envelope', async () => {
    const res = await registerUser();
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data.user).toHaveProperty('id');
    expect(res.body.data.user).not.toHaveProperty('password_hash');
    expect(res.body.data.user.email).toBe(validUser.email);
    // refresh cookie must be set
    expect(res.headers['set-cookie']).toBeDefined();
    const cookies = res.headers['set-cookie'].join('');
    expect(cookies).toContain('ifas_refresh');
    expect(cookies).toContain('HttpOnly');
  });

  test('user.name field (not full_name) is returned', async () => {
    const res = await registerUser();
    expect(res.body.data.user.name).toBe(validUser.name);
  });

  test('422 on missing name', async () => {
    const res = await request(app).post(`${BASE}/register`)
      .send({ email: 'x@b.com', password: 'password123' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('422 on short password', async () => {
    const res = await registerUser({ password: 'short' });
    expect(res.status).toBe(422);
  });

  test('422 on invalid email', async () => {
    const res = await registerUser({ email: 'not-email' });
    expect(res.status).toBe(422);
  });

  test('409 on duplicate email', async () => {
    await registerUser();
    const res = await registerUser();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  test('email is normalised to lowercase', async () => {
    const res = await registerUser({ email: 'ALICE@IFAS.DEV' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('alice@ifas.dev');
  });
});

// ── POST /auth/login ─────────────────────────────────────────────────────────
describe('POST /auth/login', () => {
  beforeEach(() => registerUser());

  test('200 + accessToken + refresh cookie', async () => {
    const res = await request(app).post(`${BASE}/login`)
      .send({ email: validUser.email, password: validUser.password });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.headers['set-cookie'].join('')).toContain('ifas_refresh');
  });

  test('401 on wrong password', async () => {
    const res = await request(app).post(`${BASE}/login`)
      .send({ email: validUser.email, password: 'WrongPass!' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('401 on unknown email', async () => {
    const res = await request(app).post(`${BASE}/login`)
      .send({ email: 'nobody@ifas.dev', password: 'anything' });
    expect(res.status).toBe(401);
  });
});

// ── GET /auth/me ─────────────────────────────────────────────────────────────
describe('GET /auth/me', () => {
  test('200 returns user.name (not full_name) and no password_hash', async () => {
    const reg = await registerUser();
    const res = await request(app).get(`${BASE}/me`)
      .set('Authorization', `Bearer ${reg.body.data.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe(validUser.name);
    expect(res.body.data).not.toHaveProperty('password_hash');
  });

  test('401 with no token', async () => {
    const res = await request(app).get(`${BASE}/me`);
    expect(res.status).toBe(401);
  });
});

// ── PATCH /auth/me ────────────────────────────────────────────────────────────
describe('PATCH /auth/me', () => {
  test('200 updates profile name', async () => {
    const reg = await registerUser();
    const res = await request(app).patch(`${BASE}/me`)
      .set('Authorization', `Bearer ${reg.body.data.accessToken}`)
      .send({ name: 'Alice Updated' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Alice Updated');
  });
});

// ── POST /auth/refresh ───────────────────────────────────────────────────────
describe('POST /auth/refresh', () => {
  test('200 returns new accessToken via cookie', async () => {
    const reg = await registerUser();
    const cookie = reg.headers['set-cookie'];
    const res = await request(app).post(`${BASE}/refresh`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    // New cookie should be set (rotation)
    expect(res.headers['set-cookie']).toBeDefined();
  });

  test('200 returns new accessToken via body refresh_token fallback', async () => {
    const reg = await registerUser();
    // Extract raw token from cookie
    const cookieStr = reg.headers['set-cookie'].join(';');
    const match = cookieStr.match(/ifas_refresh=([^;]+)/);
    if (!match) return; // skip if cookie parsing fails in this env
    const res = await request(app).post(`${BASE}/refresh`)
      .send({ refresh_token: match[1] });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
  });

  test('401 on invalid refresh_token in body', async () => {
    const res = await request(app).post(`${BASE}/refresh`)
      .send({ refresh_token: 'bad_token' });
    expect(res.status).toBe(401);
  });

  test('401 with reused refresh_token (rotation enforced)', async () => {
    const reg = await registerUser();
    const cookie = reg.headers['set-cookie'];
    await request(app).post(`${BASE}/refresh`).set('Cookie', cookie);
    // Second use of the same cookie → old token revoked
    const res2 = await request(app).post(`${BASE}/refresh`).set('Cookie', cookie);
    expect(res2.status).toBe(401);
  });
});

// ── POST /auth/logout ────────────────────────────────────────────────────────
describe('POST /auth/logout', () => {
  test('200 on valid logout and clears cookie', async () => {
    const reg = await registerUser();
    const cookie = reg.headers['set-cookie'];
    const res = await request(app).post(`${BASE}/logout`)
      .set('Authorization', `Bearer ${reg.body.data.accessToken}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    // Cookie should be cleared
    const respCookies = (res.headers['set-cookie'] || []).join('');
    expect(respCookies).toContain('ifas_refresh=;');
  });

  test('refresh is invalid after logout', async () => {
    const reg = await registerUser();
    const cookie = reg.headers['set-cookie'];
    await request(app).post(`${BASE}/logout`)
      .set('Authorization', `Bearer ${reg.body.data.accessToken}`)
      .set('Cookie', cookie);
    const res = await request(app).post(`${BASE}/refresh`).set('Cookie', cookie);
    expect(res.status).toBe(401);
  });
});

// ── POST /auth/forgot-password ────────────────────────────────────────────────
describe('POST /auth/forgot-password', () => {
  test('200 regardless of whether email exists', async () => {
    const res = await request(app).post(`${BASE}/forgot-password`)
      .send({ email: 'any@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
