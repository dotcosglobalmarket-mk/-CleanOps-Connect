const { z } = require('zod');

const enableSmsSchema = z.object({
  mobile: z.string().trim().min(6).max(30),
  consentVersion: z.string().min(1).max(40),
  consent: z.literal(true, { errorMap: () => ({ message: 'Please tick the box to agree' }) }),
});

module.exports = { enableSmsSchema };
