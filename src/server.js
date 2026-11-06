const config = require('./config');
const logger = require('./config/logger');
const { createApp } = require('./app');

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info('IFAS API listening', { port: config.port, env: config.env });
});

function shutdown(signal) {
  logger.info('Shutdown signal received', { signal });
  server.close(() => {
    const { getKnex } = require('./config/database');
    const db = getKnex();
    if (db && typeof db.destroy === 'function') {
      db.destroy().then(() => process.exit(0)).catch(() => process.exit(0));
    } else {
      process.exit(0);
    }
  });
  // Force exit after 10s if hanging.
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = server;
