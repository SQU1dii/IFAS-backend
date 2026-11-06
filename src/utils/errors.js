/**
 * Typed application errors. The error handler maps these to the consistent
 * JSON error envelope:
 *   { "error": { "code", "message", "fields": {...}|null } }
 */

class AppError extends Error {
  constructor(code, message, status, fields = null) {
    super(message);
    this.name = 'AppError';
    this.code = code; // machine-readable, e.g. "WORKSPACE_NOT_FOUND"
    this.status = status; // HTTP status
    this.fields = fields; // per-field validation errors, or null
  }
}

// Common error factories ──────────────────────────────────────────────────────
const badRequest = (message, fields = null, code = 'BAD_REQUEST') =>
  new AppError(code, message || 'Bad request', 400, fields);

const unauthorized = (message = 'Unauthorized', code = 'UNAUTHORIZED') =>
  new AppError(code, message, 401, null);

const forbidden = (message = 'You do not have permission to do that', code = 'FORBIDDEN') =>
  new AppError(code, message, 403, null);

const notFound = (message = 'Not found', code = 'NOT_FOUND') =>
  new AppError(code, message, 404, null);

const conflict = (message, fields = null, code = 'CONFLICT') =>
  new AppError(code, message || 'Conflict', 409, fields);

const unprocessable = (message, fields = null, code = 'VALIDATION_ERROR') =>
  new AppError(code, message || 'Validation failed', 422, fields);

const serviceUnavailable = (message, code = 'SERVICE_UNAVAILABLE') =>
  new AppError(code, message || 'A required service is unavailable. Please try again later.', 503, null);

module.exports = {
  AppError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  unprocessable,
  serviceUnavailable,
};
