/**
 * Shared Knex instance.
 *
 * In production this connects to MySQL 8 via mysql2. The test suite replaces
 * this with an in-memory Knex-compatible mock (tests/lib/memoryKnex.js) via
 * setKnex() in tests/setup.js, so integration tests need no MySQL install and
 * no native database dependencies.
 */
const knex = require('knex');
const config = require('./index');

// A throwaway placeholder returned only when the module is imported in test
// mode before the harness has injected a real/mock instance. Any accidental
// use fails loudly rather than silently passing.
function throwawayStub() {
  const fail = () => { throw new Error('DB not initialised: call setKnex() (the test harness does this automatically).'); };
  return { query: fail, raw: fail, destroy: () => {}, isStub: true };
}

function buildConnection() {
  if (config.isTest) return throwawayStub();
  return knex({
    client: config.db.client,
    connection: {
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.name,
      charset: 'utf8mb4',
    },
    pool: { min: 2, max: config.db.connectionLimit },
  });
}

let db = buildConnection();

/**
 * Replace the shared Knex instance (used by the test harness).
 */
function setKnex(instance) {
  if (db && typeof db.destroy === 'function' && !db.isStub) {
    try { db.destroy(); } catch { /* ignore */ }
  }
  db = instance;
}

function getKnex() {
  return db;
}

module.exports = { db: getKnex, setKnex, getKnex };
