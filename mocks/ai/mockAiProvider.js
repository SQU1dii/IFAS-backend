#!/usr/bin/env node
'use strict';
/**
 * Mock AI Provider  (OpenAI-compatible chat completions endpoint)
 * ================================================================
 * Mimics the chat completions API so the Node backend can be tested
 * end-to-end with the AI assistant without a real API key.
 *
 * POST /v1/chat/completions
 *   Body: { model, messages: [{role, content}] }
 *   Response: OpenAI-format choices array
 *
 * Run:  node mocks/ai/mockAiProvider.js
 * Port: 8002 (set AI_MOCK_PORT to override)
 */
const express = require('express');
const app     = express();
const PORT    = Number(process.env.AI_MOCK_PORT || 8002);

app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'mock-ai-provider' }));

app.post('/v1/chat/completions', (req, res) => {
  const messages  = req.body.messages ?? [];
  const lastUser  = messages.filter((m) => m.role === 'user').slice(-1)[0]?.content ?? '';
  const lower     = lastUser.toLowerCase();

  let reply;
  if (lower.includes('expense'))  reply = 'Based on the figures supplied, your expenses this month are tracked in the workspace context. Consider reviewing high-spend categories.';
  else if (lower.includes('income'))  reply = 'Your income this month is recorded in the workspace context. Compare it against your expenses to assess your net financial position.';
  else if (lower.includes('budget'))  reply = 'Review your budget utilisation figures. Budgets approaching or exceeding their thresholds require immediate attention.';
  else if (lower.includes('forecast') || lower.includes('predict')) reply = 'Use the /forecast endpoint to generate a projection. At least 6 months of history is required for reliable results.';
  else if (lower.includes('advice') || lower.includes('invest')) reply = 'I can only provide analysis based on your workspace figures. For investment or legal advice, please consult a qualified professional.';
  else reply = 'I can help with questions about your workspace financial figures — income, expenses, budgets, alerts, and trends. What would you like to know?';

  res.json({
    id:      `chatcmpl-mock-${Date.now()}`,
    object:  'chat.completion',
    model:   req.body.model ?? 'mock-model',
    choices: [{
      index:         0,
      message:       { role: 'assistant', content: reply },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
});

app.listen(PORT, () => console.log(`Mock AI provider listening on :${PORT}`));
module.exports = app;
