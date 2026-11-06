#!/usr/bin/env node
'use strict';
/**
 * Mock FastAPI Analytics Service
 * ================================
 * A lightweight Express server that mirrors the HTTP contract the Node API
 * expects from the Python FastAPI analytics microservice.
 *
 * Endpoints:
 *   POST /forecast           — linear-trend forecast from a monthly expense series
 *   POST /analyze/unusual    — flag transactions that exceed a dynamic threshold
 *   POST /recommend          — produce rule-based recommendations from a summary
 *   GET  /health             — health check
 *
 * Run:  node mocks/analytics/mockAnalyticsService.js
 * Port: 8001 (set ANALYTICS_PORT to override)
 *
 * This mock produces deterministic, realistic-looking outputs suitable for
 * integration testing and demonstrating the AI assistant without a live
 * Python service.
 */
const express    = require('express');
const app        = express();
const PORT       = Number(process.env.ANALYTICS_PORT || 8001);

app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'mock-analytics' }));

// ── /forecast ─────────────────────────────────────────────────────────────────
app.post('/forecast', (req, res) => {
  const { series = [], horizon = 6 } = req.body;
  if (!series.length) return res.status(400).json({ error: 'series is required' });

  const n    = series.length;
  const mean = series.reduce((s, r) => s + Number(r.total_expense), 0) / n;

  // Simple linear regression on index
  let sxy = 0, sxx = 0;
  series.forEach((r, i) => {
    const xi = i - (n - 1) / 2;
    sxy += xi * (Number(r.total_expense) - mean);
    sxx += xi * xi;
  });
  const slope = sxx ? sxy / sxx : 0;

  const lastDate = new Date(series[n - 1].month);
  const values   = [];
  for (let h = 1; h <= horizon; h++) {
    const d = new Date(lastDate.getFullYear(), lastDate.getMonth() + h, 1);
    values.push({
      period: d.toISOString().slice(0, 10),
      value:  Math.max(0, Math.round(mean + slope * (n - 1 + h))),
    });
  }

  // MAPE based on in-sample fit
  const mape = series.reduce((s, r, i) => {
    const predicted = mean + slope * (i - (n-1)/2);
    const actual    = Number(r.total_expense);
    return s + (actual > 0 ? Math.abs(actual - predicted) / actual : 0);
  }, 0) / n;

  res.json({ values, mape: Math.round(mape * 10000) / 10000, model: 'linear_trend_ols' });
});

// ── /analyze/unusual ─────────────────────────────────────────────────────────
app.post('/analyze/unusual', (req, res) => {
  const { history = [], new_transactions = [] } = req.body;

  const amounts = history.map((h) => Number(h.total_expense)).filter((v) => v > 0).sort((a, b) => a - b);
  const median  = amounts.length ? amounts[Math.floor(amounts.length / 2)] : 0;
  const dailyThreshold = median > 0 ? (median / 30) * 3 : Infinity;

  const flags = new_transactions
    .filter((t) => Number(t.amount) > dailyThreshold)
    .map((t) => {
      const ratio = dailyThreshold > 0 ? Number(t.amount) / dailyThreshold : 2;
      return {
        transaction_id: t.id,
        score:     Math.min(1, ratio),
        severity:  ratio >= 3 ? 'HIGH' : ratio >= 1.5 ? 'MEDIUM' : 'LOW',
        reason:    `Transaction amount ${t.amount} is ${ratio.toFixed(1)}× the daily threshold (${dailyThreshold.toFixed(0)}).`,
      };
    });

  res.json({ flags });
});

// ── /recommend ────────────────────────────────────────────────────────────────
app.post('/recommend', (req, res) => {
  const { summary = {} } = req.body;
  const recs = [];

  const { income = 0, expense = 0, open_alerts = 0, workspace_type } = summary;
  const ratio = income > 0 ? expense / income : null;

  if (ratio !== null && ratio > 0.9)  recs.push('Expenses represent more than 90% of income. Consider reviewing discretionary spending.');
  if (ratio !== null && ratio < 0.5)  recs.push('You are saving more than 50% of income this month — great financial discipline!');
  if (open_alerts > 3)                recs.push(`You have ${open_alerts} open alerts. Address them before the end of the period.`);
  if (workspace_type === 'BUSINESS')  recs.push('Review stock purchase efficiency — compare cost of goods against revenue trends.');
  if (workspace_type === 'ORGANIZATION') recs.push('Ensure department budgets are reconciled with the grant disbursement schedule.');
  if (!recs.length)                   recs.push('Financial figures look balanced. Keep tracking consistently for better forecasts.');

  res.json({ recommendations: recs });
});

app.listen(PORT, () => console.log(`Mock analytics service listening on :${PORT}`));
module.exports = app; // for testing
