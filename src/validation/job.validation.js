const { z } = require('zod');
const { objectId } = require('./common');

// A tender must stay open long enough to answer and not drag on.
const MIN_TENDER_HOURS = 1;
const MAX_TENDER_DAYS = 30;

const tenderSchema = z.object({
  closesAt: z.coerce
    .date()
    .refine((d) => d.getTime() > Date.now() + MIN_TENDER_HOURS * 3600 * 1000, {
      message: `The closing time must be at least ${MIN_TENDER_HOURS} hour from now`,
    })
    .refine((d) => d.getTime() <= Date.now() + MAX_TENDER_DAYS * 24 * 3600 * 1000, {
      message: `The closing time can be at most ${MAX_TENDER_DAYS} days from now`,
    }),
  requirements: z.string().trim().max(3000).optional(),
});

const createJobSchema = z
  .object({
    serviceType: objectId(),
    category: z.enum(['domestic', 'industrial']),
    postcode: z.string().min(1),
    description: z.string().optional(),
    estimatedHours: z.number().positive().optional(),
    frequency: z.enum(['one_off', 'weekly', 'monthly', 'contract']).optional(),
    budgetMin: z.number().nonnegative(),
    budgetMax: z.number().nonnegative(),
    tender: tenderSchema.optional(),
  })
  .refine((data) => data.budgetMax >= data.budgetMin, {
    message: 'budgetMax must be greater than or equal to budgetMin',
    path: ['budgetMax'],
  })
  .refine((data) => !data.tender || data.category === 'industrial', {
    message: 'Only industrial jobs can be run as a tender',
    path: ['tender'],
  });

const describeJobSchema = z.object({
  category: z.enum(['domestic', 'industrial']),
  serviceType: objectId().optional(),
  frequency: z.enum(['one_off', 'weekly', 'monthly', 'contract']).optional(),
  estimatedHours: z.number().positive().max(1000).optional(),
  draft: z.string().trim().max(2000).optional(),
});

const jobIdParamSchema = z.object({
  id: objectId(),
});

const offerIdParamSchema = z.object({
  id: objectId(),
  offerId: objectId(),
});

const acceptOfferSchema = z.object({
  pricePence: z.number().int().positive(),
});

const submitQuoteSchema = z.object({
  pricePence: z.number().int().positive().max(100000000),
  message: z.string().trim().max(1500).optional(),
});

module.exports = {
  submitQuoteSchema,
  describeJobSchema,
  createJobSchema,
  jobIdParamSchema,
  offerIdParamSchema,
  acceptOfferSchema,
};
