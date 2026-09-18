const { z } = require('zod');
const { objectId } = require('./common');
const { STATES } = require('../services/payment-state-machine');

const listCleanersQuerySchema = z.object({
  deactivationStatus: z.enum(['active', 'under_review', 'suspended']).optional(),
  verified: z.enum(['true', 'false']).optional(),
});

const cleanerIdParamSchema = z.object({
  id: objectId(),
});

const updateCleanerVerificationSchema = z
  .object({
    dbsVerified: z.boolean().optional(),
    coshhTrained: z.boolean().optional(),
    insuranceStatus: z.enum(['none', 'own', 'platform']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

const updateCleanerDeactivationSchema = z.object({
  deactivationStatus: z.enum(['active', 'under_review', 'suspended']),
});

const listJobsQuerySchema = z.object({
  status: z.enum(['open', 'allocated', 'in_progress', 'completed', 'cancelled']).optional(),
  paymentStatus: z.enum(Object.values(STATES)).optional(),
});

const jobIdParamSchema = z.object({
  id: objectId(),
});

module.exports = {
  listCleanersQuerySchema,
  cleanerIdParamSchema,
  updateCleanerVerificationSchema,
  updateCleanerDeactivationSchema,
  listJobsQuerySchema,
  jobIdParamSchema,
};
