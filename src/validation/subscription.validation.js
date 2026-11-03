const { z } = require('zod');
const { objectId } = require('./common');

const setupIntentSchema = z.object({
  cleanerId: objectId(),
});

const activateSubscriptionSchema = z.object({
  cleanerId: objectId(),
  // Industrial Pro is no longer sold. Cleaners already on it keep it (the model,
  // prices and labels still know it); nobody new can choose it.
  plan: z.enum(['starter', 'pro']),
  paymentMethodId: z.string().min(1),
});

const insuranceAddOnSchema = z.object({
  cleanerId: objectId(),
});

const cancellationRequestSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

module.exports = {
  setupIntentSchema,
  activateSubscriptionSchema,
  insuranceAddOnSchema,
  cancellationRequestSchema,
};
