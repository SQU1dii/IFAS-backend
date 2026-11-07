'use strict';
const authService = require('../services/auth.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');

function ip(req) { return req.ip || req.socket?.remoteAddress || null; }

const register = asyncHandler(async (req, res) => {
  const data = await authService.register(req.body, res, ip(req));
  created(res, data, null, 'Account created.');
});

const login = asyncHandler(async (req, res) => {
  const data = await authService.login(req.body, res, ip(req));
  ok(res, data, null, 'Logged in.');
});

const logout = asyncHandler(async (req, res) => {
  const data = await authService.logout(req, res, ip(req));
  ok(res, data, null, 'Logged out.');
});

const refresh = asyncHandler(async (req, res) => {
  const data = await authService.refresh(req, res, ip(req));
  ok(res, data, null, 'Token refreshed.');
});

const me = asyncHandler(async (req, res) => {
  const data = await authService.me(req.user.id);
  ok(res, data);
});

const updateProfile = asyncHandler(async (req, res) => {
  const data = await authService.updateProfile(req.user.id, req.body);
  ok(res, data, null, 'Profile updated.');
});

const changePassword = asyncHandler(async (req, res) => {
  const data = await authService.changePassword(req.user.id, req.body);
  ok(res, data, null, data.message);
});

const forgotPassword = asyncHandler(async (req, res) => {
  const data = await authService.forgotPassword(req.body.email);
  ok(res, data, null, data.message);
});

const resetPassword = asyncHandler(async (req, res) => {
  const data = await authService.resetPassword(req.body);
  ok(res, data, null, data.message);
});

module.exports = { register, login, logout, refresh, me, updateProfile, changePassword, forgotPassword, resetPassword };
