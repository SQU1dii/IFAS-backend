'use strict';
const { z } = require('zod');

const registerSchema = z.object({
  email:      z.string().email({ message: 'Valid email required' }).max(255),
  password:   z.string().min(8, { message: 'Password must be at least 8 characters' }).max(128),
  // Accept either `full_name` (API) or `name` (frontend).
  full_name:  z.string().min(2).max(255).trim().optional(),
  name:       z.string().min(2).max(255).trim().optional(),
  phone:      z.string().max(40).optional().nullable(),
}).refine((d) => d.full_name || d.name, { message: 'Name is required', path: ['name'] });

const loginSchema = z.object({
  email:    z.string().email({ message: 'Valid email required' }),
  password: z.string().min(1, { message: 'Password required' }),
});

const updateProfileSchema = z.object({
  name:      z.string().min(2).max(255).trim().optional(),
  full_name: z.string().min(2).max(255).trim().optional(),
  phone:     z.string().max(40).optional().nullable(),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password:    z.string().min(8, { message: 'New password must be at least 8 characters' }),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token:    z.string().min(1),
  password: z.string().min(8),
});

module.exports = {
  registerSchema, loginSchema,
  updateProfileSchema, changePasswordSchema,
  forgotPasswordSchema, resetPasswordSchema,
};
