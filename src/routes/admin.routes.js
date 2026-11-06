'use strict';
/**
 * Platform administrator routes — /api/v1/admin
 * Platform admins can manage user accounts and platform settings ONLY.
 * They cannot read or write any workspace's financial data.
 */
const express      = require('express');
const authenticate = require('../middleware/authenticate');
const { requirePlatformAdmin } = require('../middleware/requirePermission');
const asyncHandler = require('../utils/asyncHandler');
const { getKnex }  = require('../config/database');
const audit        = require('../repositories/auditRepository');
const { notFound } = require('../utils/errors');

const router = express.Router();
const guard  = [authenticate, requirePlatformAdmin];
const db     = () => getKnex();

// List all users (no financial data)
router.get('/users', ...guard, asyncHandler(async (req, res) => {
  const users = await db()('users').select('id', 'email', 'full_name', 'phone', 'is_active', 'is_platform_admin', 'created_at');
  res.json({ users });
}));

// Deactivate / reactivate a user
router.patch('/users/:userId', ...guard, asyncHandler(async (req, res) => {
  const userId = Number(req.params.userId);
  const user   = await db()('users').where({ id: userId }).first();
  if (!user) throw notFound('User not found.', 'USER_NOT_FOUND');
  const allowed = ['is_active', 'full_name', 'phone'];
  const patch   = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(patch).length) return res.json({ user });
  await db()('users').where({ id: userId }).update(patch);
  const updated = await db()('users').where({ id: userId }).select('id','email','full_name','phone','is_active','is_platform_admin','created_at').first();
  await audit.log({ user_id: req.user.id, action: 'admin.user.update', entity_type: 'user', entity_id: userId, metadata: patch, ip_address: req.ip });
  res.json({ user: updated });
}));

// Audit log viewer (last 200 entries)
router.get('/audit-log', ...guard, asyncHandler(async (req, res) => {
  const logs = await db()('audit_log').orderBy('created_at', 'desc').limit(200)
    .select('id','workspace_id','user_id','action','entity_type','entity_id','ip_address','created_at');
  res.json({ audit_log: logs });
}));

module.exports = router;
