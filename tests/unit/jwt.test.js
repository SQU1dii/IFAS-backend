const { signAccessToken, verifyAccessToken, generateRefreshToken, refreshExpiresAt } = require('../../src/utils/jwt');

describe('JWT utils', () => {
  const fakeUser = { id: 42, email: 'test@ifas.dev', is_platform_admin: false };

  test('signAccessToken returns a string', () => {
    const token = signAccessToken(fakeUser);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);
  });

  test('verifyAccessToken round-trips the payload', () => {
    const token = signAccessToken(fakeUser);
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe(fakeUser.id);
    expect(payload.email).toBe(fakeUser.email);
    expect(payload.is_platform_admin).toBe(false);
  });

  test('verifyAccessToken throws on tampered token', () => {
    const token = signAccessToken(fakeUser);
    const bad = token.slice(0, -4) + 'XXXX';
    expect(() => verifyAccessToken(bad)).toThrow();
  });

  test('generateRefreshToken returns 128-char hex', () => {
    const t = generateRefreshToken();
    expect(typeof t).toBe('string');
    expect(t.length).toBe(128);
    expect(/^[0-9a-f]+$/.test(t)).toBe(true);
  });

  test('generateRefreshToken produces unique values', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
  });

  test('refreshExpiresAt returns a future date string', () => {
    const exp = refreshExpiresAt();
    expect(new Date(exp).getTime()).toBeGreaterThan(Date.now());
  });
});
