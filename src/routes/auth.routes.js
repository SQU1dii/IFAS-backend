'use strict';
/**
 * Auth routes  /api/v1/auth
 * Aligned to the frontend: refresh token in HttpOnly cookie, accessToken in body.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');

const controller = require('../controllers/auth.controller');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const V = require('../validators/auth.validators');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many attempts. Please try again later.', fields: null } },
  skip: () => process.env.NODE_ENV === 'test',
});
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many refresh attempts.', fields: null } },
  skip: () => process.env.NODE_ENV === 'test',
});

// Public
router.post('/register',         authLimiter,     validate(V.registerSchema),        controller.register);
router.post('/login',            authLimiter,     validate(V.loginSchema),           controller.login);
router.post('/refresh',          refreshLimiter,                                    controller.refresh);
router.post('/forgot-password',  authLimiter,     validate(V.forgotPasswordSchema),  controller.forgotPassword);
router.post('/reset-password',   authLimiter,     validate(V.resetPasswordSchema),   controller.resetPassword);

// Protected
router.post('/logout',          authenticate, controller.logout);
router.get('/me',               authenticate, controller.me);
router.patch('/me',             authenticate, validate(V.updateProfileSchema), controller.updateProfile);
router.patch('/me/password',    authenticate, validate(V.changePasswordSchema), controller.changePassword);

module.exports = router;
