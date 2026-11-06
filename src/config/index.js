/**
 * Centralised, validated environment configuration.
 * Everything the app needs from the environment is read once here so that
 * no other module reaches into process.env directly.
 */
require('dotenv').config();

const env = process.env;

function int(name, fallback) {
  const v = Number(env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const config = {
  env: env.NODE_ENV || 'development',
  isTest: env.NODE_ENV === 'test',
  port: int('PORT', 4000),

  corsOrigins: (env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  db: {
    client: env.DB_CLIENT || 'mysql2',
    host: env.DB_HOST || '127.0.0.1',
    port: int('DB_PORT', 3306),
    user: env.DB_USER || 'ifas',
    password: env.DB_PASSWORD || '',
    name: env.DB_NAME || 'ifas',
    connectionLimit: int('DB_CONNECTION_LIMIT', 10),
  },

  auth: {
    accessSecret: env.JWT_ACCESS_SECRET || 'dev-access-secret-change-me-please-32-chars',
    refreshSecret: env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me-please-32-chars',
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresDays: int('JWT_REFRESH_EXPIRES_DAYS', 7),
    bcryptRounds: int('BCRYPT_ROUNDS', 12),
  },

  analytics: {
    url: env.ANALYTICS_SERVICE_URL || 'http://127.0.0.1:8001',
    timeoutMs: int('ANALYTICS_TIMEOUT_MS', 15000),
    maxRetries: int('ANALYTICS_MAX_RETRIES', 2),
    // "mock" uses an in-process deterministic mock; "live" calls the FastAPI service.
    mode: env.ANALYTICS_MODE || 'mock',
  },

  ai: {
    url: env.AI_PROVIDER_URL || 'http://127.0.0.1:8002/v1/chat/completions',
    apiKey: env.AI_PROVIDER_API_KEY || '',
    model: env.AI_PROVIDER_MODEL || 'ifas-assistant',
    timeoutMs: int('AI_TIMEOUT_MS', 30000),
    mode: env.AI_MODE || 'mock',
  },

  log: {
    level: env.LOG_LEVEL || (env.NODE_ENV === 'test' ? 'warn' : 'info'),
  },
};

module.exports = config;
