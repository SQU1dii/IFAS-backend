'use strict';
/**
 * Financial routes — mounted at /api/v1/workspaces/:workspaceId
 *
 * Accounts:     GET/POST /accounts   GET/PATCH/DELETE /accounts/:accountId
 * Categories:   GET/POST /categories GET/PATCH/DELETE /categories/:categoryId
 * Transactions: GET/POST /transactions GET /transactions/:txnId
 *               PATCH /transactions/:txnId  POST /transactions/:txnId/void
 */
const express = require('express');
const authenticate      = require('../middleware/authenticate');
const loadMembership    = require('../middleware/loadMembership');
const requirePermission = require('../middleware/requirePermission');
const validate          = require('../middleware/validate');
const ctrl              = require('../controllers/financial.controller');
const V                 = require('../validators/financial.validators');

// This router is mounted at /workspaces/:workspaceId — re-use the guard
const router = express.Router({ mergeParams: true });
const guard  = [authenticate, loadMembership];

// ── Accounts ─────────────────────────────────────────────────────────────────
router.get(   '/accounts',              ...guard, requirePermission('accounts.manage'), ctrl.listAccounts);
router.post(  '/accounts',              ...guard, requirePermission('accounts.manage'), validate(V.createAccountSchema), ctrl.createAccount);
router.get(   '/accounts/:accountId',   ...guard, requirePermission('accounts.manage'), ctrl.getAccount);
router.patch( '/accounts/:accountId',   ...guard, requirePermission('accounts.manage'), validate(V.updateAccountSchema), ctrl.updateAccount);
router.delete('/accounts/:accountId',   ...guard, requirePermission('accounts.manage'), ctrl.deleteAccount);

// ── Categories ────────────────────────────────────────────────────────────────
router.get(   '/categories',             ...guard, requirePermission('transactions.view'), ctrl.listCategories);
router.post(  '/categories',             ...guard, requirePermission('accounts.manage'),   validate(V.createCategorySchema), ctrl.createCategory);
router.get(   '/categories/:categoryId', ...guard, requirePermission('transactions.view'), ctrl.getCategory);
router.patch( '/categories/:categoryId', ...guard, requirePermission('accounts.manage'),   validate(V.updateCategorySchema), ctrl.updateCategory);
router.delete('/categories/:categoryId', ...guard, requirePermission('accounts.manage'),   ctrl.deleteCategory);

// ── Transactions ──────────────────────────────────────────────────────────────
router.get(  '/transactions',            ...guard, requirePermission('transactions.view'),   validate(V.listTransactionSchema, { source: 'query' }), ctrl.listTransactions);
router.post( '/transactions',            ...guard, requirePermission('transactions.create'), validate(V.createTransactionSchema), ctrl.createTransaction);
router.get(  '/transactions/:txnId',     ...guard, requirePermission('transactions.view'),   ctrl.getTransaction);
router.patch('/transactions/:txnId',     ...guard, requirePermission('transactions.edit'),   validate(V.updateTransactionSchema), ctrl.updateTransaction);
router.post( '/transactions/:txnId/void',...guard, requirePermission('transactions.edit'),   validate(V.voidTransactionSchema), ctrl.voidTransaction);
router.delete('/transactions/:txnId',    ...guard, requirePermission('transactions.edit'),   ctrl.deleteTransaction);

module.exports = router;
