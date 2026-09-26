const { z } = require('zod');
const { objectId } = require('./common');

const reason = z.string().trim().min(3, 'Please give a reason').max(2000);

const idParamSchema = z.object({
  id: objectId(),
});

const resolveDisputeSchema = z
  .object({
    outcome: z.enum(['payout', 'refund', 'partial']),
    refundPence: z.number().int().positive().optional(),
    reason,
  })
  .refine((data) => data.outcome !== 'partial' || data.refundPence !== undefined, {
    message: 'refundPence is required for a partial refund',
    path: ['refundPence'],
  });

const opsVerificationSchema = z
  .object({
    dbsVerified: z.boolean().optional(),
    coshhTrained: z.boolean().optional(),
    insuranceStatus: z.enum(['none', 'own', 'platform']).optional(),
    reason,
  })
  .refine(
    (data) => ['dbsVerified', 'coshhTrained', 'insuranceStatus'].some((field) => data[field] !== undefined),
    { message: 'At least one verification field is required' }
  );

const opsCleanerStatusSchema = z.object({
  deactivationStatus: z.enum(['active', 'under_review']),
  reason,
});

const jobNoteSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

const manualRetrySchema = z.object({
  reason: reason.optional(),
});

module.exports = {
  reason,
  idParamSchema,
  resolveDisputeSchema,
  opsVerificationSchema,
  opsCleanerStatusSchema,
  jobNoteSchema,
  manualRetrySchema,
};
