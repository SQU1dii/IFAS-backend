/**
 * Auth integration tests — exercises the full Express stack via Supertest
 * against the in-memory mock DB injected by tests/setup.js.
 */
const request = require('supertest');
const { createApp } = require('../../src/app');

const app = createApp();

const BASE = '/api/v1/auth';

const validUser = {
  email: 'alice@ifas.dev',
  password: 'TestPass123!',
  full_name: 'Alice Kamau',
};

// Helper to register and return tokens.
async function registerUser(overrides = {}) {
  const res = await request(app)
    .post(`${BASE}/register`)
    .send({ ...validUser, ...overrides });
  return res;
}

// ── POST /auth/register ───────────────────────────────────────────────────────
describe('POST /auth/register', () => {
  test('201 + tokens on valid input', async () => {
    const res = await registerUser();
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');
    expect(res.body.user).toHaveProperty('id');
    expect(res.body.user).not.toHaveProperty('password_hash');
    expect(res.body.user.email).toBe(validUser.email);
  });

  test('422 on missing full_name', async () => {
    const res = await request(app).post(`${BASE}/register`).send({ email: 'a@b.com', password: 'password123' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('422 on short password', async () => {
    const res = await request(app).post(`${BASE}/register`).send({ ...validUser, password: 'short' });
    expect(res.status).toBe(422);
  });

  test('422 on invalid email', async () => {
    const res = await request(app).post(`${BASE}/register`).send({ ...validUser, email: 'not-email' });
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
    expect(res.body.user.email).toBe('alice@ifas.dev');
  });
});

// ── POST /auth/login ───────────────────────────────────────────────────────────
describe('POST /auth/login', () => {
  beforeEach(async () => {
    await registerUser();
  });

  test('200 + tokens on valid credentials', async () => {
    const res = await request(app).post(`${BASE}/login`).send({ email: validUser.email, password: validUser.password });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');
  });

  test('401 on wrong password', async () => {
    const res = await request(app).post(`${BASE}/login`).send({ email: validUser.email, password: 'WrongPass!' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('401 on unknown email', async () => {
    const res = await request(app).post(`${BASE}/login`).send({ email: 'nobody@ifas.dev', password: 'anything' });
    expect(res.status).toBe(401);
  });

  test('422 on missing password', async () => {
    const res = await request(app).post(`${BASE}/login`).send({ email: validUser.email });
    expect(res.status).toBe(422);
  });
});

// ── GET /auth/me ───────────────────────────────────────────────────────────────
describe('GET /auth/me', () => {
  test('200 returns user without password_hash', async () => {
    const reg = await registerUser();
    const res = await request(app)
      .get(`${BASE}/me`)
      .set('Authorization', `Bearer ${reg.body.access_token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(validUser.email);
    expect(res.body.user).not.toHaveProperty('password_hash');
  });

  test('401 with no token', async () => {
    const res = await request(app).get(`${BASE}/me`);
    expect(res.status).toBe(401);
  });

  test('401 with garbage token', async () => {
    const res = await request(app).get(`${BASE}/me`).set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(401);
  });
});

// ── POST /auth/refresh ─────────────────────────────────────────────────────────
describe('POST /auth/refresh', () => {
  test('200 returns new token pair', async () => {
    const reg = await registerUser();
    const res = await request(app)
      .post(`${BASE}/refresh`)
      .send({ refresh_token: reg.body.refresh_token });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');
    // New refresh token should differ (rotation)
    expect(res.body.refresh_token).not.toBe(reg.body.refresh_token);
  });

  test('401 on invalid refresh_token', async () => {
    const res = await request(app).post(`${BASE}/refresh`).send({ refresh_token: 'bad' });
    expect(res.status).toBe(401);
  });

  test('401 on reused refresh_token (rotation enforced)', async () => {
    const reg = await registerUser();
    await request(app).post(`${BASE}/refresh`).send({ refresh_token: reg.body.refresh_token });
    // Second use of the same token should fail
    const res2 = await request(app).post(`${BASE}/refresh`).send({ refresh_token: reg.body.refresh_token });
    expect(res2.status).toBe(401);
  });

  test('422 on missing refresh_token', async () => {
    const res = await request(app).post(`${BASE}/refresh`).send({});
    expect(res.status).toBe(422);
  });
});

// ── POST /auth/logout ──────────────────────────────────────────────────────────
describe('POST /auth/logout', () => {
  test('200 on valid logout', async () => {
    const reg = await registerUser();
    const res = await request(app)
      .post(`${BASE}/logout`)
      .set('Authorization', `Bearer ${reg.body.access_token}`)
      .send({ refresh_token: reg.body.refresh_token });
    expect(res.status).toBe(200);
  });

  test('refresh token is invalidated after logout', async () => {
    const reg = await registerUser();
    await request(app)
      .post(`${BASE}/logout`)
      .set('Authorization', `Bearer ${reg.body.access_token}`)
      .send({ refresh_token: reg.body.refresh_token });
    const res = await request(app)
      .post(`${BASE}/refresh`)
      .send({ refresh_token: reg.body.refresh_token });
    expect(res.status).toBe(401);
  });

  test('401 with no Bearer token', async () => {
    const res = await request(app).post(`${BASE}/logout`).send({ refresh_token: 'x' });
    expect(res.status).toBe(401);
  });
});
