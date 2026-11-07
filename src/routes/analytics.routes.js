'use strict';
/**
 * Analytics / dashboard / intelligence / reports / assistant routes.
 * Mounted at /api/v1/workspaces/:workspaceId
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const authenticate      = require('../middleware/authenticate');
const loadMembership    = require('../middleware/loadMembership');
const requirePermission = require('../middleware/requirePermission');
const asyncHandler      = require('../utils/asyncHandler');
const ctrl              = require('../controllers/analytics.controller');

const router = express.Router({ mergeParams: true });
const guard  = [authenticate, loadMembership];

// ── Dashboard ────────────────────────────────────────────────────────────────
router.get('/dashboard', ...guard, requirePermission('dashboard.view'), ctrl.getDashboard);

// ── Analytics ──────────────────────────────────────────────────────────────────
router.get('/analytics/monthly',          ...guard, requirePermission('analytics.view'), ctrl.getMonthly);
router.get('/analytics/categories',       ...guard, requirePermission('analytics.view'), ctrl.getCategoryAnalytics);
router.get('/analytics/cash-flow',        ...guard, requirePermission('analytics.view'), ctrl.getCashFlow);
router.get('/analytics/budget-performance',...guard, requirePermission('analytics.view'), ctrl.getBudgetPerformance);
router.get('/analytics/savings-trends',   ...guard, requirePermission('analytics.view'), ctrl.getSavingsTrends);

// ── Intelligence ────────────────────────────────────────────────────────────────
router.get('/insights',  ...guard, requirePermission('analytics.view'), ctrl.getInsights);
router.get('/forecast',  ...guard, requirePermission('analytics.view'), ctrl.getForecast);
router.get('/anomalies', ...guard, requirePermission('analytics.view'), ctrl.getAnomalies);
router.get('/patterns',  ...guard, requirePermission('analytics.view'), ctrl.getSpendingPatterns);

// ── Reports ───────────────────────────────────────────────────────────────────
router.get('/reports', ...guard, requirePermission('reports.generate'), ctrl.getReports);

// ── Assistant (rate-limited) ───────────────────────────────────────────────────
const assistantLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many assistant requests. Please wait a minute.', fields: null } },
  skip: () => process.env.NODE_ENV === 'test',
});

router.post('/assistant/messages',           assistantLimiter, ...guard, requirePermission('assistant.use'), ctrl.sendMessage);
router.get( '/assistant/conversations',      ...guard, requirePermission('assistant.use'), ctrl.listConversations);
router.get( '/assistant/conversations/:convId', ...guard, requirePermission('assistant.use'), ctrl.getConversation);

module.exports = router;
