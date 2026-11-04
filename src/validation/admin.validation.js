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

const impersonateCleanerSchema = z.object({
  reason,
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

const resetPayoutSetupSchema = z.object({ reason });

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

const listSubscriptionsQuerySchema = z.object({
  status: z.enum(['active', 'requested', 'ending', 'ended']).optional(),
});

const cancelSubscriptionSchema = z.object({
  when: z.enum(['period_end', 'now']),
  reason,
});

// Without confirm: true the call only previews who would move.
const moveStarterToWeeklySchema = z.object({
  confirm: z.boolean().optional(),
});

const declineCancellationSchema = z.object({
  reason,
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

const resetTwoFactorSchema = z.object({ reason });

const listJobsQuerySchema = z.object({
  status: z.enum(['open', 'allocated', 'in_progress', 'completed', 'cancelled']).optional(),
  paymentStatus: z.enum(Object.values(STATES)).optional(),
});

const revenueQuerySchema = z.object({
  range: z.enum(['7d', '30d', 'year']).optional(),
});

const jobIdParamSchema = z.object({
  id: objectId(),
});

// Privacy requests: always after the person's identity has been checked.
const privacyLookupQuerySchema = z.object({ email: z.string().trim().min(3).max(254) });
const privacyExportQuerySchema = z.object({ identityChecked: z.literal('true', { message: 'Confirm you have checked who is asking' }) });
const privacyEraseSchema = z.object({
  identityChecked: z.literal(true, { message: 'Confirm you have checked who is asking' }),
  confirmEmail: z.string().trim().min(3).max(254),
  reason: z.string().trim().min(3).max(450),
});

const closeDataRequestSchema = z
  .object({
    outcome: z.enum(['done', 'declined']),
    reason: z.string().trim().max(450).optional(),
  })
  .refine((v) => v.outcome !== 'declined' || (v.reason && v.reason.length >= 3), {
    message: 'Say why the request is declined',
    path: ['reason'],
  });

module.exports = {
  closeDataRequestSchema,
  privacyLookupQuerySchema,
  privacyExportQuerySchema,
  privacyEraseSchema,
  listCleanersQuerySchema,
  cleanerIdParamSchema,
  impersonateCleanerSchema,
  updateCleanerVerificationSchema,
  updateCleanerDeactivationSchema,
  resetPayoutSetupSchema,
  listJobsQuerySchema,
  jobIdParamSchema,
  revenueQuerySchema,
  listApprovalsQuerySchema,
  approvalDecisionSchema,
  listAuditQuerySchema,
  listSubscriptionsQuerySchema,
  cancelSubscriptionSchema,
  moveStarterToWeeklySchema,
  declineCancellationSchema,
  listStaffQuerySchema,
  createStaffSchema,
  updateStaffSchema,
  resetTwoFactorSchema,
};
