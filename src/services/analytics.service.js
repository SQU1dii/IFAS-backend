'use strict';
/**
 * Analytics service — proxy between the Node API and the Python FastAPI
 * analytics microservice.
 *
 * HTTP contract (Node → FastAPI):
 *
 *   POST /forecast
 *     Body: { series: [{month, total_expense}], horizon: number }
 *     Response: { values: [{period, value}], mape: number, model: string }
 *
 *   POST /analyze/unusual
 *     Body: { history: [{month, total_expense}], new_transactions: [{id, amount, txn_date, category_id}] }
 *     Response: { flags: [{transaction_id, score, severity, reason}] }
 *
 *   POST /recommend
 *     Body: { summary: { workspace_type, income, expense, top_categories, budget_statuses, open_alerts } }
 *     Response: { recommendations: [string] }
 *
 * When ANALYTICS_MODE=mock (default) requests go to the in-process mock client.
 * When ANALYTICS_MODE=live  requests go to the FastAPI service via Axios.
 * All calls have timeouts + retries. If the service is down, a clear
 * "service unavailable" error is returned; all other endpoints keep working.
 */
const config     = require('../config');
const logger     = require('../config/logger');
const { getKnex }= require('../config/database');
const txnRepo    = require('../repositories/transactionRepository');
const alertRepo  = require('../repositories/alertRepository');
const budgetSvc  = require('./budget.service');
const { serviceUnavailable, badRequest } = require('../utils/errors');
const { MIN_FORECAST_MONTHS } = require('../config/constants');

const db = () => getKnex();

// ── HTTP client (Axios with retry) ───────────────────────────────────────────
let _axiosInstance = null;
function axiosClient() {
  if (!_axiosInstance) {
    const axios = require('axios');
    _axiosInstance = axios.create({
      baseURL: config.analytics.url,
      timeout: config.analytics.timeoutMs,
    });
  }
  return _axiosInstance;
}

