'use strict';
const accountSvc  = require('../services/account.service');
const catSvc      = require('../services/category.service');
const txnSvc      = require('../services/transaction.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const { mapAccount, mapCategory, mapTransaction } = require('../utils/mappers');
const accountRepo = require('../repositories/accountRepository');
const catRepo     = require('../repositories/categoryRepository');

const wsId = (req) => Number(req.params.workspaceId);
const ip   = (req) => req.ip || null;

// Enrich a transaction (or array) with category/account names for the frontend.
async function _enrich(wsId, txnOrTxns) {
  const [accounts, categories] = await Promise.all([accountRepo.list(wsId), catRepo.list(wsId)]);
  const accName = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const enrichOne = (t) => mapTransaction(t, {
    categoryName: t.category_id ? catName[t.category_id] : null,
    accountName: accName[t.account_id] || '',
    destAccountName: t.to_account_id ? accName[t.to_account_id] : null,
  });
  return Array.isArray(txnOrTxns) ? txnOrTxns.map(enrichOne) : enrichOne(txnOrTxns);
}

// ── Accounts ─────────────────────────────────────────────────────────────────
const listAccounts = asyncHandler(async (req, res) => {
  const accounts = await accountSvc.list(wsId(req));
  ok(res, accounts.map((a) => mapAccount(a, req.workspace?.currency)));
});
const getAccount = asyncHandler(async (req, res) => {
  const a = await accountSvc.getOne(wsId(req), Number(req.params.accountId));
  ok(res, mapAccount(a, req.workspace?.currency));
});
const createAccount = asyncHandler(async (req, res) => {
  // Accept frontend field names: type→account_type, balance→opening_balance
  const body = {
    name: req.body.name,
    account_type: req.body.account_type || req.body.type,
    opening_balance: req.body.opening_balance ?? req.body.balance ?? 0,
  };
  const a = await accountSvc.create(wsId(req), body);
  created(res, mapAccount(a, req.workspace?.currency), null, 'Account created.');
});
const updateAccount = asyncHandler(async (req, res) => {
  const patch = {};
  if (req.body.name) patch.name = req.body.name;
  if (req.body.account_type || req.body.type) patch.account_type = req.body.account_type || req.body.type;
  if (req.body.opening_balance !== undefined) patch.opening_balance = req.body.opening_balance;
  else if (req.body.balance !== undefined) patch.opening_balance = req.body.balance;
  const a = await accountSvc.update(wsId(req), Number(req.params.accountId), patch);
  ok(res, mapAccount(a, req.workspace?.currency));
});
const deleteAccount = asyncHandler(async (req, res) => {
  await accountSvc.remove(wsId(req), Number(req.params.accountId));
  ok(res, {}, null, 'Account deleted.');
});

// ── Categories ────────────────────────────────────────────────────────────────
const listCategories = asyncHandler(async (req, res) => {
  const cats = await catSvc.list(wsId(req), req.query.type);
  ok(res, cats.map(mapCategory));
});
const getCategory = asyncHandler(async (req, res) => {
  const c = await catSvc.getOne(wsId(req), Number(req.params.categoryId));
  ok(res, mapCategory(c));
});
const createCategory = asyncHandler(async (req, res) => {
  const body = { name: req.body.name, category_type: req.body.category_type || req.body.type };
  const c = await catSvc.create(wsId(req), body);
  created(res, mapCategory(c), null, 'Category created.');
});
const updateCategory = asyncHandler(async (req, res) => {
  const patch = {};
  if (req.body.name) patch.name = req.body.name;
  if (req.body.category_type || req.body.type) patch.category_type = req.body.category_type || req.body.type;
  const c = await catSvc.update(wsId(req), Number(req.params.categoryId), patch);
  ok(res, mapCategory(c));
});
const deleteCategory = asyncHandler(async (req, res) => {
  await catSvc.remove(wsId(req), Number(req.params.categoryId));
  ok(res, {}, null, 'Category deleted.');
});

// ── Transactions ──────────────────────────────────────────────────────────────
const listTransactions = asyncHandler(async (req, res) => {
  const result = await txnSvc.list(wsId(req), req.query, req.membership);
  const data = await _enrich(wsId(req), result.data);
  const meta = {
    total: result.total,
    page: result.page,
    page_size: result.page_size,
    total_pages: Math.max(1, Math.ceil(result.total / result.page_size)),
  };
  ok(res, data, meta);
});

const getTransaction = asyncHandler(async (req, res) => {
  const t = await txnSvc.getOne(wsId(req), Number(req.params.txnId), req.membership);
  ok(res, await _enrich(wsId(req), t));
});

const createTransaction = asyncHandler(async (req, res) => {
  // Accept frontend field names: type→txn_type, date→txn_date, destination_account_id→to_account_id
  const body = {
    txn_type:      req.body.txn_type || req.body.type,
    amount:        Number(req.body.amount),
    txn_date:      req.body.txn_date || req.body.date,
    description:   req.body.description,
    account_id:    req.body.account_id,
    to_account_id: req.body.to_account_id ?? req.body.destination_account_id ?? null,
    category_id:   req.body.category_id ?? null,
    department_id: req.body.department_id ?? null,
    notes:         req.body.notes,
  };
  const t = await txnSvc.create(wsId(req), req.user.id, body, req.membership);
  created(res, await _enrich(wsId(req), t), null, 'Transaction created.');
});

const updateTransaction = asyncHandler(async (req, res) => {
  const patch = {};
  if (req.body.txn_date || req.body.date)   patch.txn_date = req.body.txn_date || req.body.date;
  if (req.body.description)                  patch.description = req.body.description;
  if (req.body.category_id !== undefined)   patch.category_id = req.body.category_id;
  if (req.body.department_id !== undefined) patch.department_id = req.body.department_id;
  if (req.body.amount !== undefined)        patch.amount = Number(req.body.amount);
  if (req.body.to_account_id !== undefined)  patch.to_account_id = req.body.to_account_id;
  else if (req.body.destination_account_id !== undefined) patch.to_account_id = req.body.destination_account_id;
  const t = await txnSvc.update(wsId(req), Number(req.params.txnId), req.user.id, patch, req.membership);
  ok(res, await _enrich(wsId(req), t));
});

const voidTransaction = asyncHandler(async (req, res) => {
  const t = await txnSvc.voidTransaction(wsId(req), Number(req.params.txnId), req.user.id, req.body?.void_reason, req.membership);
  ok(res, await _enrich(wsId(req), t), null, 'Transaction voided.');
});

// DELETE /transactions/:id — frontend "remove"; we void (never hard-delete).
const deleteTransaction = asyncHandler(async (req, res) => {
  const t = await txnSvc.voidTransaction(wsId(req), Number(req.params.txnId), req.user.id, 'Removed by user', req.membership);
  ok(res, await _enrich(wsId(req), t), null, 'Transaction removed.');
});

module.exports = {
  listAccounts, getAccount, createAccount, updateAccount, deleteAccount,
  listCategories, getCategory, createCategory, updateCategory, deleteCategory,
  listTransactions, getTransaction, createTransaction, updateTransaction, voidTransaction, deleteTransaction,
};
