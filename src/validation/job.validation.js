const { z } = require('zod');
const { objectId } = require('./common');

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
  })
  .refine((data) => data.budgetMax >= data.budgetMin, {
    message: 'budgetMax must be greater than or equal to budgetMin',
    path: ['budgetMax'],
  });

const jobIdParamSchema = z.object({
  id: objectId(),
});

module.exports = {
  createJobSchema,
  jobIdParamSchema,
};
