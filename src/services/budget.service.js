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

/**
 * GET /budgets/status — every budget enriched with spent/remaining/utilization/status
 * plus category_name. Matches the frontend's expected shape.
 */
async function listBudgetsWithStatus(wsId) {
  const budgets = await listBudgets(wsId);
  const categories = await db()('categories').where({ workspace_id: wsId });
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const result = [];
  for (const b of budgets) {
    const spent = await txnRepo.sumExpenses(wsId, {
      categoryId: b.category_id || undefined,
      departmentId: b.department_id || undefined,
      dateFrom: b.period_start, dateTo: b.period_end,
    });
    result.push({ ...b, category_name: b.category_id ? catName[b.category_id] : '', spent });
  }
  return result;
}

async function getBudgetStatus(wsId, budgetId) {
  const b = await db()('budgets').where({ workspace_id: wsId, id: budgetId }).first();
  if (!b) throw notFound('Budget not found.', 'BUDGET_NOT_FOUND');

  const spent = await txnRepo.sumExpenses(wsId, {
    categoryId: b.category_id   || undefined,
    departmentId: b.department_id || undefined,
    dateFrom: b.period_start,
    dateTo:   b.period_end,
  });

  const categories = await db()('categories').where({ workspace_id: wsId });
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  const pct = b.amount_limit > 0 ? (spent / b.amount_limit) * 100 : 0;
  return { ...b, category_name: b.category_id ? catName[b.category_id] : '', spent, percent_used: Math.round(pct * 100) / 100 };
}

/** Single enriched budget (GET /budgets/:id). */
async function getBudget(wsId, budgetId) {
  return getBudgetStatus(wsId, budgetId);
}

async function createBudget(wsId, data) {
  // Accept frontend fields: limit→amount_limit, period→dates, notes.
  const { period_start, period_end } = _resolvePeriod(data);
  const [id] = await db()('budgets').insert({
    workspace_id: wsId,
    category_id:   data.category_id   || null,
    department_id: data.department_id || null,
    period_start,
    period_end,
    amount_limit:  Number(data.amount_limit ?? data.limit),
    alert_threshold: data.alert_threshold ?? 80,
    notes:         data.notes ?? null,
  });
  return db()('budgets').where({ workspace_id: wsId, id }).first();
}

function _resolvePeriod(data) {
  // If explicit dates given, use them. Otherwise derive from `period`.
  if (data.period_start && data.period_end) return { period_start: data.period_start, period_end: data.period_end };
  const now = new Date();
  const period = (data.period || 'monthly').toLowerCase();
  if (period === 'yearly') {
    return {
      period_start: `${now.getFullYear()}-01-01`,
      period_end:   `${now.getFullYear()}-12-31`,
    };
  }
  // monthly (default)
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { period_start: start.toISOString().slice(0, 10), period_end: end.toISOString().slice(0, 10) };
}

async function updateBudget(wsId, id, patch) {
  const b = await db()('budgets').where({ workspace_id: wsId, id }).first();
  if (!b) throw notFound('Budget not found.', 'BUDGET_NOT_FOUND');
  const update = {};
  if (patch.amount_limit !== undefined) update.amount_limit = Number(patch.amount_limit);
  if (patch.limit !== undefined)         update.amount_limit = Number(patch.limit);
  if (patch.alert_threshold !== undefined) update.alert_threshold = patch.alert_threshold;
  if (patch.notes !== undefined)         update.notes = patch.notes;
  if (patch.category_id !== undefined)   update.category_id = patch.category_id;
  if (patch.department_id !== undefined) update.department_id = patch.department_id;
  if (patch.period) {
    const { period_start, period_end } = _resolvePeriod({ period: patch.period, period_start: patch.period_start, period_end: patch.period_end });
    update.period_start = period_start;
    update.period_end = period_end;
  } else {
    if (patch.period_start) update.period_start = patch.period_start;
    if (patch.period_end)   update.period_end = patch.period_end;
  }
  await db()('budgets').where({ workspace_id: wsId, id }).update(update);
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

// ── Savings Contributions ──────────────────────────────────────────────────────
const contribRepo = require('../repositories/savingsContributionRepository');

async function listContributions(wsId, wsType, goalId) {
  if (wsType !== 'PERSONAL') throw badRequest('Savings goals are only available for PERSONAL workspaces.', null, 'NOT_PERSONAL');
  return contribRepo.listByGoal(wsId, goalId);
}

async function addContribution(wsId, wsType, goalId, payload) {
  if (wsType !== 'PERSONAL') throw badRequest('Savings goals are only available for PERSONAL workspaces.', null, 'NOT_PERSONAL');
  const g = await db()('savings_goals').where({ workspace_id: wsId, id: goalId }).first();
  if (!g) throw notFound('Savings goal not found.', 'GOAL_NOT_FOUND');
  const amt = Number(payload.amount);
  if (!amt || amt <= 0) throw badRequest('Amount must be greater than 0.', { amount: 'Must be > 0' });
  const type = payload.type || 'contribution';
  if (!['contribution', 'withdrawal'].includes(type)) throw badRequest('type must be contribution or withdrawal.', { type: 'Invalid' });
  if (type === 'withdrawal' && amt > Number(g.saved_amount)) {
    throw badRequest('Withdrawal exceeds available balance.', { amount: 'Exceeds balance' });
  }
  const entry = await contribRepo.create(wsId, goalId, {
    date: payload.date || new Date().toISOString().slice(0, 10),
    amount: amt, type, notes: payload.notes || '',
  });
  // Adjust the goal balance.
  const newSaved = type === 'contribution' ? Number(g.saved_amount) + amt : Number(g.saved_amount) - amt;
  await db()('savings_goals').where({ id: goalId }).update({ saved_amount: newSaved });
  const updatedGoal = await db()('savings_goals').where({ workspace_id: wsId, id: goalId }).first();
  return { contribution: entry, goal: updatedGoal };
}

module.exports = {
  recalcAlerts, listBudgets, listBudgetsWithStatus, getBudgetStatus, getBudget, createBudget, updateBudget, deleteBudget,
  listGoals, createGoal, updateGoal, deleteGoal,
  listContributions, addContribution,
};
