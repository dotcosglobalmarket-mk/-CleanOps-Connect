const express = require('express');
const { rateLimit } = require('express-rate-limit');
const JobController = require('../controllers/JobController');
const ReviewController = require('../controllers/ReviewController');
const { createReviewSchema } = require('../validation/review.validation');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateBody, validateParams } = require('../middleware/validate');
const {
  createJobSchema,
  describeJobSchema,
  jobIdParamSchema,
  offerIdParamSchema,
  acceptOfferSchema,
} = require('../validation/job.validation');

const router = express.Router();

// Each call costs money, so cap it per client IP.
const describeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.AI_DESCRIBE_RATE_LIMIT_MAX) || 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many writing-help requests, please try again later' },
});

router.post(
  '/describe',
  requireAuth,
  requireRole('customer'),
  describeLimiter,
  validateBody(describeJobSchema),
  JobController.describe
);
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
