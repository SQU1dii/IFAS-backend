/**
 * Minimal structured logger. Writes JSON-ish lines to stdout without leaking
 * sensitive data. Kept dependency-light on purpose; swap for pino in prod if
 * desired — the interface (info/warn/error/debug) stays the same.
 */
const config = require('./index');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.log.level] ?? LEVELS.info;

// Keys that must never be logged in full.
const REDACT = new Set([
  'password', 'password_hash', 'passwordHash', 'token', 'refresh_token',
  'refreshToken', 'authorization', 'api_key', 'apiKey', 'secret',
]);

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT.has(k.toLowerCase())) {
      out[k] = '[redacted]';
    } else if (v && typeof v === 'object') {
      out[k] = redact(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function log(level, message, meta) {
  if (LEVELS[level] > threshold) return;
  const entry = { level, time: new Date().toISOString(), message };
  if (meta && Object.keys(meta).length) entry.meta = redact(meta);
  // In test mode keep it quiet unless warn/error.
  if (config.isTest && LEVELS[level] < LEVELS.warn) return;
  const line = JSON.stringify(entry);
  if (LEVELS[level] === 0) process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = {
  error: (m, meta) => log('error', m, meta),
  warn: (m, meta) => log('warn', m, meta),
  info: (m, meta) => log('info', m, meta),
  debug: (m, meta) => log('debug', m, meta),
};
