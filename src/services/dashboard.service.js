'use strict';
/**
 * Dashboard service — returns the shape the frontend expects:
 *   { summary, spending_by_category, monthly_series, budget_utilization,
 *     savings_goals, recent_transactions, insights }
 *
 * shaped by workspace type and role (Department Head sees only their dept).
 */
const { getKnex }  = require('../config/database');
const txnRepo      = require('../repositories/transactionRepository');
const alertRepo    = require('../repositories/alertRepository');
const budgetSvc    = require('./budget.service');
const { ROLES }    = require('../config/constants');

const db = () => getKnex();

function _range(start, end) {
  if (!start || !end) return null;
  return (d) => d.txn_date >= start && d.txn_date <= end;
}

async function getDashboard(workspace, membership, params = {}) {
  const wsId      = workspace.id;
  const wsType    = workspace.workspace_type;
  const deptScope = membership.role_name === ROLES.ORG_DEPT_HEAD ? membership.department_id : null;

  // Resolve the period (default: current month).
  const now = new Date();
  const from = params.from || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const to   = params.to   || now.toISOString().slice(0, 10);

  // Load transactions (optionally dept-scoped).
  let txns = await db()('transactions').where({ workspace_id: wsId, status: 'POSTED' });
  if (deptScope) txns = txns.filter((t) => t.department_id === deptScope);

  const periodTxns = txns.filter((t) => t.txn_date >= from && t.txn_date <= to);

  // Summary
  let income = 0, expenses = 0;
  const byCat = {};
  for (const t of periodTxns) {
    if (t.txn_type === 'INCOME')  income  += Number(t.amount);
    if (t.txn_type === 'EXPENSE') {
      expenses += Number(t.amount);
      const key = t.category_id;
      byCat[key] = (byCat[key] || 0) + Number(t.amount);
    }
  }
  const netCashFlow = income - expenses;
  const savingsRate = income > 0 ? (netCashFlow / income) * 100 : 0;

  // Category names
  const categories = await db()('categories').where({ workspace_id: wsId });
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const spendingByCategory = Object.entries(byCat)
    .map(([id, amount]) => ({ name: catName[id] || 'Uncategorized', category_id: Number(id), amount }))
    .sort((a, b) => b.amount - a.amount);

  // Monthly series (7 months)
  const monthly = await _monthlySeries(wsId, deptScope, 7);

  // Budget utilization
  const budgets = await budgetSvc.listBudgetsWithStatus(wsId);
  const budgetUtil = budgets.map((b) => ({
    id: b.id, category_id: b.category_id, category_name: b.category_name,
    limit: Number(b.amount_limit), period: 'monthly', notes: b.notes || '',
    spent: b.spent, remaining: Number(b.amount_limit) - b.spent,
    utilization: b.amount_limit > 0 ? Math.round((b.spent / b.amount_limit) * 1000) / 10 : 0,
    status: b.spent >= b.amount_limit ? 'over' : (b.spent / (b.amount_limit || 1)) >= (b.alert_threshold || 80) / 100 ? 'warning' : 'on_track',
  }));

  // Savings goals (PERSONAL only)
  let savingsGoals = [];
  if (wsType === 'PERSONAL') {
    const goals = await db()('savings_goals').where({ workspace_id: wsId });
    savingsGoals = goals.map((g) => {
      const target = Number(g.target_amount), current = Number(g.saved_amount);
      const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
      return { ...g, progress_pct: Math.round(pct * 10) / 10, remaining_amount: Math.max(0, target - current), reached: current >= target };
    });
  }

  // Recent transactions (6) with names
  const recent = periodTxns.slice().sort((a, b) => (a.txn_date < b.txn_date ? 1 : -1)).slice(0, 6);
  const accounts = await db()('accounts').where({ workspace_id: wsId });
  const accName = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
  const recentTxns = recent.map((t) => ({
    id: t.id, date: t.txn_date, description: t.description, amount: Number(t.amount),
    type: t.txn_type.toLowerCase(), category_id: t.category_id, category_name: t.category_id ? catName[t.category_id] : null,
    account_id: t.account_id, account_name: accName[t.account_id] || '',
    destination_account_id: t.to_account_id, destination_account_name: t.to_account_id ? accName[t.to_account_id] : null, notes: '',
  }));

  // Insights (rule-based)
  const insights = _buildInsights(savingsRate, budgetUtil, spendingByCategory);

  return {
    summary: {
      total_income: income,
      total_expenses: expenses,
      net_cash_flow: netCashFlow,
      savings_rate: Math.round(savingsRate * 10) / 10,
      period_changes: null,
    },
    spending_by_category: spendingByCategory,
    monthly_series: monthly,
    budget_utilization: budgetUtil,
    savings_goals: savingsGoals,
    recent_transactions: recentTxns,
    insights,
  };
}

async function _monthlySeries(wsId, deptScope, months) {
  const txns = await db()('transactions').where({ workspace_id: wsId, status: 'POSTED' });
  const scoped = deptScope ? txns.filter((t) => t.department_id === deptScope) : txns;
  const now = new Date();
  const series = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
    let income = 0, expenses = 0;
    for (const t of scoped) {
      if (t.txn_date >= start && t.txn_date <= end) {
        if (t.txn_type === 'INCOME')  income  += Number(t.amount);
        if (t.txn_type === 'EXPENSE') expenses += Number(t.amount);
      }
    }
    series.push({
      label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      month: d.toISOString().slice(0, 7),
      income, expenses, net: income - expenses,
    });
  }
  return series;
}

function _buildInsights(savingsRate, budgets, spendingByCategory) {
  const insights = [];
  if (savingsRate >= 20) insights.push({ id: 'i-savings-good', type: 'positive', icon: 'trending-up', title: 'Healthy savings rate', message: `You saved ${savingsRate.toFixed(1)}% of income — above the 20% benchmark.` });
  else if (savingsRate > 0 && savingsRate < 10) insights.push({ id: 'i-savings-low', type: 'warning', icon: 'alert', title: 'Low savings rate', message: `Your savings rate is ${savingsRate.toFixed(1)}%. Try to reach 20%.` });
  const over = budgets.filter((b) => b.status === 'over');
  const near = budgets.filter((b) => b.status === 'warning');
  if (over.length) insights.push({ id: 'i-over-budget', type: 'alert', icon: 'alert', title: 'Budget exceeded', message: `Over budget in: ${over.map((b) => b.category_name).join(', ')}.` });
  if (near.length) insights.push({ id: 'i-near-budget', type: 'warning', icon: 'alert', title: 'Approaching budget limit', message: `Near limit in: ${near.map((b) => b.category_name).join(', ')}.` });
  if (spendingByCategory.length) {
    const top = spendingByCategory[0];
    insights.push({ id: 'i-top-cat', type: 'info', icon: 'info', title: 'Top spending category', message: `${top.name} is your largest expense at KSh ${Number(top.amount).toLocaleString('en-KE')}.` });
  }
  return insights;
}

module.exports = { getDashboard };
