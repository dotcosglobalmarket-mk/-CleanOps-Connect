const express = require('express');
const JobController = require('../controllers/JobController');
const ReviewController = require('../controllers/ReviewController');
const { createReviewSchema } = require('../validation/review.validation');
const { requireAuth, requireRole } = require('../middleware/auth');
const { aiWritingLimiter } = require('../middleware/ai-rate-limit');
const { validateBody, validateParams } = require('../middleware/validate');
const {
  createJobSchema,
  describeJobSchema,
  jobIdParamSchema,
  offerIdParamSchema,
  acceptOfferSchema,
  submitQuoteSchema,
  documentParamSchema,
} = require('../validation/job.validation');

const router = express.Router();

router.post(
  '/describe',
  requireAuth,
  requireRole('customer'),
  aiWritingLimiter,
  validateBody(describeJobSchema),
  JobController.describe
);
router.post('/', requireAuth, requireRole('customer'), validateBody(createJobSchema), JobController.create);
router.get('/mine', requireAuth, requireRole('customer'), JobController.listMine);
// Printable service record, and a pre-start compliance pack for industrial jobs.
router.get(
  '/:id/documents/:kind',
  requireAuth,
  requireRole('customer', 'cleaner', 'admin'),
  validateParams(documentParamSchema),
  JobController.document
);
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
// Tenders (industrial jobs): invited cleaners send a quote at their own
// price, and the customer awards one.
router.post(
  '/:id/offers/:offerId/quote',
  requireAuth,
  requireRole('cleaner'),
  validateParams(offerIdParamSchema),
  validateBody(submitQuoteSchema),
  JobController.submitQuote
);
router.post(
  '/:id/offers/:offerId/award',
  requireAuth,
  requireRole('customer', 'admin'),
  validateParams(offerIdParamSchema),
  JobController.awardQuote
);
router.post(
  '/:id/offers/:offerId/decline',
  requireAuth,
  requireRole('cleaner'),
  validateParams(offerIdParamSchema),
  JobController.declineOffer
);

module.exports = router;
