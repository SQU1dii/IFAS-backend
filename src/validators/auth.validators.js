const { z } = require('zod');

const registerSchema = z.object({
  email:      z.string().email({ message: 'Valid email required' }).max(255),
  password:   z.string()
                .min(8,  { message: 'Password must be at least 8 characters' })
                .max(128, { message: 'Password must be 128 characters or fewer' }),
  full_name:  z.string().min(2, { message: 'Full name required' }).max(255).trim(),
  phone:      z.string().max(40).optional().nullable(),
});

const loginSchema = z.object({
  email:    z.string().email({ message: 'Valid email required' }),
  password: z.string().min(1, { message: 'Password required' }),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(1, { message: 'refresh_token required' }),
});

module.exports = { registerSchema, loginSchema, refreshSchema };
