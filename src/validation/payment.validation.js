const { z } = require('zod');
const { objectId } = require('./common');

const bookJobSchema = z.object({
  cleanerId: objectId(),
  pricePence: z.number().int().positive(),
});

const jobIdParamSchema = z.object({
  id: objectId(),
});

const raiseDisputeSchema = z.object({
  reasonCode: z.enum(['not_completed', 'quality_issue', 'damage_caused', 'no_show', 'other']),
  detail: z.string().max(2000).optional(),
});

const resolvePartialSchema = z.object({
  refundPence: z.number().int().nonnegative(),
  payoutPence: z.number().int().nonnegative(),
});

module.exports = {
  bookJobSchema,
  jobIdParamSchema,
  raiseDisputeSchema,
  resolvePartialSchema,
};
