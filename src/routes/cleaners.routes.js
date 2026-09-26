const express = require('express');
const CleanerController = require('../controllers/CleanerController');
const CleanerPortalController = require('../controllers/CleanerPortalController');
const ReviewController = require('../controllers/ReviewController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');
const {
  createCleanerSchema,
  coverageSchema,
  cleanerIdParamSchema,
  updateMyProfileSchema,
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

router.get('/:id', validateParams(cleanerIdParamSchema), CleanerController.getById);
router.get('/:id/reviews', validateParams(cleanerIdParamSchema), ReviewController.listForCleaner);

module.exports = router;