async function callWithRetry(path, body, retries = config.analytics.maxRetries) {
  if (config.analytics.mode === 'mock') {
    return mockAnalyticsClient(path, body);
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axiosClient().post(path, body);
      return res.data;
    } catch (err) {
      const isLast = attempt === retries;
      if (isLast) {
        logger.warn('Analytics service unavailable', { path, attempt, err: err.message });
        throw serviceUnavailable(`The analytics service is currently unavailable. ${err.message}`);
      }
      // Exponential back-off
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
}

// ── Forecast (frontend-aligned shape) ─────────────────────────────────────────
async function forecast(wsId, categoryId, horizon = 3) {
  // Build monthly history (income + expense) via getMonthly.
  const history = await getMonthly(wsId, { months: 24 }, null);
  if (history.length < MIN_FORECAST_MONTHS) {
    return {
      insufficient_data: true,
      message: `At least ${MIN_FORECAST_MONTHS} months of transaction history is needed to generate a forecast. You currently have ${history.length} months.`,
    };
  }

  const n = history.length;
  const incVals = history.map((h) => h.income);
  const expVals = history.map((h) => h.expenses);
  const avgIncome = incVals.reduce((a, b) => a + b, 0) / n;
  const avgExpenses = expVals.reduce((a, b) => a + b, 0) / n;

  // Simple linear trend (last half vs first half).
  const half = Math.floor(n / 2);
  const earlyInc = history.slice(0, half).reduce((s, h) => s + h.income, 0) / Math.max(1, half);
  const lateInc  = history.slice(half).reduce((s, h) => s + h.income, 0) / Math.max(1, n - half);
  const earlyExp = history.slice(0, half).reduce((s, h) => s + h.expenses, 0) / Math.max(1, half);
  const lateExp  = history.slice(half).reduce((s, h) => s + h.expenses, 0) / Math.max(1, n - half);
  const incomeTrend  = lateInc - earlyInc;
  const expenseTrend = lateExp - earlyExp;

  // MAPE backtest against the last 3 actual months using the simple-average model.
  const backtest = history.slice(-Math.min(3, n - 1));
  const absPct = [];
  for (const m of backtest) {
    if (m.expenses > 0) absPct.push(Math.abs((m.expenses - avgExpenses) / m.expenses) * 100);
  }
  const mape = absPct.length ? Math.round((absPct.reduce((a, b) => a + b, 0) / absPct.length) * 10) / 10 : null;

  const now = new Date();
  const forecast = [];
  for (let i = 1; i <= horizon; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const projIncome   = Math.max(0, avgIncome + incomeTrend * i);
    const projExpenses = Math.max(0, avgExpenses + expenseTrend * i);
    forecast.push({
      label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      month: d.toISOString().slice(0, 7),
      projected_income:   Math.round(projIncome * 100) / 100,
      projected_expenses: Math.round(projExpenses * 100) / 100,
      projected_net:      Math.round((projIncome - projExpenses) * 100) / 100,
      uncertainty_pct:    Math.round((0.08 + (i - 1) * 0.03) * 1000) / 10,
      is_estimate:        true,
    });
  }

  return {
    based_on_months: n,
    horizon_months: horizon,
    mape,
    forecast,
    disclaimer: 'These projections are estimates based on recent trends and should not be used for financial planning without professional advice.',
  };
}

// ── Unusual-spending scan ────────────────────────────────────────────────────
async function scanUnusual(wsId, sinceDate) {
  const history         = await txnRepo.monthlyExpenseTotals(wsId);
  const newTransactions = await txnRepo.recentForScan(wsId, sinceDate);

  if (!newTransactions.length) return { flags: [] };

  // Send only aggregated figures — no raw descriptions, no names (Principle 4)
  const result = await callWithRetry('/analyze/unusual', { history, new_transactions: newTransactions });

  // Create UNUSUAL_SPENDING alerts for flagged transactions
  for (const flag of (result.flags ?? [])) {
    const severity = flag.severity === 'HIGH' ? 'HIGH'
      : flag.severity === 'MEDIUM' ? 'MEDIUM' : 'LOW';
    const existing = await db()('alerts')
      .where({ workspace_id: wsId, alert_type: 'UNUSUAL_SPENDING', status: 'OPEN' })
      .where('transaction_id', flag.transaction_id)
      .first();
    if (!existing) {
      await db()('alerts').insert({
        workspace_id:   wsId,
        alert_type:     'UNUSUAL_SPENDING',
        severity,
        reason:         flag.reason || 'Unusual spending pattern detected.',
        status:         'OPEN',
        transaction_id: flag.transaction_id,
      });
    }
  }

  return result;
}

// ── Recommendations ───────────────────────────────────────────────────────────
async function getRecommendations(wsId, workspaceType) {
  // Build summary from aggregated figures only
  const now   = new Date();
  const from  = `${now.getFullYear()}-${String(now.getMonth()).padStart(2,'0')}-01`;
  const to    = now.toISOString().slice(0, 10);

  const rows = await db()('transactions')
    .where({ workspace_id: wsId, status: 'POSTED' })
    .where('txn_date', '>=', from);

  let income = 0, expense = 0;
  const catMap = new Map();
  for (const r of rows) {
    if (r.txn_type === 'INCOME')  income  += Number(r.amount);
    if (r.txn_type === 'EXPENSE') {
      expense += Number(r.amount);
      catMap.set(r.category_id, (catMap.get(r.category_id) ?? 0) + Number(r.amount));
    }
  }

  const openAlerts = await alertRepo.countOpen(wsId);
  const topCats    = Array.from(catMap.entries()).sort(([,a],[,b]) => b-a).slice(0,5)
    .map(([category_id, total]) => ({ category_id, total }));

  const summary = { workspace_type: workspaceType, income, expense, top_categories: topCats, open_alerts: openAlerts };

  const result = await callWithRetry('/recommend', { summary });

  // Persist recommendations
  const recs = result.recommendations ?? [];
  for (const rec of recs) {
    await db()('recommendations').insert({ workspace_id: wsId, recommendation: rec, source: 'analytics' });
  }

  // Return freshest recs
  return db()('recommendations')
    .where({ workspace_id: wsId })
    .whereNull('dismissed_at')
    .orderBy('created_at', 'desc')
    .limit(20);
}

async function listRecommendations(wsId) {
  return db()('recommendations')
    .where({ workspace_id: wsId })
    .whereNull('dismissed_at')
    .orderBy('created_at', 'desc');
}

async function dismissRecommendation(wsId, recId) {
  const r = await db()('recommendations').where({ workspace_id: wsId, id: recId }).first();
  if (!r) throw require('../utils/errors').notFound('Recommendation not found.', 'REC_NOT_FOUND');
  await db()('recommendations').where({ id: recId }).update({ dismissed_at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
}

// ── Frontend analytics endpoints (computed from real data) ─────────────────────
const { ROLES } = require('../config/constants');

async function _loadTxns(wsId, deptScope) {
  let txns = await db()('transactions').where({ workspace_id: wsId, status: 'POSTED' });
  return deptScope ? txns.filter((t) => t.department_id === deptScope) : txns;
}

function _inRange(d, from, to) {
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

async function getMonthly(wsId, { months = 12, category_id, account_id } = {}, deptScope = null) {
  const txns = await _loadTxns(wsId, deptScope);
  const filtered = txns.filter((t) =>
    (!category_id || t.category_id === Number(category_id)) &&
    (!account_id || t.account_id === Number(account_id) || t.to_account_id === Number(account_id))
  );
  const now = new Date();
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
    let income = 0, expenses = 0;
    for (const t of filtered) {
      if (t.txn_date >= start && t.txn_date <= end) {
        if (t.txn_type === 'INCOME')  income  += Number(t.amount);
        if (t.txn_type === 'EXPENSE') expenses += Number(t.amount);
      }
    }
    out.push({ label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), month: d.toISOString().slice(0, 7), income, expenses, net: income - expenses });
  }
  return out;
}

async function getCategoryAnalytics(wsId, { from, to, months = 6 } = {}, deptScope = null) {
  const txns = await _loadTxns(wsId, deptScope);
  const categories = await db()('categories').where({ workspace_id: wsId });
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  // Overall totals for the period
  let byCategory = [];
  {
    const map = {};
    for (const t of txns) {
      if (t.txn_type !== 'EXPENSE' || !_inRange(t.txn_date, from, to)) continue;
      const key = t.category_id;
      if (!map[key]) map[key] = { category_id: key, name: catName[key] || 'Uncategorized', amount: 0 };
      map[key].amount += Number(t.amount);
    }
    byCategory = Object.values(map).sort((a, b) => b.amount - a.amount);
  }
  // Per-category monthly trend
  const now = new Date();
  const catSeries = {};
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    for (const t of txns) {
      if (t.txn_type !== 'EXPENSE' || t.txn_date < start || t.txn_date > end) continue;
      const name = catName[t.category_id] || 'Uncategorized';
      if (!catSeries[name]) catSeries[name] = [];
      catSeries[name].push({ label, amount: Number(t.amount) });
    }
  }
  const categoryTrends = Object.entries(catSeries).map(([name, series]) => ({ name, series }));
  return { by_category: byCategory, category_trends: categoryTrends };
}

async function getCashFlow(wsId, { months = 12 } = {}, deptScope = null) {
  const monthly = await getMonthly(wsId, { months }, deptScope);
  let cumulative = 0;
  const cumulativeSeries = monthly.map((m) => { cumulative += m.net; return { label: m.label, month: m.month, cumulative: Math.round(cumulative * 100) / 100 }; });
  return { monthly, cumulative_series: cumulativeSeries };
}

async function getBudgetPerformance(wsId, { months = 6 } = {}) {
  const budgets = await budgetSvc.listBudgetsWithStatus(wsId);
  const txns = await _loadTxns(wsId);
  const now = new Date();
  return budgets.map((b) => {
    const series = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
      let spent = 0;
      for (const t of txns) {
        if (t.txn_type !== 'EXPENSE' || t.category_id !== b.category_id) continue;
        if (t.txn_date >= start && t.txn_date <= end) spent += Number(t.amount);
      }
      series.push({ label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), spent, limit: Number(b.amount_limit) });
    }
    return { id: b.id, category_name: b.category_name, category_id: b.category_id, period: 'monthly', limit: Number(b.amount_limit), series };
  });
}

