const express = require('express');
const AdminController = require('../controllers/AdminController');
const { requireAuth, requireRole, requireActiveStaff } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');
const {
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
} = require('../validation/admin.validation');
const { idParamSchema } = require('../validation/ops.validation');

const router = express.Router();

router.use(requireAuth, requireRole('admin'), requireActiveStaff);

router.get('/summary', AdminController.summary);

router.get('/cleaners', validateQuery(listCleanersQuerySchema), AdminController.listCleaners);
router.get('/cleaners/:id', validateParams(cleanerIdParamSchema), AdminController.getCleaner);
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
router.patch('/users/:id', validateParams(idParamSchema), validateBody(updateStaffSchema), AdminController.updateStaff);

module.exports = router;
