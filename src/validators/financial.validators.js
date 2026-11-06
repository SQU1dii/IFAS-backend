'use strict';
const { z } = require('zod');
const { ACCOUNT_TYPES, CATEGORY_TYPES, TXN_TYPES } = require('../config/constants');

// ── Accounts ─────────────────────────────────────────────────────────────────
const createAccountSchema = z.object({
  name:            z.string().min(1).max(120).trim(),
  account_type:    z.enum(ACCOUNT_TYPES),
  opening_balance: z.number().min(0).default(0),
});

const updateAccountSchema = z.object({
  name:            z.string().min(1).max(120).trim().optional(),
  account_type:    z.enum(ACCOUNT_TYPES).optional(),
  opening_balance: z.number().min(0).optional(),
});

// ── Categories ────────────────────────────────────────────────────────────────
const createCategorySchema = z.object({
  name:          z.string().min(1).max(120).trim(),
  category_type: z.enum(CATEGORY_TYPES),
});

const updateCategorySchema = z.object({
  name:          z.string().min(1).max(120).trim().optional(),
  category_type: z.enum(CATEGORY_TYPES).optional(),
});

// ── Transactions ──────────────────────────────────────────────────────────────
const createTransactionSchema = z.object({
  txn_type:     z.enum(TXN_TYPES),
  amount:       z.number().positive({ message: 'amount must be > 0' }),
  txn_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'txn_date must be YYYY-MM-DD'),
  description:  z.string().min(1).max(255).trim(),
  account_id:   z.number().int().positive(),
  to_account_id: z.number().int().positive().optional().nullable(),
  category_id:  z.number().int().positive().optional().nullable(),
  department_id: z.number().int().positive().optional().nullable(),
}).superRefine((d, ctx) => {
  if (d.txn_type !== 'TRANSFER' && !d.category_id) {
    ctx.addIssue({ code: 'custom', path: ['category_id'], message: 'category_id required for INCOME and EXPENSE' });
  }
  if (d.txn_type === 'TRANSFER' && !d.to_account_id) {
    ctx.addIssue({ code: 'custom', path: ['to_account_id'], message: 'to_account_id required for TRANSFER' });
  }
  if (d.txn_type === 'TRANSFER' && d.to_account_id && d.to_account_id === d.account_id) {
    ctx.addIssue({ code: 'custom', path: ['to_account_id'], message: 'to_account_id must differ from account_id' });
  }
});

const updateTransactionSchema = z.object({
  txn_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description:  z.string().min(1).max(255).trim().optional(),
  category_id:  z.number().int().positive().optional().nullable(),
  department_id: z.number().int().positive().optional().nullable(),
  amount:       z.number().positive().optional(),
});

const voidTransactionSchema = z.object({
  void_reason: z.string().max(255).optional().nullable(),
});

const listTransactionSchema = z.object({
  page:          z.coerce.number().int().positive().default(1),
  page_size:     z.coerce.number().int().min(1).max(200).default(50),
  txn_type:      z.enum([...TXN_TYPES, '']).optional(),
  status:        z.enum(['POSTED', 'VOID', '']).optional(),
  account_id:    z.coerce.number().int().positive().optional(),
  category_id:   z.coerce.number().int().positive().optional(),
  department_id: z.coerce.number().int().positive().optional(),
  date_from:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

module.exports = {
  createAccountSchema, updateAccountSchema,
  createCategorySchema, updateCategorySchema,
  createTransactionSchema, updateTransactionSchema, voidTransactionSchema,
  listTransactionSchema,
};
