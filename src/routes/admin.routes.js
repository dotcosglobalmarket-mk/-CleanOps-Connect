const express = require('express');
const AdminController = require('../controllers/AdminController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');
const {
  listCleanersQuerySchema,
  cleanerIdParamSchema,
  updateCleanerVerificationSchema,
  updateCleanerDeactivationSchema,
  listJobsQuerySchema,
  jobIdParamSchema,
} = require('../validation/admin.validation');

const router = express.Router();

router.use(requireAuth, requireRole('admin'));

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

module.exports = router;
