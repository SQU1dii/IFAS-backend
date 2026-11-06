const { errorBody } = require('../utils/errorEnvelope');

function notFound(req, res) {
  res.status(404).json(errorBody('NOT_FOUND', `Route not found: ${req.method} ${req.originalUrl}`, null));
}

module.exports = notFound;
