const { z } = require('zod');
const { WORKSPACE_TYPES } = require('../config/constants');

const createWorkspaceSchema = z.object({
  name:           z.string().min(2).max(255).trim(),
  workspace_type: z.enum(WORKSPACE_TYPES, { errorMap: () => ({ message: `workspace_type must be one of: ${WORKSPACE_TYPES.join(', ')}` }) }),
  currency:       z.string().length(3).toUpperCase().optional().default('KES'),
});

const updateWorkspaceSchema = z.object({
  name:     z.string().min(2).max(255).trim().optional(),
  currency: z.string().length(3).toUpperCase().optional(),
});

const addMemberSchema = z.object({
  user_id:      z.number().int().positive(),
  role_name:    z.string().min(1).max(80).trim(),
  department_id: z.number().int().positive().optional().nullable(),
});

const updateMemberSchema = z.object({
  role_name:    z.string().min(1).max(80).trim().optional(),
  department_id: z.number().int().positive().optional().nullable(),
});

const createDepartmentSchema = z.object({
  name: z.string().min(2).max(120).trim(),
});

const updateDepartmentSchema = z.object({
  name: z.string().min(2).max(120).trim(),
});

module.exports = {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  addMemberSchema,
  updateMemberSchema,
  createDepartmentSchema,
  updateDepartmentSchema,
};