async function getSavingsTrends(wsId) {
  const goals = await db()('savings_goals').where({ workspace_id: wsId });
  const contribs = await db()('savings_contributions').where({ workspace_id: wsId });
  return goals.map((g) => {
    const sorted = contribs.filter((c) => c.goal_id === g.id).sort((a, b) => (a.date > b.date ? 1 : -1));
    const monthly = {};
    let running = 0;
    for (const c of sorted) {
      running += c.type === 'contribution' ? Number(c.amount) : -Number(c.amount);
      monthly[c.date.slice(0, 7)] = Math.round(running * 100) / 100;
    }
    const series = Object.entries(monthly).map(([month, balance]) => ({
      label: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), month, balance,
    }));
    return { goal_id: g.id, goal_name: g.name, target_amount: Number(g.target_amount), current_amount: Number(g.saved_amount), series };
  });
}

async function getInsights(wsId, { from, to } = {}, deptScope = null) {
  const dash = await require('./dashboard.service').getDashboard(
    await db()('workspaces').where({ id: wsId }).first(),
    { role_name: deptScope ? ROLES.ORG_DEPT_HEAD : 'OWNER', department_id: deptScope },
    { from, to },
  );
  return (dash.insights || []).map((i) => ({ ...i, source: 'rule_based', period_from: from ?? null, period_to: to ?? null, is_estimate: false }));
}

