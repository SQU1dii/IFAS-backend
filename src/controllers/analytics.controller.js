'use strict';
/**
 * Dashboard, analytics, intelligence, reports & assistant controller.
 * All workspace-scoped (mounted under /workspaces/:workspaceId).
 */
const dashSvc      = require('../services/dashboard.service');
const analyticsSvc = require('../services/analytics.service');
const assistantSvc = require('../services/assistant.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const { ROLES } = require('../config/constants');
const { stringify } = require('csv-stringify/sync');
const { badRequest } = require('../utils/errors');

const wsId = (req) => Number(req.params.workspaceId);
const deptScope = (req) => req.membership && req.membership.role_name === ROLES.ORG_DEPT_HEAD ? req.membership.department_id : null;

// ── Dashboard ───────────────────────────────────────────────────────────────
const getDashboard = asyncHandler(async (req, res) => {
  const data = await dashSvc.getDashboard(req.workspace, req.membership, {
    from: req.query.from, to: req.query.to,
  });
  ok(res, data);
});

// ── Analytics ────────────────────────────────────────────────────────────────
const getMonthly = asyncHandler(async (req, res) => {
  const data = await analyticsSvc.getMonthly(wsId(req), req.query, deptScope(req));
  ok(res, data);
});
const getCategoryAnalytics = asyncHandler(async (req, res) => {
  const data = await analyticsSvc.getCategoryAnalytics(wsId(req), req.query, deptScope(req));
  ok(res, data);
});
const getCashFlow = asyncHandler(async (req, res) => {
  const data = await analyticsSvc.getCashFlow(wsId(req), req.query, deptScope(req));
  ok(res, data);
});
const getBudgetPerformance = asyncHandler(async (req, res) => {
  const data = await analyticsSvc.getBudgetPerformance(wsId(req), req.query);
  ok(res, data);
});
const getSavingsTrends = asyncHandler(async (req, res) => {
  const data = await analyticsSvc.getSavingsTrends(wsId(req));
  ok(res, data);
});

// ── Intelligence ─────────────────────────────────────────────────────────────
const getInsights = asyncHandler(async (req, res) => {
  const data = await analyticsSvc.getInsights(wsId(req), req.query, deptScope(req));
  ok(res, data);
});
const getForecast = asyncHandler(async (req, res) => {
  const horizon = Math.min(12, Math.max(1, Number(req.query.horizon ?? req.query.horizon_months ?? 3)));
  const data = await analyticsSvc.forecast(wsId(req), req.query.category_id ? Number(req.query.category_id) : null, horizon);
  ok(res, data);
});
const getAnomalies = asyncHandler(async (req, res) => {
  const data = await analyticsSvc.getAnomalies(wsId(req), req.query, deptScope(req));
  ok(res, data);
});
const getSpendingPatterns = asyncHandler(async (req, res) => {
  const data = await analyticsSvc.getSpendingPatterns(wsId(req), req.query, deptScope(req));
  ok(res, data);
});

// ── Reports ──────────────────────────────────────────────────────────────────
const getReports = asyncHandler(async (req, res) => {
  const type = req.query.type || 'summary';
  const format = req.query.format;

  if (type === 'full' && format === 'csv') {
    // Raw CSV download (no envelope — window.open on the frontend).
    const rows = await analyticsSvc.getMonthly(wsId(req), { months: 24 }, deptScope(req));
    const csv = stringify(rows, { header: true });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="ifas-report-${wsId(req)}.csv"`);
    return res.send(csv);
  }

  const data = await analyticsSvc.getReportSummary(wsId(req), req.query, deptScope(req));
  ok(res, data);
});

// ── Assistant ─────────────────────────────────────────────────────────────────
const sendMessage = asyncHandler(async (req, res) => {
  const { content, conversation_id } = req.body;
  if (!content) throw badRequest('content is required.', { content: 'Required' });
  const result = await assistantSvc.sendMessage(req.workspace, req.user.id, req.membership, content, conversation_id ?? null);
  ok(res, result, null, 'Message sent.');
});
const listConversations = asyncHandler(async (req, res) => {
  const data = await assistantSvc.listConversations(wsId(req), req.user.id);
  ok(res, data);
});
const getConversation = asyncHandler(async (req, res) => {
  const data = await assistantSvc.getConversation(wsId(req), req.user.id, Number(req.params.convId));
  ok(res, data);
});

module.exports = {
  getDashboard,
  getMonthly, getCategoryAnalytics, getCashFlow, getBudgetPerformance, getSavingsTrends,
  getInsights, getForecast, getAnomalies, getSpendingPatterns,
  getReports,
  sendMessage, listConversations, getConversation,
};
