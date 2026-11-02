const { z } = require('zod');

const agreeSchema = z.object({
  consentVersion: z.string().min(1).max(40),
  consent: z.literal(true, { errorMap: () => ({ message: 'Please tick the box to agree' }) }),
});

const saveCardSchema = z.object({
  consentVersion: z.string().min(1).max(40),
  paymentMethodId: z.string().regex(/^pm_[A-Za-z0-9_]+$/, 'Not a valid card reference'),
  consent: z.literal(true, { errorMap: () => ({ message: 'Please tick the box to agree before saving your card' }) }),
});

module.exports = { saveCardSchema, agreeSchema };
