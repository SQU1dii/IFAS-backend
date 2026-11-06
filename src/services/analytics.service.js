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

// ── Forecast ─────────────────────────────────────────────────────────────────
async function forecast(wsId, categoryId, horizon = 6) {
  const series = await txnRepo.monthlyExpenseTotals(wsId, categoryId || null);

  if (series.length < MIN_FORECAST_MONTHS) {
    return {
      insufficient_data: true,
      message: `At least ${MIN_FORECAST_MONTHS} months of expense history are required for a forecast. Currently have ${series.length}.`,
      months_available: series.length,
    };
  }

  const result = await callWithRetry('/forecast', { series, horizon });

  // Persist forecast + values
  await db().transaction(async (trx) => {
    const [fid] = await trx('forecasts').insert({
      workspace_id: wsId,
      category_id:  categoryId || null,
      horizon,
      mape:  result.mape   ?? null,
      model: result.model  ?? null,
    });
    if (result.values?.length) {
      await trx('forecast_values').insert(
        result.values.map((v) => ({ forecast_id: fid, period: v.period, value: v.value }))
      );
    }
  });

  return result;
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

module.exports = { forecast, scanUnusual, getRecommendations, listRecommendations, dismissRecommendation };
