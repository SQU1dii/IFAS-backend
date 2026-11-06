/**
 * Wrap an async route handler so rejected promises are forwarded to the error
 * middleware instead of crashing the process. (Express 4 does not catch
 * rejected promises from handlers automatically.)
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = asyncHandler;
