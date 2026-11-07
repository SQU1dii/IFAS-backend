'use strict';
/**
 * Budget, savings-goal, alert and recommendation routes.
 * Mounted at /api/v1/workspaces/:workspaceId
 *
 * Budgets:           GET /budgets/status · GET/POST /budgets · GET/PATCH/DELETE /budgets/:id
 * Savings Goals:     GET/POST /savings-goals · GET/PATCH/DELETE /savings-goals/:id
 *                    GET/POST /savings-goals/:id/contributions
 * Alerts:            GET /alerts · PATCH /alerts/:id (body {action}) · PATCH /alerts/:id/review · /dismiss
 * Recommendations:    GET /recommendations · POST /recommendations/refresh · DELETE /recommendations/:id
 */
const express = require('express');
const authenticate      = require('../middleware/authenticate');
const loadMembership    = require('../middleware/loadMembership');
const requirePermission = require('../middleware/requirePermission');
const validate          = require('../middleware/validate');
const ctrl              = require('../controllers/budget.controller');
const V                 = require('../validators/budget.validators');

const router = express.Router({ mergeParams: true });
const guard  = [authenticate, loadMembership];
const wsId   = (req) => Number(req.params.workspaceId);

// ── Budgets ───────────────────────────────────────────────────────────────────
router.get(   '/budgets/status',        ...guard, requirePermission('budgets.manage'), ctrl.listBudgetsStatus);
router.get(   '/budgets/:budgetId',      ...guard, requirePermission('budgets.manage'), ctrl.getBudget);
router.post(  '/budgets',              ...guard, requirePermission('budgets.manage'), validate(V.createBudgetSchema), ctrl.createBudget);
router.patch( '/budgets/:budgetId',    ...guard, requirePermission('budgets.manage'), validate(V.updateBudgetSchema), ctrl.updateBudget);
router.delete('/budgets/:budgetId',    ...guard, requirePermission('budgets.manage'), ctrl.deleteBudget);
// legacy: budget status by id (kept for API compatibility)
router.get(   '/budgets/:budgetId/status', ...guard, requirePermission('budgets.manage'), ctrl.getBudget);

// ── Savings Goals ─────────────────────────────────────────────────────────────
router.get(   '/savings-goals',          ...guard, requirePermission('goals.manage'), ctrl.listGoals);
router.post(  '/savings-goals',          ...guard, requirePermission('goals.manage'), validate(V.createGoalSchema), ctrl.createGoal);
router.get(   '/savings-goals/:goalId',  ...guard, requirePermission('goals.manage'), ctrl.getGoal);
router.patch( '/savings-goals/:goalId',  ...guard, requirePermission('goals.manage'), validate(V.updateGoalSchema), ctrl.updateGoal);
router.delete('/savings-goals/:goalId',  ...guard, requirePermission('goals.manage'), ctrl.deleteGoal);
router.get(   '/savings-goals/:goalId/contributions', ...guard, requirePermission('goals.manage'), ctrl.listContributions);
router.post(  '/savings-goals/:goalId/contributions', ...guard, requirePermission('goals.manage'), ctrl.addContribution);

// legacy alias: /goals
router.get(   '/goals',         ...guard, requirePermission('goals.manage'), ctrl.listGoals);
router.post(  '/goals',         ...guard, requirePermission('goals.manage'), validate(V.createGoalSchema), ctrl.createGoal);
router.patch( '/goals/:goalId', ...guard, requirePermission('goals.manage'), validate(V.updateGoalSchema), ctrl.updateGoal);
router.delete('/goals/:goalId', ...guard, requirePermission('goals.manage'), ctrl.deleteGoal);

// ── Alerts ────────────────────────────────────────────────────────────────────
router.get(   '/alerts',                    ...guard, requirePermission('alerts.review'), ctrl.listAlerts);
router.patch( '/alerts/:alertId',           ...guard, requirePermission('alerts.review'), ctrl.updateAlert);
router.patch( '/alerts/:alertId/review',   ...guard, requirePermission('alerts.review'), ctrl.reviewAlert);
router.patch( '/alerts/:alertId/dismiss',  ...guard, requirePermission('alerts.review'), ctrl.dismissAlert);

// ── Recommendations ───────────────────────────────────────────────────────────
router.get(   '/recommendations',            ...guard, requirePermission('analytics.view'), ctrl.listRecommendations);
router.post(  '/recommendations/refresh',     ...guard, requirePermission('analytics.view'), ctrl.refreshRecommendations);
router.delete('/recommendations/:recId',     ...guard, requirePermission('analytics.view'), ctrl.dismissRecommendation);

module.exports = router;
