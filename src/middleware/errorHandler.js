const { AppError } = require('../utils/errors');
const { errorBody } = require('../utils/errorEnvelope');
const logger = require('../config/logger');

// Zod produces an "issues" array on .error; convert to our per-field format.
function zodFields(zodError) {
  const fields = {};
  for (const issue of zodError.issues) {
    const key = (issue.path || []).join('.') || 'value';
    fields[key] = (fields[key] || []).concat(issue.message).join('; ');
  }
  return Object.keys(fields).length ? fields : null;
}

/**
 * Central error handler. Must be mounted last (after all routes).
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong on our side.';
  let fields = null;

  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.message;
    fields = err.fields;
  } else if (err && err.name === 'ZodError') {
    status = 422;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed.';
    fields = zodFields(err);
  } else if (err && err.name === 'MulterError') {
    status = 400;
    code = 'UPLOAD_ERROR';
    message = err.message || 'File upload error.';
  } else if (err && err.code === 'ER_DUP_ENTRY') {
    status = 409;
    code = 'DUPLICATE';
    message = 'That already exists.';
  } else if (err && typeof err.code === 'string' && err.code.startsWith('ER_')) {
    // Generic MySQL error — surface generically, never leak query text.
    status = 400;
    code = 'DATABASE_ERROR';
    message = 'The request could not be processed.';
  }

  if (status >= 500) {
    logger.error('Unhandled error', { code, message: err.message, stack: err.stack, url: req.originalUrl });
  } else {
    logger.warn('Request error', { code, status, url: req.originalUrl });
  }

  res.status(status).json(errorBody(code, message, fields));
}

module.exports = errorHandler;
