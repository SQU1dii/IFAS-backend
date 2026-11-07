'use strict';
/**
 * Auth service — aligned to the frontend contract.
 *
 * Token model:
 *  • Access token: short-lived JWT, returned in the body as `accessToken`.
 *  • Refresh token: random 64-byte hex, SHA-256 hashed in DB, delivered as an
 *    HttpOnly cookie named `ifas_refresh`. The browser sends it automatically;
 *    API clients/tests may also send it in the JSON body.
 *
 * Endpoints:
 *  register / login       → { accessToken, user } + sets refresh cookie
 *  refresh               → { accessToken, user } + rotates cookie
 *  logout                → clears cookie + revokes token
 *  me                    → user
 *  PATCH /auth/me         → update profile (name, phone)
 *  PATCH /auth/me/password → change password (requires current_password)
 *  forgot-password / reset-password → email-reset flow (stub for non-production)
 */
const bcrypt = require('bcryptjs');
const config = require('../config');
const userRepo = require('../repositories/userRepository');
const tokenRepo = require('../repositories/tokenRepository');
const audit = require('../repositories/auditRepository');
const { signAccessToken, verifyAccessToken, generateRefreshToken, refreshExpiresAt } = require('../utils/jwt');
const { setRefreshCookie, clearRefreshCookie, readRefreshToken } = require('../utils/cookies');
const { mapUser } = require('../utils/mappers');
const { conflict, unauthorized, badRequest, notFound } = require('../utils/errors');

async function _issueTokens(res, user, ipAddress) {
  const accessToken = signAccessToken(user);
  const rawRefresh = generateRefreshToken();
  await tokenRepo.create({ user_id: user.id, raw_token: rawRefresh, expires_at: refreshExpiresAt() });
  setRefreshCookie(res, rawRefresh);
  await audit.log({ user_id: user.id, action: 'auth.token_issued', entity_type: 'user', entity_id: user.id, ip_address: ipAddress });
  return { accessToken, user: mapUser(user) };
}

async function register({ email, password, full_name, name, phone }, res, ipAddress) {
  const displayName = full_name || name;
  if (!displayName) throw badRequest('Name is required.', { name: 'Required' });
  const existing = await userRepo.findByEmail(email);
  if (existing) throw conflict('An account with that email already exists.', { email: 'Already registered' }, 'EMAIL_TAKEN');

  const password_hash = await bcrypt.hash(password, config.auth.bcryptRounds);
  const user = await userRepo.create({ email, password_hash, full_name: displayName, phone });
  await audit.log({ user_id: user.id, action: 'auth.register', entity_type: 'user', entity_id: user.id, ip_address: ipAddress });
  return _issueTokens(res, user, ipAddress);
}

async function login({ email, password }, res, ipAddress) {
  const user = await userRepo.findByEmail(email);
  const valid = user && await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    await audit.log({ user_id: user?.id ?? null, action: 'auth.login.failed', ip_address: ipAddress, metadata: { email } });
    throw unauthorized('Invalid email or password.', 'INVALID_CREDENTIALS');
  }
  if (!user.is_active) throw unauthorized('This account has been deactivated.', 'ACCOUNT_INACTIVE');
  await audit.log({ user_id: user.id, action: 'auth.login', entity_type: 'user', entity_id: user.id, ip_address: ipAddress });
  return _issueTokens(res, user, ipAddress);
}

async function logout(req, res, ipAddress) {
  const raw = readRefreshToken(req);
  if (raw) await tokenRepo.revoke(raw);
  clearRefreshCookie(res);
  await audit.log({ user_id: req.user?.id ?? null, action: 'auth.logout', ip_address: ipAddress });
  return {};
}

async function refresh(req, res, ipAddress) {
  const raw = readRefreshToken(req);
  if (!raw) throw unauthorized('Refresh token is missing.', 'MISSING_REFRESH_TOKEN');

  const stored = await tokenRepo.findByRaw(raw);
  if (!stored) throw unauthorized('Refresh token is invalid or expired.', 'INVALID_REFRESH_TOKEN');

  const user = await userRepo.findById(stored.user_id);
  if (!user || !user.is_active) throw unauthorized('Account not found or deactivated.', 'ACCOUNT_INACTIVE');

  // Rotate: revoke old, issue new.
  await tokenRepo.revoke(raw);
  const accessToken = signAccessToken(user);
  const newRaw = generateRefreshToken();
  await tokenRepo.create({ user_id: user.id, raw_token: newRaw, expires_at: refreshExpiresAt() });
  setRefreshCookie(res, newRaw);

  await audit.log({ user_id: user.id, action: 'auth.refresh', entity_type: 'user', entity_id: user.id, ip_address: ipAddress });
  return { accessToken, user: mapUser(user) };
}

async function me(userId) {
  const user = await userRepo.findById(userId);
  if (!user) throw unauthorized('User not found.', 'USER_NOT_FOUND');
  return mapUser(user);
}

async function updateProfile(userId, patch) {
  const user = await userRepo.findById(userId);
  if (!user) throw notFound('User not found.', 'USER_NOT_FOUND');
  const allowed = {};
  if (patch.name || patch.full_name) allowed.full_name = patch.name || patch.full_name;
  if (patch.phone !== undefined) allowed.phone = patch.phone;
  if (!Object.keys(allowed).length) return mapUser(user);
  const updated = await userRepo.update(userId, allowed);
  return mapUser(updated);
}

async function changePassword(userId, { current_password, new_password }) {
  if (!new_password || new_password.length < 8) throw badRequest('New password must be at least 8 characters.', { new_password: 'Min 8 chars' });
  const user = await userRepo.findById(userId);
  if (!user) throw notFound('User not found.', 'USER_NOT_FOUND');
  const valid = await bcrypt.compare(current_password || '', user.password_hash);
  if (!valid) throw unauthorized('Current password is incorrect.', 'WRONG_PASSWORD');
  const password_hash = await bcrypt.hash(new_password, config.auth.bcryptRounds);
  await userRepo.update(userId, { password_hash });
  // Revoke all sessions — user must log in again.
  await tokenRepo.revokeAllForUser(userId);
  return { message: 'Password updated. Please log in again.' };
}

async function forgotPassword(email) {
  // Never reveal whether the email exists.
  const user = await userRepo.findByEmail(email);
  if (user) {
    await audit.log({ user_id: user.id, action: 'auth.forgot_password', entity_type: 'user', entity_id: user.id });
    // In production: generate a single-use reset token, email it. Stubbed here.
  }
  return { message: 'If an account exists for that email, a reset link has been sent.' };
}

async function resetPassword({ token, password }) {
  if (!token || !password || password.length < 8) {
    throw badRequest('Invalid or expired reset token.', { token: 'Invalid' });
  }
  // Stub: a real implementation would verify the reset token against a store.
  // For now, accept and instruct the user to log in. (Wire a token store before production.)
  return { message: 'Password updated. You can now sign in.' };
}

module.exports = { register, login, logout, refresh, me, updateProfile, changePassword, forgotPassword, resetPassword };
