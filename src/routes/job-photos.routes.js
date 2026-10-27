const express = require('express');
const JobPhotoController = require('../controllers/JobPhotoController');
const { requireAuth, requireRole, requireActiveStaff } = require('../middleware/auth');
const { validateParams, validateQuery } = require('../middleware/validate');
const { photoParamSchema, jobParamSchema, uploadQuerySchema } = require('../validation/job-photo.validation');
const { STAFF_ROLES } = require('../config/permissions');

// Mounted at /jobs/:id/photos. The job's customer and booked cleaner, and staff,
// can see the photos; only the two parties add them (see job-photo.service.js).
const router = express.Router({ mergeParams: true });

router.use(requireAuth, requireRole('customer', 'cleaner', ...STAFF_ROLES));
// Staff tokens last for days, so re-check the account is still active.
router.use((req, res, next) => (STAFF_ROLES.includes(req.user.role) ? requireActiveStaff(req, res, next) : next()));

router.get('/', validateParams(jobParamSchema), JobPhotoController.list);

// The photo is the request body (Content-Type: image/jpeg or image/png), up to
// 5 MB. Its first bytes are checked again in the service.
router.post(
  '/',
  requireRole('customer', 'cleaner'),
  express.raw({ type: ['image/jpeg', 'image/png'], limit: '5mb' }),
  validateParams(jobParamSchema),
  validateQuery(uploadQuerySchema),
  JobPhotoController.upload
);
router.get('/:photoId/file', validateParams(photoParamSchema), JobPhotoController.file);
router.delete('/:photoId', requireRole('customer', 'cleaner'), validateParams(photoParamSchema), JobPhotoController.remove);

module.exports = router;
