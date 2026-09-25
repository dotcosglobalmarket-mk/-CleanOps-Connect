const { z } = require('zod');

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  // Self-registration is limited to marketplace roles. Admin accounts must
  // never be creatable from a public endpoint.
  role: z.enum(['customer', 'cleaner']),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

module.exports = {
  registerSchema,
  loginSchema,
};
