/**
 * Refresh-token repository.
 * Tokens are stored as SHA-256 hashes — the raw token never touches the DB.
 */
const crypto = require('crypto');
const { getKnex } = require('../config/database');

const TABLE = 'refresh_tokens';

function db() { return getKnex(); }

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function create({ user_id, raw_token, expires_at }) {
  const token_hash = hashToken(raw_token);
  const [id] = await db()(TABLE).insert({ user_id, token_hash, expires_at });
  return id;
}

async function findByRaw(raw_token) {
  const token_hash = hashToken(raw_token);
  return db()(TABLE)
    .where({ token_hash })
    .whereNull('revoked_at')
    .where('expires_at', '>', new Date().toISOString().slice(0, 19).replace('T', ' '))
    .first();
}

async function revoke(raw_token) {
  const token_hash = hashToken(raw_token);
  return db()(TABLE)
    .where({ token_hash })
    .update({ revoked_at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
}

async function revokeAllForUser(user_id) {
  return db()(TABLE)
    .where({ user_id })
    .whereNull('revoked_at')
    .update({ revoked_at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
}

module.exports = { create, findByRaw, revoke, revokeAllForUser, hashToken };
