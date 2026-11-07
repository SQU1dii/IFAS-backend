'use strict';
/**
 * Response envelope helper.
 *
 * The frontend's axios interceptor expects every success response shaped as:
 *   { success: true, message, data, meta }
 * It unwraps `data` and `meta` so controllers/services receive just the payload.
 *
 * Usage in controllers:
 *   ok(res, data)                 → { success: true, data, meta: null }
 *   ok(res, data, meta)          → { success: true, data, meta }
 *   ok(res, data, meta, message) → { success: true, data, meta, message }
 *   created(res, data)           → 201 with envelope
 *
 * Errors still use the existing { error: { code, message, fields } } shape —
 * the frontend's error interceptor already handles that shape.
 */
function ok(res, data, meta = null, message = null) {
  return res.json({ success: true, data, meta, message });
}

function created(res, data, meta = null, message = null) {
  return res.status(201).json({ success: true, data, meta, message });
}

module.exports = { ok, created };
