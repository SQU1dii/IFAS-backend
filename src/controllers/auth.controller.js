/**
 * Auth controller — thin; all logic lives in the service.
 * Extracts IP for audit logging without trusting headers that could be spoofed
 * (x-forwarded-for is only used when app.set('trust proxy', 1) is active).
 */
const authService = require('../services/auth.service');
const asyncHandler = require('../utils/asyncHandler');

function getIp(req) {
  return req.ip || req.socket?.remoteAddress || null;
}

const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, getIp(req));
  res.status(201).json(result);
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, getIp(req));
  res.json(result);
});

const logout = asyncHandler(async (req, res) => {
  // refresh_token may come from body or the Authorization header context.
  const raw_refresh = req.body?.refresh_token;
  await authService.logout(raw_refresh, req.user?.id ?? null, getIp(req));
  res.json({ message: 'Logged out successfully.' });
});

const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(req.body?.refresh_token, getIp(req));
  res.json(result);
});

const me = asyncHandler(async (req, res) => {
  const user = await authService.me(req.user.id);
  res.json({ user });
});

module.exports = { register, login, logout, refresh, me };
