const express = require('express');
const JobController = require('../controllers/JobController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateBody, validateParams } = require('../middleware/validate');
const {
  createJobSchema,
  jobIdParamSchema,
  offerIdParamSchema,
  acceptOfferSchema,
} = require('../validation/job.validation');

const router = express.Router();

router.post('/', requireAuth, requireRole('customer'), validateBody(createJobSchema), JobController.create);
router.get('/:id', requireAuth, validateParams(jobIdParamSchema), JobController.getById);
router.post('/:id/allocate', requireAuth, validateParams(jobIdParamSchema), JobController.allocate);
router.post(
  '/:id/offers/:offerId/accept',
  requireAuth,
  requireRole('cleaner'),
  validateParams(offerIdParamSchema),
  validateBody(acceptOfferSchema),
  JobController.acceptOffer
);
router.post(
  '/:id/offers/:offerId/decline',
  requireAuth,
  requireRole('cleaner'),
  validateParams(offerIdParamSchema),
  JobController.declineOffer
);

module.exports = router;
