'use strict';
const accountSvc  = require('../services/account.service');
const catSvc      = require('../services/category.service');
const txnSvc      = require('../services/transaction.service');
const asyncHandler = require('../utils/asyncHandler');

const wsId = (req) => Number(req.params.workspaceId);
const ip   = (req) => req.ip || null;

// ── Accounts ─────────────────────────────────────────────────────────────────
const listAccounts    = asyncHandler(async (req, res) => res.json({ accounts: await accountSvc.list(wsId(req)) }));
const getAccount      = asyncHandler(async (req, res) => res.json({ account: await accountSvc.getOne(wsId(req), Number(req.params.accountId)) }));
const createAccount   = asyncHandler(async (req, res) => res.status(201).json({ account: await accountSvc.create(wsId(req), req.body) }));
const updateAccount   = asyncHandler(async (req, res) => res.json({ account: await accountSvc.update(wsId(req), Number(req.params.accountId), req.body) }));
const deleteAccount   = asyncHandler(async (req, res) => { await accountSvc.remove(wsId(req), Number(req.params.accountId)); res.json({ message: 'Account deleted.' }); });

// ── Categories ────────────────────────────────────────────────────────────────
const listCategories  = asyncHandler(async (req, res) => res.json({ categories: await catSvc.list(wsId(req), req.query.type) }));
const getCategory     = asyncHandler(async (req, res) => res.json({ category: await catSvc.getOne(wsId(req), Number(req.params.categoryId)) }));
const createCategory  = asyncHandler(async (req, res) => res.status(201).json({ category: await catSvc.create(wsId(req), req.body) }));
const updateCategory  = asyncHandler(async (req, res) => res.json({ category: await catSvc.update(wsId(req), Number(req.params.categoryId), req.body) }));
const deleteCategory  = asyncHandler(async (req, res) => { await catSvc.remove(wsId(req), Number(req.params.categoryId)); res.json({ message: 'Category deleted.' }); });

// ── Transactions ──────────────────────────────────────────────────────────────
const listTransactions  = asyncHandler(async (req, res) =>
  res.json(await txnSvc.list(wsId(req), req.query, req.membership)));

const getTransaction    = asyncHandler(async (req, res) =>
  res.json({ transaction: await txnSvc.getOne(wsId(req), Number(req.params.txnId), req.membership) }));

const createTransaction = asyncHandler(async (req, res) =>
  res.status(201).json({ transaction: await txnSvc.create(wsId(req), req.user.id, req.body, req.membership) }));

const updateTransaction = asyncHandler(async (req, res) =>
  res.json({ transaction: await txnSvc.update(wsId(req), Number(req.params.txnId), req.user.id, req.body, req.membership) }));

const voidTransaction   = asyncHandler(async (req, res) =>
  res.json({ transaction: await txnSvc.voidTransaction(wsId(req), Number(req.params.txnId), req.user.id, req.body?.void_reason, req.membership) }));

module.exports = {
  listAccounts, getAccount, createAccount, updateAccount, deleteAccount,
  listCategories, getCategory, createCategory, updateCategory, deleteCategory,
  listTransactions, getTransaction, createTransaction, updateTransaction, voidTransaction,
};
