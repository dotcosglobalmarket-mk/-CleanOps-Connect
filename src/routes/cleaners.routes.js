const express = require('express');
const CleanerController = require('../controllers/CleanerController');
const CleanerPortalController = require('../controllers/CleanerPortalController');
const ReviewController = require('../controllers/ReviewController');
const CleanerPhotoController = require('../controllers/CleanerPhotoController');
const { STAFF_ROLES } = require('../config/permissions');
const { requireAuth, requireRole } = require('../middleware/auth');
const { aiWritingLimiter } = require('../middleware/ai-rate-limit');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');
const {
  createCleanerSchema,
  coverageSchema,
  cleanerIdParamSchema,
  updateMyProfileSchema,
  describeBioSchema,
  listMyOffersQuerySchema,
} = require('../validation/cleaner.validation');

const router = express.Router();

router.post(
  '/',
  requireAuth,
  requireRole('cleaner'),
  validateBody(createCleanerSchema),
  CleanerController.create
);
router.post(
  '/coverage',
  requireAuth,
  requireRole('cleaner', 'admin'),
  validateBody(coverageSchema),
  CleanerController.setCoverage
);
router.post(
  '/me/describe-bio',
  requireAuth,
  requireRole('cleaner'),
  aiWritingLimiter,
  validateBody(describeBioSchema),
  CleanerController.describeBio
);
router.get('/me', requireAuth, requireRole('cleaner'), CleanerController.getMe);
router.patch(
  '/me',
  requireAuth,
  requireRole('cleaner'),
  validateBody(updateMyProfileSchema),
  CleanerController.updateMe
);
// Cleaner's own work: offers inbox, booked jobs, earnings and payouts.
const cleanerOnly = [requireAuth, requireRole('cleaner')];
router.get('/me/offers', ...cleanerOnly, validateQuery(listMyOffersQuerySchema), CleanerPortalController.listOffers);
router.get('/me/jobs', ...cleanerOnly, CleanerPortalController.listJobs);
router.get('/me/earnings', ...cleanerOnly, CleanerPortalController.earnings);
router.post('/me/payouts/onboarding', ...cleanerOnly, CleanerPortalController.startPayoutOnboarding);
router.get('/me/payouts/status', ...cleanerOnly, CleanerPortalController.payoutStatus);
router.post('/me/payouts/dashboard', ...cleanerOnly, CleanerPortalController.payoutDashboard);

// Optional profile picture or company logo. The image is the raw request body
// (image/jpeg or image/png, up to 1 MB); its first bytes are checked again in the service.
router.post(
  '/me/photo',
  ...cleanerOnly,
  express.raw({ type: ['image/jpeg', 'image/png'], limit: '1mb' }),
  CleanerPhotoController.upload
);
router.delete('/me/photo', ...cleanerOnly, CleanerPhotoController.remove);
router.get(
  '/:id/photo',
  requireAuth,
  requireRole('customer', 'cleaner', ...STAFF_ROLES),
  validateParams(cleanerIdParamSchema),
  CleanerPhotoController.get
);

router.get('/:id', validateParams(cleanerIdParamSchema), CleanerController.getById);
router.get('/:id/reviews', validateParams(cleanerIdParamSchema), ReviewController.listForCleaner);

module.exports = router;
