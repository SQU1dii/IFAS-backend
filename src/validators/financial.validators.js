'use strict';
const { z } = require('zod');
const { ACCOUNT_TYPES, CATEGORY_TYPES, TXN_TYPES } = require('../config/constants');

// ── Accounts ─────────────────────────────────────────────────────────────────
const createAccountSchema = z.object({
  name:            z.string().min(1).max(120).trim(),
  account_type:    z.enum(ACCOUNT_TYPES).optional(),
  type:            z.enum(ACCOUNT_TYPES).optional(),
  opening_balance: z.number().min(0).optional(),
  balance:         z.number().min(0).optional(),
  currency:        z.string().max(3).optional(),
  institution:      z.string().max(255).optional(),
}).passthrough().refine((d) => d.account_type || d.type, { message: 'account_type (or type) is required', path: ['type'] });

const updateAccountSchema = z.object({
  name:            z.string().min(1).max(120).trim().optional(),
  account_type:    z.enum(ACCOUNT_TYPES).optional(),
  type:            z.enum(ACCOUNT_TYPES).optional(),
  opening_balance: z.number().min(0).optional(),
  balance:         z.number().min(0).optional(),
}).passthrough();

// ── Categories ────────────────────────────────────────────────────────────────
const createCategorySchema = z.object({
  name:          z.string().min(1).max(120).trim(),
  category_type: z.enum(CATEGORY_TYPES).optional(),
  type:          z.enum(CATEGORY_TYPES).optional(),
}).passthrough().refine((d) => d.category_type || d.type, { message: 'category_type (or type) is required', path: ['type'] });

const updateCategorySchema = z.object({
  name:          z.string().min(1).max(120).trim().optional(),
  category_type: z.enum(CATEGORY_TYPES).optional(),
  type:          z.enum(CATEGORY_TYPES).optional(),
}).passthrough();

// ── Transactions ──────────────────────────────────────────────────────────────
const createTransactionSchema = z.object({
  txn_type:     z.enum(TXN_TYPES).optional(),
  type:         z.enum([...TXN_TYPES.map((t) => t.toLowerCase())]).optional(),
  amount:       z.number().positive({ message: 'amount must be > 0' }),
  txn_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'txn_date must be YYYY-MM-DD').optional(),
  date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
  description:  z.string().min(1).max(255).trim(),
  account_id:   z.number().int().positive(),
  to_account_id: z.number().int().positive().optional().nullable(),
  destination_account_id: z.number().int().positive().optional().nullable(),
  category_id:  z.number().int().positive().optional().nullable(),
  department_id: z.number().int().positive().optional().nullable(),
  notes:        z.string().max(500).optional(),
}).passthrough()
  .superRefine((d, ctx) => {
    const txnType = (d.txn_type || (d.type ? d.type.toUpperCase() : '') || '').toUpperCase();
    if (!TXN_TYPES.includes(txnType)) {
      ctx.addIssue({ code: 'custom', path: ['type'], message: 'type must be income, expense, or transfer' });
      return;
    }
    if (txnType !== 'TRANSFER' && !d.category_id) {
      ctx.addIssue({ code: 'custom', path: ['category_id'], message: 'category_id required for income and expense' });
    }
    if (txnType === 'TRANSFER' && !(d.to_account_id || d.destination_account_id)) {
      ctx.addIssue({ code: 'custom', path: ['destination_account_id'], message: 'destination_account_id required for transfer' });
    }
    if (txnType === 'TRANSFER') {
      const dest = d.to_account_id || d.destination_account_id;
      if (dest && dest === d.account_id) {
        ctx.addIssue({ code: 'custom', path: ['destination_account_id'], message: 'destination_account_id must differ from account_id' });
      }
    }
    if (!d.txn_date && !d.date) {
      ctx.addIssue({ code: 'custom', path: ['date'], message: 'date is required' });
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
  type:          z.enum([...TXN_TYPES.map((t) => t.toLowerCase()), '']).optional(),
  status:        z.enum(['POSTED', 'VOID', '']).optional(),
  account_id:    z.coerce.number().int().positive().optional(),
  category_id:   z.coerce.number().int().positive().optional(),
  department_id: z.coerce.number().int().positive().optional(),
  date_from:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  from:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search:        z.string().max(200).optional(),
}).passthrough();

module.exports = {
  createAccountSchema, updateAccountSchema,
  createCategorySchema, updateCategorySchema,
  createTransactionSchema, updateTransactionSchema, voidTransactionSchema,
  listTransactionSchema,
};
