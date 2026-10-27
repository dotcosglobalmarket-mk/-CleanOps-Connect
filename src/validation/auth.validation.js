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

const requestPasswordResetSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

const twoFactorSetupSchema = z.object({ setupToken: z.string().min(1) });

const twoFactorEnableSchema = z.object({
  setupToken: z.string().min(1),
  code: z.string().min(6).max(12),
});

const twoFactorVerifySchema = z.object({
  challengeToken: z.string().min(1),
  // A six-digit code, or a recovery code such as ABCDE-FGHJK.
  code: z.string().min(6).max(20),
});

module.exports = {
  twoFactorSetupSchema,
  twoFactorEnableSchema,
  twoFactorVerifySchema,
  registerSchema,
  loginSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
};
