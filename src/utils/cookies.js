'use strict';
/**
 * Refresh-token cookie helpers.
 *
 * The refresh token is delivered as an HttpOnly cookie so the browser sends it
 * automatically on /auth/refresh without JS ever reading it. We also accept the
 * token in the JSON body as a fallback for non-browser API clients / tests.
 */
const config = require('../config');

const COOKIE_NAME = 'ifas_refresh';
const MAX_AGE_MS = config.auth.refreshExpiresDays * 24 * 60 * 60 * 1000;

function setRefreshCookie(res, rawToken) {
  res.cookie(COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure:   config.env === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   MAX_AGE_MS,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function readRefreshToken(req) {
  // Cookie first (browser), body second (API client / test).
  return req.cookies?.[COOKIE_NAME] || req.body?.refresh_token || null;
}

module.exports = { COOKIE_NAME, setRefreshCookie, clearRefreshCookie, readRefreshToken };
