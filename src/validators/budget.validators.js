'use strict';
const { z } = require('zod');

const createBudgetSchema = z.object({
  category_id:   z.number().int().positive().optional().nullable(),
  department_id: z.number().int().positive().optional().nullable(),
  period_start:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount_limit:  z.number().positive(),
  alert_threshold: z.number().int().min(1).max(100).default(80),
}).superRefine((d, ctx) => {
  if (d.period_end < d.period_start) {
    ctx.addIssue({ code: 'custom', path: ['period_end'], message: 'period_end must be >= period_start' });
  }
  if (!d.category_id && !d.department_id) {
    ctx.addIssue({ code: 'custom', path: ['category_id'], message: 'Provide at least one of category_id or department_id' });
  }
});

const updateBudgetSchema = z.object({
  amount_limit:    z.number().positive().optional(),
  alert_threshold: z.number().int().min(1).max(100).optional(),
  period_start:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period_end:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const createGoalSchema = z.object({
  name:          z.string().min(1).max(255).trim(),
  target_amount: z.number().positive(),
  saved_amount:  z.number().min(0).default(0),
  target_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

const updateGoalSchema = z.object({
  name:          z.string().min(1).max(255).trim().optional(),
  target_amount: z.number().positive().optional(),
  saved_amount:  z.number().min(0).optional(),
  target_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

module.exports = { createBudgetSchema, updateBudgetSchema, createGoalSchema, updateGoalSchema };
