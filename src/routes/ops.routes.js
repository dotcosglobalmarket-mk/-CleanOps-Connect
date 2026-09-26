const express = require('express');
const OpsController = require('../controllers/OpsController');
const ReviewController = require('../controllers/ReviewController');
const { moderationQuerySchema, setReviewVisibilitySchema } = require('../validation/review.validation');
const { requireAuth, requireActiveStaff, requirePermission } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');
const { listCleanersQuerySchema, listJobsQuerySchema } = require('../validation/admin.validation');
const {
  idParamSchema,
  resolveDisputeSchema,
  opsVerificationSchema,
  opsCleanerStatusSchema,
  jobNoteSchema,
} = require('../validation/ops.validation');

// Operator (platform ops staff) API. Admins can use it too. Every route
// re-checks that the staff account is still active, then checks the
// specific permission from src/config/permissions.js.
const router = express.Router();

router.use(requireAuth, requireActiveStaff);

router.get('/summary', requirePermission('summary.read'), OpsController.summary);

router.get('/disputes', requirePermission('disputes.read'), OpsController.listDisputes);
router.get('/disputes/:id', requirePermission('disputes.read'), validateParams(idParamSchema), OpsController.getDispute);
router.post(
  '/disputes/:id/resolve',
  requirePermission('disputes.resolve'),
  validateParams(idParamSchema),
  validateBody(resolveDisputeSchema),
  OpsController.resolveDispute
);

router.get(
  '/cleaners',
  requirePermission('cleaners.read'),
  validateQuery(listCleanersQuerySchema),
  OpsController.listCleaners
);
router.get('/cleaners/:id', requirePermission('cleaners.read'), validateParams(idParamSchema), OpsController.getCleaner);
router.patch(
  '/cleaners/:id/verification',
  requirePermission('cleaners.verify'),
  validateParams(idParamSchema),
  validateBody(opsVerificationSchema),
  OpsController.updateCleanerVerification
);
router.patch(
  '/cleaners/:id/review',
  requirePermission('cleaners.review'),
  validateParams(idParamSchema),
  validateBody(opsCleanerStatusSchema),
  OpsController.updateCleanerStatus
);

router.get('/jobs', requirePermission('jobs.read'), validateQuery(listJobsQuerySchema), OpsController.listJobs);
router.get('/jobs/:id', requirePermission('jobs.read'), validateParams(idParamSchema), OpsController.getJob);
router.post(
  '/jobs/:id/notes',
  requirePermission('jobs.note'),
  validateParams(idParamSchema),
  validateBody(jobNoteSchema),
  OpsController.addJobNote
);

// Review moderation: hide only for a content-policy reason, never because a
// review is negative. Every change is audited.
router.get(
  '/reviews',
  requirePermission('reviews.moderate'),
  validateQuery(moderationQuerySchema),
  ReviewController.listForModeration
);
router.patch(
  '/reviews/:id',
  requirePermission('reviews.moderate'),
  validateParams(idParamSchema),
  validateBody(setReviewVisibilitySchema),
  ReviewController.setVisibility
);

module.exports = router;
