/**
 * JWT authentication middleware.
 *
 * Reads the Bearer token from the Authorization header, verifies it, and
 * attaches `req.user = { id, email, is_platform_admin }` for downstream use.
 * Does NOT hit the database — stateless verification from the JWT signature.
 */
const { verifyAccessToken } = require('../utils/jwt');
const { unauthorized } = require('../utils/errors');

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    return next(unauthorized('Authentication required. Provide a Bearer token.'));
  }
  const token = authHeader.slice(7).trim();
  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      email: payload.email,
      is_platform_admin: !!payload.is_platform_admin,
    };
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError'
      ? 'Access token has expired.'
      : 'Access token is invalid.';
    next(unauthorized(msg, 'TOKEN_INVALID'));
  }
}

module.exports = authenticate;
