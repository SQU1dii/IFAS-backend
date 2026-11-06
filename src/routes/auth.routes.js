/**
 * Auth routes  /api/v1/auth
 *
 * POST /auth/register      – create account, returns tokens
 * POST /auth/login         – authenticate, returns tokens
 * POST /auth/logout        – revoke refresh token (requires Bearer access token)
 * POST /auth/refresh       – rotate tokens using refresh_token in body
 * GET  /auth/me            – return current user (requires Bearer access token)
 *
 * Rate limits:
 *  - register + login:  20 attempts per 15 min window per IP (auth endpoints)
 *  - refresh:           30 per 15 min
 *  - me + logout:       not rate-limited (protected by JWT anyway)
 */
const express = require('express');
const rateLimit = require('express-rate-limit');

const controller = require('../controllers/auth.controller');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const { registerSchema, loginSchema, refreshSchema } = require('../validators/auth.validators');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many attempts. Please try again later.', fields: null } },
  skip: () => process.env.NODE_ENV === 'test',
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many refresh attempts.', fields: null } },
  skip: () => process.env.NODE_ENV === 'test',
});

// Public
router.post('/register', authLimiter, validate(registerSchema), controller.register);
router.post('/login',    authLimiter, validate(loginSchema),    controller.login);
router.post('/refresh',  refreshLimiter, validate(refreshSchema), controller.refresh);

// Protected
router.post('/logout', authenticate, controller.logout);
router.get('/me',      authenticate, controller.me);

module.exports = router;
