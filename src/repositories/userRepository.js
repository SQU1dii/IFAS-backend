/**
 * User repository — all user-table queries.
 * Gets the Knex instance at call time (never at require time) so the test
 * harness can inject the in-memory mock before any repository is first used.
 */
const { getKnex } = require('../config/database');

const TABLE = 'users';

function db() { return getKnex(); }

async function findById(id) {
  return db()(TABLE).where({ id }).first();
}

async function findByEmail(email) {
  return db()(TABLE).where({ email: email.toLowerCase().trim() }).first();
}

async function create({ email, password_hash, full_name, phone = null, is_platform_admin = false }) {
  const [id] = await db()(TABLE).insert({
    email: email.toLowerCase().trim(),
    password_hash,
    full_name,
    phone,
    is_platform_admin: is_platform_admin ? 1 : 0,
    is_active: 1,
  });
  return findById(id);
}

async function update(id, patch) {
  await db()(TABLE).where({ id }).update(patch);
  return findById(id);
}

/** Safe public view of a user — never returns password_hash. */
function sanitise(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user; // eslint-disable-line no-unused-vars
  return safe;
}

module.exports = { findById, findByEmail, create, update, sanitise };
