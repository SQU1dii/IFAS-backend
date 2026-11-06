'use strict';
/**
 * Jest global setup. Runs once before all suites (beforeAll) and before each
 * test (beforeEach). Injects a fresh in-memory Knex mock, registers composite-
 * FK constraints, and seeds RBAC + category templates so every test starts
 * with a clean, deterministic state.
 */
const { setKnex }                    = require('../src/config/database');
const { createMemoryKnex }           = require('./lib/memoryKnex');
const { seedRbac, registerConstraints } = require('./lib/seed');

let knex;

beforeAll(() => {
  knex = createMemoryKnex();
  setKnex(knex);
  registerConstraints(knex);
});

beforeEach(async () => {
  // Full reset: wipe all rows and sequences so each test is isolated.
  knex._store.reset();
  // Re-register constraints (they survive reset since they live on the store object)
  registerConstraints(knex);
  // Seed RBAC every time — IDs are always 1..n after reset.
  await seedRbac(knex);
});

module.exports = {};