async function getAnomalies(wsId, { from, to } = {}, deptScope = null) {
  const txns = await _loadTxns(wsId, deptScope);
  // Build per-category stats from history (last 90 days)
  const histEnd = new Date();
  const histStart = new Date(histEnd.getTime() - 90 * 86400000).toISOString().slice(0, 10);
  const catHist = {};
  for (const t of txns) {
    if (t.txn_type !== 'EXPENSE' || t.txn_date < histStart) continue;
    (catHist[t.category_id] = catHist[t.category_id] || []).push(Number(t.amount));
  }
  const catStats = {};
  for (const [cat, amts] of Object.entries(catHist)) {
    const mean = amts.reduce((a, b) => a + b, 0) / amts.length;
    const variance = amts.reduce((s, a) => s + (a - mean) ** 2, 0) / amts.length;
    catStats[cat] = { mean, std: Math.sqrt(variance) };
  }
  const categories = await db()('categories').where({ workspace_id: wsId });
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const accounts = await db()('accounts').where({ workspace_id: wsId });
  const accName = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
  const anomalies = [];
  for (const t of txns) {
    if (t.txn_type !== 'EXPENSE' || !_inRange(t.txn_date, from, to)) continue;
    const stats = catStats[t.category_id];
    if (!stats || stats.std < 5) continue;
    const z = (Number(t.amount) - stats.mean) / stats.std;
    if (z > 2 && Number(t.amount) > 50) {
      anomalies.push({
        id: t.id, date: t.txn_date, description: t.description, amount: Number(t.amount),
        category_name: catName[t.category_id] || '', account_name: accName[t.account_id] || '',
        z_score: Math.round(z * 100) / 100, category_avg: Math.round(stats.mean * 100) / 100,
        deviation_pct: Math.round(((Number(t.amount) - stats.mean) / stats.mean) * 100),
        flag_reason: `Amount is significantly higher than your typical ${catName[t.category_id] || ''} spending.`,
      });
    }
  }
  return anomalies.sort((a, b) => b.z_score - a.z_score);
}

async function getSpendingPatterns(wsId, { months = 6 } = {}, deptScope = null) {
  const txns = await _loadTxns(wsId, deptScope);
  const categories = await db()('categories').where({ workspace_id: wsId });
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const now = new Date();
  const catMonths = {};
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    const start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
    for (const t of txns) {
      if (t.txn_type !== 'EXPENSE' || t.txn_date < start || t.txn_date > end) continue;
      const key = t.category_id;
      (catMonths[key] = catMonths[key] || { name: catName[key] || 'Uncategorized', amounts: [] }).amounts.push(Number(t.amount));
    }
  }
  const patterns = [];
  for (const [catId, data] of Object.entries(catMonths)) {
    const amts = data.amounts;
    if (amts.length < 2) continue;
    const avg = amts.reduce((a, b) => a + b, 0) / amts.length;
    const recent = amts.slice(-2).reduce((a, b) => a + b, 0) / 2;
    const trend = recent > avg * 1.1 ? 'increasing' : recent < avg * 0.9 ? 'decreasing' : 'stable';
    const total = amts.reduce((a, b) => a + b, 0);
    let observation = trend === 'increasing' ? `Your ${data.name} spending has been rising recently.`
      : trend === 'decreasing' ? `Your ${data.name} spending has been declining — good work.`
      : `Your ${data.name} spending is consistent month to month.`;
    patterns.push({ category_id: Number(catId), category_name: data.name, total_spent: Math.round(total * 100) / 100, avg_monthly: Math.round(avg * 100) / 100, trend, observation, source: 'rule_based', is_estimate: false });
  }
  return patterns.sort((a, b) => b.total_spent - a.total_spent);
}

