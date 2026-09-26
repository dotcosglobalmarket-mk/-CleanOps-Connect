const { z } = require('zod');
const { objectId } = require('./common');
const { reason } = require('./ops.validation');
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
    reason: reason.optional(),
  })
  .refine(
    (data) => ['dbsVerified', 'coshhTrained', 'insuranceStatus'].some((field) => data[field] !== undefined),
    { message: 'At least one field is required' }
  );

const updateCleanerDeactivationSchema = z.object({
  deactivationStatus: z.enum(['active', 'under_review', 'suspended']),
  reason: reason.optional(),
});

const listApprovalsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});

const approvalDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason,
});

const listAuditQuerySchema = z.object({
  actor: objectId().optional(),
  action: z.string().max(100).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

const listStaffQuerySchema = z.object({
  role: z.enum(['operator', 'admin']).optional(),
});

const createStaffSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(12, 'Staff passwords must be at least 12 characters'),
  role: z.enum(['operator', 'admin']),
});

const updateStaffSchema = z.object({
  active: z.boolean(),
  reason,
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
  listApprovalsQuerySchema,
  approvalDecisionSchema,
  listAuditQuerySchema,
  listStaffQuerySchema,
  createStaffSchema,
  updateStaffSchema,
};
