/**
 * JWT helpers — access tokens (stateless, short-lived) and refresh tokens
 * (random, hashed in DB, long-lived).
 *
 * Access token payload: { sub (user_id), email, is_platform_admin }
 * Refresh tokens: a cryptographically random hex string (not a JWT).
 *   The raw value is given to the client; only the SHA-256 hash is stored.
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');

/**
 * Sign an access token for a user.
 * @param {object} user  Row from users table.
 */
function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, is_platform_admin: !!user.is_platform_admin },
    config.auth.accessSecret,
    { expiresIn: config.auth.accessExpiresIn },
  );
}

/**
 * Verify an access token. Returns decoded payload or throws JwtError.
 */
function verifyAccessToken(token) {
  return jwt.verify(token, config.auth.accessSecret);
}

/**
 * Generate a random 64-byte hex refresh token.
 */
function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

/**
 * Compute the expiry Date for a new refresh token.
 */
function refreshExpiresAt() {
  const d = new Date();
  d.setDate(d.getDate() + config.auth.refreshExpiresDays);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = { signAccessToken, verifyAccessToken, generateRefreshToken, refreshExpiresAt };