async function getReportSummary(wsId, { from, to } = {}, deptScope = null) {
  const txns = await _loadTxns(wsId, deptScope);
  const categories = await db()('categories').where({ workspace_id: wsId });
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const accounts = await db()('accounts').where({ workspace_id: wsId });
  const accName = Object.fromEntries(accounts.map((a) => [a.id, a.name]));

  let income = 0, expenses = 0;
  const incByCat = {}, expByCat = {}, byAcc = {};
  let count = 0;
  for (const t of txns) {
    if (t.txn_type === 'TRANSFER') continue;
    if (!_inRange(t.txn_date, from, to)) continue;
    count++;
    const accKey = accName[t.account_id] || 'Unknown';
    if (!byAcc[accKey]) byAcc[accKey] = { income: 0, expenses: 0 };
    if (t.txn_type === 'INCOME') {
      income += Number(t.amount);
      byAcc[accKey].income += Number(t.amount);
      const ck = catName[t.category_id] || 'Other Income';
      incByCat[ck] = (incByCat[ck] || 0) + Number(t.amount);
    } else {
      expenses += Number(t.amount);
      byAcc[accKey].expenses += Number(t.amount);
      const ck = catName[t.category_id] || 'Uncategorized';
      expByCat[ck] = (expByCat[ck] || 0) + Number(t.amount);
    }
  }
  const net = income - expenses;
  const savingsRate = income > 0 ? (net / income) * 100 : 0;
  const budgets = await budgetSvc.listBudgetsWithStatus(wsId);
  return {
    period: { from, to },
    summary: { total_income: income, total_expenses: expenses, net_cash_flow: net, savings_rate: Math.round(savingsRate * 10) / 10, transaction_count: count },
    income_by_category: Object.entries(incByCat).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    expense_by_category: Object.entries(expByCat).map(([name, amount]) => ({ name, category_id: null, amount })).sort((a, b) => b.amount - a.amount),
    by_account: Object.entries(byAcc).map(([name, v]) => ({ name, ...v })),
    budget_performance: budgets.map((b) => ({
      category_name: b.category_name, limit: Number(b.amount_limit), spent: b.spent,
      remaining: Number(b.amount_limit) - b.spent, utilization: b.amount_limit > 0 ? Math.round((b.spent / b.amount_limit) * 1000) / 10 : 0,
      status: b.spent >= b.amount_limit ? 'over' : (b.spent / (b.amount_limit || 1)) >= (b.alert_threshold || 80) / 100 ? 'warning' : 'on_track',
    })),
  };
}

// ── In-process mock analytics client ─────────────────────────────────────────
// Used when ANALYTICS_MODE=mock (default). Produces deterministic results
// based on the training-data patterns from IFAS_training_data/.
function mockAnalyticsClient(path, body) {
  if (path === '/forecast') {
    const { series, horizon } = body;
    // Simple linear trend forecast
    const n = series.length;
    const mean = series.reduce((s, r) => s + r.total_expense, 0) / n;
    const slope = (() => {
      let num = 0, den = 0;
      series.forEach((r, i) => { num += (i - (n-1)/2) * (r.total_expense - mean); den += Math.pow(i - (n-1)/2, 2); });
      return den ? num / den : 0;
    })();
    const last = series[n - 1];
    const lastDate = new Date(last.month);
    const values = [];
    for (let h = 1; h <= horizon; h++) {
      const d = new Date(lastDate.getFullYear(), lastDate.getMonth() + h, 1);
      values.push({ period: d.toISOString().slice(0, 10), value: Math.max(0, Math.round(mean + slope * (n - 1 + h))) });
    }
    // MAPE simulation based on data variance
    const mape = Math.round((series.reduce((s, r) => s + Math.abs(r.total_expense - mean) / Math.max(1, mean), 0) / n) * 100) / 100;
    return { values, mape, model: 'mock_linear_trend' };
  }

  if (path === '/analyze/unusual') {
    const { new_transactions } = body;
    // Flag transactions with amount > 3× the median amount of history
    const amounts = (body.history || []).map((h) => h.total_expense).filter((v) => v > 0).sort((a, b) => a - b);
    const median = amounts.length ? amounts[Math.floor(amounts.length / 2)] : 0;
    const threshold = median > 0 ? median * 3 : Infinity;
    const flags = new_transactions
      .filter((t) => Number(t.amount) > threshold / 30) // daily threshold
      .map((t) => ({
        transaction_id: t.id,
        score: Math.min(1, Number(t.amount) / (threshold / 30)),
        severity: Number(t.amount) > (threshold / 15) ? 'HIGH' : 'MEDIUM',
        reason: `Amount ${t.amount} is unusually high for this workspace.`,
      }));
    return { flags };
  }

  if (path === '/recommend') {
    const { summary } = body;
    const recs = [];
    if (summary.expense > summary.income * 0.9) recs.push('Your expenses are close to or exceeding income. Review discretionary spending.');
    if (summary.open_alerts > 0)  recs.push(`You have ${summary.open_alerts} open alert(s). Review them to stay on budget.`);
    if (!recs.length) recs.push('Your finances look healthy. Keep tracking consistently.');
    return { recommendations: recs };
  }

  throw serviceUnavailable(`Unknown analytics path: ${path}`);
}

module.exports = {
  forecast, scanUnusual, getRecommendations, listRecommendations, dismissRecommendation,
  getMonthly, getCategoryAnalytics, getCashFlow, getBudgetPerformance, getSavingsTrends,
  getInsights, getAnomalies, getSpendingPatterns, getReportSummary,
};
