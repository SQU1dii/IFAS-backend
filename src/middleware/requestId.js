/**
 * Attaches a per-request id (for log correlation) and basic structured request
 * logging. Uses morgan for access logs but in a minimal, non-sensitive form.
 */
const morgan = require('morgan');
const logger = require('../config/logger');

morgan.token('reqid', (req) => req.id || '-');

const accessLog = morgan(':method :url :status :res[content-length] - :response-time ms', {
  skip: (req) => process.env.NODE_ENV === 'test',
});

function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  res.setHeader('x-request-id', req.id);
  next();
}

module.exports = { requestId, accessLog };
