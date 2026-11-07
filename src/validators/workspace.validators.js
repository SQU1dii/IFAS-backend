const { z } = require('zod');
const { WORKSPACE_TYPES } = require('../config/constants');

const createWorkspaceSchema = z.object({
  name:           z.string().min(2).max(255).trim(),
  workspace_type: z.enum(WORKSPACE_TYPES, { errorMap: () => ({ message: `workspace_type must be one of: ${WORKSPACE_TYPES.join(', ')}` }) }).optional(),
  type:           z.enum(WORKSPACE_TYPES, { errorMap: () => ({ message: `type must be one of: ${WORKSPACE_TYPES.join(', ')}` }) }).optional(),
  currency:       z.string().length(3).toUpperCase().optional().default('KES'),
}).refine((d) => d.workspace_type || d.type, { message: 'workspace_type (or type) is required', path: ['workspace_type'] });

const updateWorkspaceSchema = z.object({
  name:     z.string().min(2).max(255).trim().optional(),
  currency: z.string().length(3).toUpperCase().optional(),
});

const addMemberSchema = z.object({
  user_id:       z.number().int().positive().optional(),
  email:         z.string().email().optional(),
  role_name:     z.string().min(1).max(80).trim().optional(),
  role:          z.string().min(1).max(80).trim().optional(),
  name:          z.string().max(255).trim().optional(),
  department_id: z.number().int().positive().optional().nullable(),
}).refine((d) => d.user_id || d.email, { message: 'user_id or email is required', path: ['email'] });

const updateMemberSchema = z.object({
  role_name:    z.string().min(1).max(80).trim().optional(),
  role:         z.string().min(1).max(80).trim().optional(),
  department_id: z.number().int().positive().optional().nullable(),
});

const createDepartmentSchema = z.object({
  name:      z.string().min(2).max(120).trim(),
  budget:    z.number().min(0).optional(),
  head_name: z.string().max(255).optional(),
}).passthrough();

const updateDepartmentSchema = z.object({
  name:      z.string().min(2).max(120).trim().optional(),
  budget:    z.number().min(0).optional(),
  head_name: z.string().max(255).optional(),
}).passthrough();

module.exports = {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  addMemberSchema,
  updateMemberSchema,
  createDepartmentSchema,
  updateDepartmentSchema,
};
