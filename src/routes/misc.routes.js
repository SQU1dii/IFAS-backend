'use strict';
/**
 * Global (non-workspace) routes:
 *   GET  /categories   — reference category templates (for onboarding picklists)
 *   GET  /accounts      — reference account-type options
 *   GET  /notifications — current user's notifications (derived from alerts)
 *   PATCH /notifications/:id/read
 *   POST  /notifications/read-all
 */
const express = require('express');
const authenticate = require('../middleware/authenticate');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const { getKnex } = require('../config/database');
const { ACCOUNT_TYPES } = require('../config/constants');

const router = express.Router();
const db = () => getKnex();

// Reference: category templates grouped by workspace type.
router.get('/categories', authenticate, asyncHandler(async (req, res) => {
  const templates = await db()('category_templates').orderBy('workspace_type').orderBy('sort_order');
  const data = templates.map((t) => ({ id: t.id, name: t.name, type: t.category_type, workspace_type: t.workspace_type }));
  ok(res, data);
}));

// Reference: account type options.
router.get('/accounts', authenticate, asyncHandler(async (req, res) => {
  ok(res, ACCOUNT_TYPES.map((t) => ({ id: t, name: t.replace('_', ' '), type: t })));
}));

// Notifications: derive from the user's open alerts across workspaces (best-effort).
router.get('/notifications', authenticate, asyncHandler(async (req, res) => {
  // Find the user's workspaces
  const memberships = await db()('workspace_members').where({ user_id: req.user.id }).select('workspace_id');
  const wsIds = memberships.map((m) => m.workspace_id);
  let alerts = [];
  if (wsIds.length) {
    alerts = await db()('alerts').whereIn('workspace_id', wsIds).orderBy('created_at', 'desc').limit(50);
  }
  const data = alerts.map((a) => ({
    id: a.id,
    type: (a.alert_type || '').toLowerCase(),
    title: a.reason || 'Alert',
    body: a.reason || '',
    is_read: a.status !== 'OPEN',
    created_at: a.created_at,
    workspace_id: a.workspace_id,
  }));
  ok(res, data);
}));

router.patch('/notifications/:id/read', authenticate, asyncHandler(async (req, res) => {
  // Notifications are derived from alerts; "read" maps to reviewing the alert.
  await db()('alerts').where({ id: Number(req.params.id) }).update({
    status: 'REVIEWED',
    reviewed_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    reviewed_by: req.user.id,
  }).catch(() => {});
  ok(res, {}, null, 'Marked as read.');
}));

router.post('/notifications/read-all', authenticate, asyncHandler(async (req, res) => {
  const memberships = await db()('workspace_members').where({ user_id: req.user.id }).select('workspace_id');
  const wsIds = memberships.map((m) => m.workspace_id);
  if (wsIds.length) {
    await db()('alerts').whereIn('workspace_id', wsIds).where({ status: 'OPEN' }).update({
      status: 'REVIEWED',
      reviewed_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      reviewed_by: req.user.id,
    }).catch(() => {});
  }
  ok(res, {}, null, 'All marked as read.');
}));

module.exports = router;
