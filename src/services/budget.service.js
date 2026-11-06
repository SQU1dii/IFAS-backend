'use strict';
/**
 * Budget & savings-goals service.
 * Full implementation in Stage 6. recalcAlerts is called by transaction.service
 * and import.service; it is a no-op stub here until Stage 6 is built.
 */
const { getKnex }   = require('../config/database');
const alertRepo     = require('../repositories/alertRepository');
const txnRepo       = require('../repositories/transactionRepository');
const { notFound, badRequest } = require('../utils/errors');

const db = () => getKnex();

// ── Stub — Stage 6 fills this in ─────────────────────────────────────────────
async function recalcAlerts(wsId, categoryId, departmentId, refDate) {
  /* Stage 6 will query budgets whose period covers refDate and compare
     actual spend to amount_limit, raising BUDGET_THRESHOLD / OVER_BUDGET alerts. */
  try {
    const budgets = await db()('budgets')
      .where({ workspace_id: wsId })
      .where('period_start', '<=', refDate)
      .where('period_end',   '>=', refDate);

    for (const budget of budgets) {
      // Only recalc budgets that match the changed category/dept
      if (budget.category_id   && budget.category_id   !== categoryId)   continue;
      if (budget.department_id && budget.department_id !== departmentId)  continue;

      const spent = await txnRepo.sumExpenses(wsId, {
        categoryId:   budget.category_id   || undefined,
        departmentId: budget.department_id || undefined,
        dateFrom:     budget.period_start,
        dateTo:       budget.period_end,
      });

      const pct = (spent / budget.amount_limit) * 100;
      const threshold = budget.alert_threshold ?? 80;

      if (pct >= 100) {
        await _upsertAlert(wsId, budget.id, 'OVER_BUDGET', 'HIGH',
          `Budget exceeded: ${spent.toFixed(2)} / ${budget.amount_limit} (${pct.toFixed(0)}%)`);
      } else if (pct >= threshold) {
        await _upsertAlert(wsId, budget.id, 'BUDGET_THRESHOLD', 'MEDIUM',
          `Budget at ${pct.toFixed(0)}%: ${spent.toFixed(2)} / ${budget.amount_limit}`);
      }
    }
  } catch { /* never break the caller */ }
}

async function _upsertAlert(wsId, budgetId, alertType, severity, reason) {
  // Avoid duplicate OPEN alerts for the same budget + type
  const existing = await db()('alerts')
    .where({ workspace_id: wsId, budget_id: budgetId, alert_type: alertType, status: 'OPEN' })
    .first();
  if (!existing) {
    await db()('alerts').insert({ workspace_id: wsId, budget_id: budgetId, alert_type: alertType, severity, reason, status: 'OPEN' });
  } else {
    await db()('alerts').where({ id: existing.id }).update({ reason, severity });
  }
}

// ── Budgets CRUD ──────────────────────────────────────────────────────────────
async function listBudgets(wsId) {
  return db()('budgets').where({ workspace_id: wsId }).orderBy('period_start', 'desc');
}

async function getBudgetStatus(wsId, budgetId) {
  const b = await db()('budgets').where({ workspace_id: wsId, id: budgetId }).first();
  if (!b) throw notFound('Budget not found.', 'BUDGET_NOT_FOUND');

  const spent = await txnRepo.sumExpenses(wsId, {
    categoryId:   b.category_id   || undefined,
    departmentId: b.department_id || undefined,
    dateFrom: b.period_start,
    dateTo:   b.period_end,
  });

  const pct = b.amount_limit > 0 ? (spent / b.amount_limit) * 100 : 0;
  return { ...b, spent, percent_used: Math.round(pct * 100) / 100 };
}

async function createBudget(wsId, data) {
  const [id] = await db()('budgets').insert({ workspace_id: wsId, ...data });
  return db()('budgets').where({ workspace_id: wsId, id }).first();
}

async function updateBudget(wsId, id, patch) {
  const b = await db()('budgets').where({ workspace_id: wsId, id }).first();
  if (!b) throw notFound('Budget not found.', 'BUDGET_NOT_FOUND');
  await db()('budgets').where({ workspace_id: wsId, id }).update(patch);
  return db()('budgets').where({ workspace_id: wsId, id }).first();
}

async function deleteBudget(wsId, id) {
  const b = await db()('budgets').where({ workspace_id: wsId, id }).first();
  if (!b) throw notFound('Budget not found.', 'BUDGET_NOT_FOUND');
  await db()('budgets').where({ workspace_id: wsId, id }).del();
}

// ── Savings Goals (PERSONAL only) ─────────────────────────────────────────────
async function listGoals(wsId, wsType) {
  if (wsType !== 'PERSONAL') throw badRequest('Savings goals are only available for PERSONAL workspaces.', null, 'NOT_PERSONAL');
  return db()('savings_goals').where({ workspace_id: wsId });
}

async function createGoal(wsId, wsType, data) {
  if (wsType !== 'PERSONAL') throw badRequest('Savings goals are only available for PERSONAL workspaces.', null, 'NOT_PERSONAL');
  const [id] = await db()('savings_goals').insert({ workspace_id: wsId, ...data });
  return db()('savings_goals').where({ workspace_id: wsId, id }).first();
}

async function updateGoal(wsId, wsType, goalId, patch) {
  if (wsType !== 'PERSONAL') throw badRequest('Savings goals are only available for PERSONAL workspaces.', null, 'NOT_PERSONAL');
  const g = await db()('savings_goals').where({ workspace_id: wsId, id: goalId }).first();
  if (!g) throw notFound('Savings goal not found.', 'GOAL_NOT_FOUND');
  await db()('savings_goals').where({ workspace_id: wsId, id: goalId }).update(patch);
  return db()('savings_goals').where({ workspace_id: wsId, id: goalId }).first();
}

async function deleteGoal(wsId, wsType, goalId) {
  if (wsType !== 'PERSONAL') throw badRequest('Savings goals are only available for PERSONAL workspaces.', null, 'NOT_PERSONAL');
  const g = await db()('savings_goals').where({ workspace_id: wsId, id: goalId }).first();
  if (!g) throw notFound('Savings goal not found.', 'GOAL_NOT_FOUND');
  await db()('savings_goals').where({ workspace_id: wsId, id: goalId }).del();
}

module.exports = {
  recalcAlerts, listBudgets, getBudgetStatus, createBudget, updateBudget, deleteBudget,
  listGoals, createGoal, updateGoal, deleteGoal,
};
