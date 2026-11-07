'use strict';
const budgetSvc  = require('../services/budget.service');
const alertRepo  = require('../repositories/alertRepository');
const analyticsSvc = require('../services/analytics.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const { mapBudget, mapSavingsGoal, mapContribution, mapAlert, mapRecommendation } = require('../utils/mappers');
const { notFound } = require('../utils/errors');

const wsId = (req) => Number(req.params.workspaceId);
const wsType = (req) => req.workspace.workspace_type;

// ── Budgets ───────────────────────────────────────────────────────────────────
const listBudgetsStatus = asyncHandler(async (req, res) => {
  const budgets = await budgetSvc.listBudgetsWithStatus(wsId(req));
  ok(res, budgets.map((b) => mapBudget(b, { spent: b.spent, category_name: b.category_name })));
});
const getBudget = asyncHandler(async (req, res) => {
  const b = await budgetSvc.getBudget(wsId(req), Number(req.params.budgetId));
  ok(res, mapBudget(b, { spent: b.spent, category_name: b.category_name }));
});
const createBudget = asyncHandler(async (req, res) => {
  const b = await budgetSvc.createBudget(wsId(req), req.body);
  created(res, mapBudget(b), null, 'Budget created.');
});
const updateBudget = asyncHandler(async (req, res) => {
  const b = await budgetSvc.updateBudget(wsId(req), Number(req.params.budgetId), req.body);
  ok(res, mapBudget(b));
});
const deleteBudget = asyncHandler(async (req, res) => {
  await budgetSvc.deleteBudget(wsId(req), Number(req.params.budgetId));
  ok(res, {}, null, 'Budget deleted.');
});

// ── Savings Goals ───────────────────────────────────────────────────────────────
const listGoals = asyncHandler(async (req, res) => {
  const goals = await budgetSvc.listGoals(wsId(req), wsType(req));
  ok(res, goals.map(mapSavingsGoal));
});
const getGoal = asyncHandler(async (req, res) => {
  const g = await budgetSvc.listGoals(wsId(req), wsType(req));
  const goal = g.find((x) => x.id === Number(req.params.goalId));
  if (!goal) throw notFound('Savings goal not found.', 'GOAL_NOT_FOUND');
  ok(res, mapSavingsGoal(goal));
});
const createGoal = asyncHandler(async (req, res) => {
  // Accept initial_amount (frontend) → saved_amount
  const body = {
    name: req.body.name,
    target_amount: req.body.target_amount,
    saved_amount: req.body.saved_amount ?? req.body.initial_amount ?? 0,
    target_date: req.body.target_date,
    notes: req.body.notes,
  };
  const g = await budgetSvc.createGoal(wsId(req), wsType(req), body);
  created(res, mapSavingsGoal(g), null, 'Savings goal created.');
});
const updateGoal = asyncHandler(async (req, res) => {
  const patch = {};
  if (req.body.name) patch.name = req.body.name;
  if (req.body.target_amount !== undefined) patch.target_amount = req.body.target_amount;
  if (req.body.saved_amount !== undefined) patch.saved_amount = req.body.saved_amount;
  if (req.body.target_date !== undefined) patch.target_date = req.body.target_date;
  if (req.body.notes !== undefined) patch.notes = req.body.notes;
  const g = await budgetSvc.updateGoal(wsId(req), wsType(req), Number(req.params.goalId), patch);
  ok(res, mapSavingsGoal(g));
});
const deleteGoal = asyncHandler(async (req, res) => {
  await budgetSvc.deleteGoal(wsId(req), wsType(req), Number(req.params.goalId));
  ok(res, {}, null, 'Savings goal deleted.');
});

// ── Contributions ───────────────────────────────────────────────────────────────
const listContributions = asyncHandler(async (req, res) => {
  const contribs = await budgetSvc.listContributions(wsId(req), wsType(req), Number(req.params.goalId));
  ok(res, contribs.map(mapContribution));
});
const addContribution = asyncHandler(async (req, res) => {
  const result = await budgetSvc.addContribution(wsId(req), wsType(req), Number(req.params.goalId), req.body);
  created(res, { contribution: mapContribution(result.contribution), goal: mapSavingsGoal(result.goal) }, null, 'Contribution added.');
});

// ── Alerts ─────────────────────────────────────────────────────────────────────
const listAlerts = asyncHandler(async (req, res) => {
  const alerts = await alertRepo.list(wsId(req), { status: req.query.status });
  ok(res, alerts.map(mapAlert));
});
const updateAlert = asyncHandler(async (req, res) => {
  // Frontend sends { action: 'review' | 'dismiss' }
  const action = req.body.action || req.query.action;
  const alert = await alertRepo.findById(wsId(req), Number(req.params.alertId));
  if (!alert) throw notFound('Alert not found.', 'ALERT_NOT_FOUND');
  const newStatus = action === 'dismiss' ? 'DISMISSED' : 'REVIEWED';
  await alertRepo.update(alert.id, {
    status: newStatus,
    reviewed_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    reviewed_by: req.user.id,
  });
  ok(res, mapAlert(await alertRepo.findById(wsId(req), alert.id)));
});
const reviewAlert = asyncHandler(async (req, res) => {
  const alert = await alertRepo.findById(wsId(req), Number(req.params.alertId));
  if (!alert) throw notFound('Alert not found.', 'ALERT_NOT_FOUND');
  await alertRepo.update(alert.id, { status: 'REVIEWED', reviewed_at: new Date().toISOString().slice(0, 19).replace('T', ' '), reviewed_by: req.user.id });
  ok(res, mapAlert(await alertRepo.findById(wsId(req), alert.id)));
});
const dismissAlert = asyncHandler(async (req, res) => {
  const alert = await alertRepo.findById(wsId(req), Number(req.params.alertId));
  if (!alert) throw notFound('Alert not found.', 'ALERT_NOT_FOUND');
  await alertRepo.update(alert.id, { status: 'DISMISSED', reviewed_at: new Date().toISOString().slice(0, 19).replace('T', ' '), reviewed_by: req.user.id });
  ok(res, mapAlert(await alertRepo.findById(wsId(req), alert.id)));
});

// ── Recommendations ─────────────────────────────────────────────────────────────
const listRecommendations = asyncHandler(async (req, res) => {
  const recs = await analyticsSvc.listRecommendations(wsId(req));
  ok(res, recs.map(mapRecommendation));
});
const refreshRecommendations = asyncHandler(async (req, res) => {
  const recs = await analyticsSvc.getRecommendations(wsId(req), wsType(req));
  ok(res, recs.map(mapRecommendation));
});
const dismissRecommendation = asyncHandler(async (req, res) => {
  await analyticsSvc.dismissRecommendation(wsId(req), Number(req.params.recId));
  ok(res, {}, null, 'Recommendation dismissed.');
});

module.exports = {
  listBudgetsStatus, getBudget, createBudget, updateBudget, deleteBudget,
  listGoals, getGoal, createGoal, updateGoal, deleteGoal,
  listContributions, addContribution,
  listAlerts, updateAlert, reviewAlert, dismissAlert,
  listRecommendations, refreshRecommendations, dismissRecommendation,
};
