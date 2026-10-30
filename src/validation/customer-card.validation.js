const { z } = require('zod');

const saveCardSchema = z.object({
  paymentMethodId: z.string().regex(/^pm_[A-Za-z0-9_]+$/, 'Not a valid card reference'),
  consent: z.literal(true, { errorMap: () => ({ message: 'Please tick the box to agree before saving your card' }) }),
});

module.exports = { saveCardSchema };
