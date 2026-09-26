const express = require('express');
const JobController = require('../controllers/JobController');
const ReviewController = require('../controllers/ReviewController');
const { createReviewSchema } = require('../validation/review.validation');
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
router.get('/mine', requireAuth, requireRole('customer'), JobController.listMine);
router.get('/:id', requireAuth, validateParams(jobIdParamSchema), JobController.getById);
router.get(
  '/:id/offers',
  requireAuth,
  requireRole('customer', 'admin'),
  validateParams(jobIdParamSchema),
  JobController.listOffers
);
router.get('/:id/review', requireAuth, requireRole('customer'), validateParams(jobIdParamSchema), ReviewController.getForJob);
router.post(
  '/:id/review',
  requireAuth,
  requireRole('customer'),
  validateParams(jobIdParamSchema),
  validateBody(createReviewSchema),
  ReviewController.create
);
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
