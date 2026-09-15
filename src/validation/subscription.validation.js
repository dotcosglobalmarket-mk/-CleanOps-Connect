const { z } = require('zod');
const { objectId } = require('./common');

const activateSubscriptionSchema = z.object({
  cleanerId: objectId(),
  plan: z.enum(['starter', 'pro', 'industrial_pro']),
});

const insuranceAddOnSchema = z.object({
  cleanerId: objectId(),
});

module.exports = {
  activateSubscriptionSchema,
  insuranceAddOnSchema,
};
