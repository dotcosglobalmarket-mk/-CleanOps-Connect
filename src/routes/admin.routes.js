const express = require('express');
const AdminController = require('../controllers/AdminController');
const { requireAuth, requireRole, requireActiveStaff, requirePermission } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');
const {
  listCleanersQuerySchema,
  cleanerIdParamSchema,
  impersonateCleanerSchema,
  updateCleanerVerificationSchema,
  updateCleanerDeactivationSchema,
  listJobsQuerySchema,
  jobIdParamSchema,
  revenueQuerySchema,
  listApprovalsQuerySchema,
  approvalDecisionSchema,
  listAuditQuerySchema,
  listStaffQuerySchema,
  createStaffSchema,
  updateStaffSchema,
  resetTwoFactorSchema,
} = require('../validation/admin.validation');
const ComplianceDocumentController = require('../controllers/ComplianceDocumentController');
const {
  listReviewQuerySchema,
  reviewSchema,
  deleteFileSchema,
  documentIdParamSchema,
} = require('../validation/compliance-document.validation');
const { idParamSchema } = require('../validation/ops.validation');

const router = express.Router();

router.use(requireAuth, requireRole('admin'), requireActiveStaff);

router.get('/summary', AdminController.summary);
router.get('/compliance-documents', validateQuery(listReviewQuerySchema), ComplianceDocumentController.listForReview);
router.get('/compliance-documents/:id/file', validateParams(documentIdParamSchema), ComplianceDocumentController.file);
router.delete(
  '/compliance-documents/:id/file',
  validateParams(documentIdParamSchema),
  validateBody(deleteFileSchema),
  ComplianceDocumentController.deleteFile
);
router.post(
  '/compliance-documents/:id/review',
  validateParams(documentIdParamSchema),
  validateBody(reviewSchema),
  ComplianceDocumentController.review
);
router.get('/revenue', validateQuery(revenueQuerySchema), AdminController.revenue);

router.get('/cleaners', validateQuery(listCleanersQuerySchema), AdminController.listCleaners);
router.get('/cleaners/:id', validateParams(cleanerIdParamSchema), AdminController.getCleaner);
// Read-only support view: see exactly what the cleaner sees, never act on
// their behalf (see requireAuth's impersonation handling).
router.post(
  '/cleaners/:id/impersonate',
  requirePermission('cleaners.impersonate'),
  validateParams(cleanerIdParamSchema),
  validateBody(impersonateCleanerSchema),
  AdminController.impersonateCleaner
);
router.patch(
  '/cleaners/:id/verification',
  validateParams(cleanerIdParamSchema),
  validateBody(updateCleanerVerificationSchema),
  AdminController.updateCleanerVerification
);
router.patch(
  '/cleaners/:id/deactivation',
  validateParams(cleanerIdParamSchema),
  validateBody(updateCleanerDeactivationSchema),
  AdminController.updateCleanerDeactivation
);

router.get('/jobs', validateQuery(listJobsQuerySchema), AdminController.listJobs);
router.get('/jobs/:id', validateParams(jobIdParamSchema), AdminController.getJob);
router.post('/jobs/:id/allocate', validateParams(jobIdParamSchema), AdminController.allocateJob);

// Maker-checker: refunds above the ops limit raised by operators.
router.get('/approvals', validateQuery(listApprovalsQuerySchema), AdminController.listApprovals);
router.post(
  '/approvals/:id/decision',
  validateParams(idParamSchema),
  validateBody(approvalDecisionSchema),
  AdminController.decideApproval
);

router.get('/audit', validateQuery(listAuditQuerySchema), AdminController.listAudit);

// Staff (operator/admin) accounts. These cannot be self-registered.
router.get('/users', validateQuery(listStaffQuerySchema), AdminController.listStaff);
router.post('/users', validateBody(createStaffSchema), AdminController.createStaff);
router.post(
  '/users/:id/reset-two-factor',
  validateParams(idParamSchema),
  validateBody(resetTwoFactorSchema),
  AdminController.resetStaffTwoFactor
);
router.patch('/users/:id', validateParams(idParamSchema), validateBody(updateStaffSchema), AdminController.updateStaff);

module.exports = router;
