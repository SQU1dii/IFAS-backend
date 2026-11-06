/**
 * Knex configuration.
 *
 * Production/staging uses MySQL 8 (mysql2). The test suite uses an in-memory
 * SQLite database so the integration tests can run without a MySQL install —
 * the same migrations (portable schema builder) build the schema in both.
 */
require('dotenv').config();

const path = require('path');

const isTest = process.env.NODE_ENV === 'test';

module.exports = {
  development: {
    client: process.env.DB_CLIENT || 'mysql2',
    connection: {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      charset: 'utf8mb4',
    },
    pool: { min: 2, max: Number(process.env.DB_CONNECTION_LIMIT || 10) },
    migrations: { directory: path.join(__dirname, 'migrations') },
    seeds: { directory: path.join(__dirname, 'seeds') },
  },
  production: {
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      charset: 'utf8mb4',
    },
    pool: { min: 2, max: Number(process.env.DB_CONNECTION_LIMIT || 10) },
    migrations: { directory: path.join(__dirname, 'migrations') },
    seeds: { directory: path.join(__dirname, 'seeds') },
  },
  // NOTE: the test suite does NOT use Knex at all. It injects an in-memory
  // Knex-compatible mock (tests/lib/memoryKnex.js) so the full app + middleware
  // can be exercised with Supertest without any database install or native deps.
};
