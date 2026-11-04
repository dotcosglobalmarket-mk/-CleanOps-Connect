const { z } = require('zod');

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, 'Use at least 8 characters').max(200),
});

const dataRequestSchema = z.object({
  type: z.enum(['export', 'erase']),
  note: z.string().trim().max(500).optional(),
  // Asking for an erasure needs the password again (checked in the service).
  currentPassword: z.string().max(200).optional(),
});

module.exports = { changePasswordSchema, dataRequestSchema };
