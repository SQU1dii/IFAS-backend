'use strict';
/**
 * Dashboard service.
 *
 * Returns different aggregates depending on:
 *  - workspace_type (PERSONAL/BUSINESS/ORGANIZATION)
 *  - role (Department Head sees only their department)
 */
const { getKnex }  = require('../config/database');
const txnRepo      = require('../repositories/transactionRepository');
const alertRepo    = require('../repositories/alertRepository');
const budgetSvc    = require('./budget.service');
const { ROLES }    = require('../config/constants');

const db = () => getKnex();

async function getDashboard(workspace, membership) {
  const wsId     = workspace.id;
  const wsType   = workspace.workspace_type;
  const deptScope = membership.role_name === ROLES.ORG_DEPT_HEAD ? membership.department_id : null;

  // Date range: current calendar month
  const now   = new Date();
  const month = now.toISOString().slice(0, 7);
  const dateFrom = `${month}-01`;
  const dateTo   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  // Total income & expense this month
  const txnFilter = { dateFrom, dateTo };
  if (deptScope) txnFilter.departmentId = deptScope;

  const [incomeThisMonth, expenseThisMonth] = await Promise.all([
    sumByType(wsId, 'INCOME',  dateFrom, dateTo, deptScope),
    sumByType(wsId, 'EXPENSE', dateFrom, dateTo, deptScope),
  ]);

  // 6-month trend (monthly totals)
  const trend = await monthlyTrend(wsId, deptScope, 6);

  // Category breakdown this month
  const categoryBreakdown = await categoryBreakdown_(wsId, dateFrom, dateTo, deptScope);

  // Budget status
  const budgets = await db()('budgets').where({ workspace_id: wsId });
  const budgetStatuses = await Promise.all(
    budgets.slice(0, 10).map((b) => budgetSvc.getBudgetStatus(wsId, b.id))
  );

  // Open alert count
  const openAlerts = await alertRepo.countOpen(wsId);

  // Savings goals (PERSONAL only)
  let savingsGoals = [];
  if (wsType === 'PERSONAL') {
    savingsGoals = await db()('savings_goals').where({ workspace_id: wsId });
  }

  return {
    period: { from: dateFrom, to: dateTo },
    income_this_month:  incomeThisMonth,
    expense_this_month: expenseThisMonth,
    net_this_month:     incomeThisMonth - expenseThisMonth,
    monthly_trend:      trend,
    category_breakdown: categoryBreakdown,
    budget_status:      budgetStatuses,
    open_alert_count:   openAlerts,
    savings_goals:      savingsGoals,
    workspace_type:     wsType,
    department_scope:   deptScope,
  };
}

async function sumByType(wsId, type, dateFrom, dateTo, deptScope) {
  let q = db()('transactions')
    .where({ workspace_id: wsId, txn_type: type, status: 'POSTED' })
    .where('txn_date', '>=', dateFrom)
    .where('txn_date', '<=', dateTo);
  if (deptScope) q = q.where({ department_id: deptScope });
  const rows = await q.sum('amount as total');
  return Number(rows[0]?.total ?? 0);
}

async function monthlyTrend(wsId, deptScope, months) {
  // Last N calendar months
  const result = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const from = d.toISOString().slice(0, 10);
    const to   = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
    const [inc, exp] = await Promise.all([
      sumByType(wsId, 'INCOME',  from, to, deptScope),
      sumByType(wsId, 'EXPENSE', from, to, deptScope),
    ]);
    result.push({ month: from.slice(0, 7), income: inc, expense: exp });
  }
  return result;
}

async function categoryBreakdown_(wsId, dateFrom, dateTo, deptScope) {
  let q = db()('transactions as t')
    .join('categories as c', 'c.id', 't.category_id')
    .where({ 't.workspace_id': wsId, 't.txn_type': 'EXPENSE', 't.status': 'POSTED' })
    .where('t.txn_date', '>=', dateFrom)
    .where('t.txn_date', '<=', dateTo);
  if (deptScope) q = q.where({ 't.department_id': deptScope });

  const rows = await q.select('c.name as category_name').sum('t.amount as total');
  // groupBy not available in the chain above → do it in JS
  const map = new Map();
  for (const r of rows) {
    const key = r.category_name || 'Unknown';
    map.set(key, (map.get(key) ?? 0) + Number(r.total ?? 0));
  }
  return Array.from(map.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([category_name, total]) => ({ category_name, total }));
}

module.exports = { getDashboard };
