/**
 * Auth service — register, login, logout, refresh, me.
 *
 * Design decisions:
 * - bcryptjs (pure-JS, no native build) is hash-compatible with native bcrypt.
 * - Access tokens: short-lived JWT (default 15 min). No DB hit on verification.
 * - Refresh tokens: random 64-byte hex, SHA-256 hashed before storage, so a
 *   stolen DB dump cannot replay tokens. One DB read required per refresh.
 * - Logout revokes the supplied refresh token only (single-device). A
 *   platform-admin "revoke all" wipes every session for a user.
 */
const bcrypt = require('bcryptjs');
const config = require('../config');
const userRepo = require('../repositories/userRepository');
const tokenRepo = require('../repositories/tokenRepository');
const audit = require('../repositories/auditRepository');
const { signAccessToken, verifyAccessToken, generateRefreshToken, refreshExpiresAt } = require('../utils/jwt');
const { conflict, unauthorized, badRequest } = require('../utils/errors');

async function register({ email, password, full_name, phone }, ipAddress) {
  const existing = await userRepo.findByEmail(email);
  if (existing) throw conflict('An account with that email already exists.', { email: 'Already registered' }, 'EMAIL_TAKEN');

  const password_hash = await bcrypt.hash(password, config.auth.bcryptRounds);
  const user = await userRepo.create({ email, password_hash, full_name, phone });

  const access_token = signAccessToken(user);
  const raw_refresh = generateRefreshToken();
  await tokenRepo.create({ user_id: user.id, raw_token: raw_refresh, expires_at: refreshExpiresAt() });

  await audit.log({ user_id: user.id, action: 'auth.register', entity_type: 'user', entity_id: user.id, ip_address: ipAddress });

  return { user: userRepo.sanitise(user), access_token, refresh_token: raw_refresh };
}

async function login({ email, password }, ipAddress) {
  const user = await userRepo.findByEmail(email);
  const valid = user && await bcrypt.compare(password, user.password_hash);

  // Same error for unknown email and wrong password — never leak which.
  if (!valid) {
    await audit.log({ user_id: user?.id ?? null, action: 'auth.login.failed', ip_address: ipAddress, metadata: { email } });
    throw unauthorized('Invalid email or password.', 'INVALID_CREDENTIALS');
  }
  if (!user.is_active) throw unauthorized('This account has been deactivated.', 'ACCOUNT_INACTIVE');

  const access_token = signAccessToken(user);
  const raw_refresh = generateRefreshToken();
  await tokenRepo.create({ user_id: user.id, raw_token: raw_refresh, expires_at: refreshExpiresAt() });

  await audit.log({ user_id: user.id, action: 'auth.login', entity_type: 'user', entity_id: user.id, ip_address: ipAddress });

  return { user: userRepo.sanitise(user), access_token, refresh_token: raw_refresh };
}

async function logout(raw_refresh_token, userId, ipAddress) {
  if (!raw_refresh_token) throw badRequest('refresh_token required to logout.', null, 'MISSING_TOKEN');
  await tokenRepo.revoke(raw_refresh_token);
  await audit.log({ user_id: userId, action: 'auth.logout', entity_type: 'user', entity_id: userId, ip_address: ipAddress });
}

async function refresh(raw_refresh_token, ipAddress) {
  if (!raw_refresh_token) throw badRequest('refresh_token required.', null, 'MISSING_TOKEN');

  const stored = await tokenRepo.findByRaw(raw_refresh_token);
  if (!stored) throw unauthorized('Refresh token is invalid or expired.', 'INVALID_REFRESH_TOKEN');

  const user = await userRepo.findById(stored.user_id);
  if (!user || !user.is_active) throw unauthorized('Account not found or deactivated.', 'ACCOUNT_INACTIVE');

  // Rotate: revoke old token, issue new pair.
  await tokenRepo.revoke(raw_refresh_token);
  const access_token = signAccessToken(user);
  const new_raw_refresh = generateRefreshToken();
  await tokenRepo.create({ user_id: user.id, raw_token: new_raw_refresh, expires_at: refreshExpiresAt() });

  await audit.log({ user_id: user.id, action: 'auth.refresh', entity_type: 'user', entity_id: user.id, ip_address: ipAddress });

  return { access_token, refresh_token: new_raw_refresh };
}

async function me(userId) {
  const user = await userRepo.findById(userId);
  if (!user) throw unauthorized('User not found.', 'USER_NOT_FOUND');
  return userRepo.sanitise(user);
}

module.exports = { register, login, logout, refresh, me };
