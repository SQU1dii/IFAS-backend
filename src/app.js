const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const config = require('./config');
const logger = require('./config/logger');
const { requestId, accessLog } = require('./middleware/requestId');
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');

/**
 * Build the Express application. Routes are mounted by `routes/index.js`.
 * The router is required lazily inside the function so the test harness can
 * inject its own database before any module that touches the DB is loaded.
 */
function createApp() {
  const app = express();

  // Trust the first proxy hop in production so secure cookies / IPs resolve.
  if (config.env === 'production') app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(requestId);
  app.use(accessLog);

  // Health check (unauthenticated) — used by ops and the test suite.
  app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  // API routes under /api/v1
  const routes = require('./routes');
  app.use('/api/v1', routes);

  app.use(notFound);
  app.use(errorHandler);

  logger.info('IFAS application initialised', { env: config.env });
  return app;
}

module.exports = { createApp };
