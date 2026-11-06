/**
 * Audit-log repository. Fire-and-forget — every insert failure is swallowed
 * so an audit log problem never breaks a real user request.
 */
const { getKnex } = require('../config/database');
const logger = require('../config/logger');

const TABLE = 'audit_log';

function db() { return getKnex(); }

/**
 * Write an audit entry asynchronously. Never throws.
 * @param {object} entry
 * @param {number|null}  entry.workspace_id
 * @param {number|null}  entry.user_id
 * @param {string}       entry.action         e.g. 'auth.login'
 * @param {string|null}  entry.entity_type    e.g. 'user'
 * @param {number|null}  entry.entity_id
 * @param {object|null}  entry.metadata
 * @param {string|null}  entry.ip_address
 */
async function log(entry) {
  try {
    await db()(TABLE).insert({
      workspace_id:  entry.workspace_id  ?? null,
      user_id:       entry.user_id       ?? null,
      action:        entry.action,
      entity_type:   entry.entity_type   ?? null,
      entity_id:     entry.entity_id     ?? null,
      metadata:      entry.metadata ? JSON.stringify(entry.metadata) : null,
      ip_address:    entry.ip_address    ?? null,
    });
  } catch (err) {
    // Audit log failure must never break a user request.
    logger.warn('Audit log write failed', { action: entry.action, err: err.message });
  }
}

module.exports = { log };
