'use strict';
/**
 * Budget, savings-goal and alert routes.
 * Mounted at /api/v1/workspaces/:workspaceId
 */
const express = require('express');
const authenticate      = require('../middleware/authenticate');
const loadMembership    = require('../middleware/loadMembership');
const requirePermission = require('../middleware/requirePermission');
const validate          = require('../middleware/validate');
const asyncHandler      = require('../utils/asyncHandler');
const budgetSvc         = require('../services/budget.service');
const alertRepo         = require('../repositories/alertRepository');
const V                 = require('../validators/budget.validators');
const { notFound }      = require('../utils/errors');

const router = express.Router({ mergeParams: true });
const guard  = [authenticate, loadMembership];
const wsId   = (req) => Number(req.params.workspaceId);
const ws     = (req) => req.workspace;

// ── Budgets ───────────────────────────────────────────────────────────────────
router.get(   '/budgets',          ...guard, requirePermission('budgets.manage'), asyncHandler(async (req, res) => res.json({ budgets: await budgetSvc.listBudgets(wsId(req)) })));
router.post(  '/budgets',          ...guard, requirePermission('budgets.manage'), validate(V.createBudgetSchema), asyncHandler(async (req, res) => res.status(201).json({ budget: await budgetSvc.createBudget(wsId(req), req.body) })));
router.get(   '/budgets/:budgetId/status', ...guard, requirePermission('budgets.manage'), asyncHandler(async (req, res) => res.json({ status: await budgetSvc.getBudgetStatus(wsId(req), Number(req.params.budgetId)) })));
router.patch( '/budgets/:budgetId', ...guard, requirePermission('budgets.manage'), validate(V.updateBudgetSchema), asyncHandler(async (req, res) => res.json({ budget: await budgetSvc.updateBudget(wsId(req), Number(req.params.budgetId), req.body) })));
router.delete('/budgets/:budgetId', ...guard, requirePermission('budgets.manage'), asyncHandler(async (req, res) => { await budgetSvc.deleteBudget(wsId(req), Number(req.params.budgetId)); res.json({ message: 'Budget deleted.' }); }));

// ── Savings Goals ─────────────────────────────────────────────────────────────
router.get(   '/goals',         ...guard, requirePermission('goals.manage'), asyncHandler(async (req, res) => res.json({ goals: await budgetSvc.listGoals(wsId(req), ws(req).workspace_type) })));
router.post(  '/goals',         ...guard, requirePermission('goals.manage'), validate(V.createGoalSchema), asyncHandler(async (req, res) => res.status(201).json({ goal: await budgetSvc.createGoal(wsId(req), ws(req).workspace_type, req.body) })));
router.patch( '/goals/:goalId', ...guard, requirePermission('goals.manage'), validate(V.updateGoalSchema),  asyncHandler(async (req, res) => res.json({ goal: await budgetSvc.updateGoal(wsId(req), ws(req).workspace_type, Number(req.params.goalId), req.body) })));
router.delete('/goals/:goalId', ...guard, requirePermission('goals.manage'), asyncHandler(async (req, res) => { await budgetSvc.deleteGoal(wsId(req), ws(req).workspace_type, Number(req.params.goalId)); res.json({ message: 'Goal deleted.' }); }));

// ── Alerts ────────────────────────────────────────────────────────────────────
router.get('/alerts', ...guard, requirePermission('alerts.review'), asyncHandler(async (req, res) => {
  const alerts = await alertRepo.list(wsId(req), { status: req.query.status });
  res.json({ alerts });
}));

router.patch('/alerts/:alertId/review', ...guard, requirePermission('alerts.review'), asyncHandler(async (req, res) => {
  const alert = await alertRepo.findById(wsId(req), Number(req.params.alertId));
  if (!alert) throw notFound('Alert not found.', 'ALERT_NOT_FOUND');
  await alertRepo.update(alert.id, { status: 'REVIEWED', reviewed_at: new Date().toISOString().slice(0, 19).replace('T', ' '), reviewed_by: req.user.id });
  res.json({ alert: await alertRepo.findById(wsId(req), alert.id) });
}));

router.patch('/alerts/:alertId/dismiss', ...guard, requirePermission('alerts.review'), asyncHandler(async (req, res) => {
  const alert = await alertRepo.findById(wsId(req), Number(req.params.alertId));
  if (!alert) throw notFound('Alert not found.', 'ALERT_NOT_FOUND');
  await alertRepo.update(alert.id, { status: 'DISMISSED', reviewed_at: new Date().toISOString().slice(0, 19).replace('T', ' '), reviewed_by: req.user.id });
  res.json({ alert: await alertRepo.findById(wsId(req), alert.id) });
}));

module.exports = router;
