const express = require('express');
const PaymentController = require('../controllers/PaymentController');
const { requireAuth, requireRole, requireActiveStaff, requirePermission } = require('../middleware/auth');
const { validateBody, validateParams } = require('../middleware/validate');
const {
  bookJobSchema,
  jobIdParamSchema,
  raiseDisputeSchema,
  resolvePartialSchema,
} = require('../validation/payment.validation');
const { manualRetrySchema } = require('../validation/ops.validation');

const router = express.Router();

// Normal bookings happen when a cleaner accepts an offer at the price they
// set (POST /jobs/:id/offers/:offerId/accept). This endpoint is an admin-only
// manual override; a customer must never choose the cleaner's price.
router.post(
  '/jobs/:id/book',
  requireAuth,
  requireRole('admin'),
  requireActiveStaff,
  validateParams(jobIdParamSchema),
  validateBody(bookJobSchema),
  PaymentController.book
);
router.post('/jobs/:id/cancel', requireAuth, validateParams(jobIdParamSchema), PaymentController.cancel);
router.post(
  '/jobs/:id/check-in',
  requireAuth,
  requireRole('cleaner'),
  validateParams(jobIdParamSchema),
  PaymentController.checkIn
);
router.post(
  '/jobs/:id/complete',
  requireAuth,
  requireRole('cleaner'),
  validateParams(jobIdParamSchema),
  PaymentController.markComplete
);
router.post(
  '/jobs/:id/confirm',
  requireAuth,
  requireRole('customer', 'admin'),
  validateParams(jobIdParamSchema),
  PaymentController.confirm
);
router.post(
  '/jobs/:id/dispute',
  requireAuth,
  requireRole('customer', 'admin'),
  validateParams(jobIdParamSchema),
  validateBody(raiseDisputeSchema),
  PaymentController.raiseDispute
);
router.post(
  '/jobs/:id/resolve/refund',
  requireAuth,
  requireRole('admin'),
  requireActiveStaff,
  validateParams(jobIdParamSchema),
  PaymentController.resolveRefund
);
router.post(
  '/jobs/:id/resolve/partial',
  requireAuth,
  requireRole('admin'),
  requireActiveStaff,
  validateParams(jobIdParamSchema),
  validateBody(resolvePartialSchema),
  PaymentController.resolvePartial
);
router.post(
  '/jobs/:id/resolve/payout',
  requireAuth,
  requireRole('admin'),
  requireActiveStaff,
  validateParams(jobIdParamSchema),
  PaymentController.resolvePayout
);

// Ops-facing queue for MANUAL_REVIEW_HOLD / PAYOUT_BLOCKED jobs. Operators
// and admins; the manual retry is audited.
router.get(
  '/ops/queue',
  requireAuth,
  requireActiveStaff,
  requirePermission('payments.queue.read'),
  PaymentController.opsQueue
);
router.post(
  '/ops/jobs/:id/manual-retry',
  requireAuth,
  requireActiveStaff,
  requirePermission('payments.retry'),
  validateParams(jobIdParamSchema),
  validateBody(manualRetrySchema),
  PaymentController.manualRetry
);

module.exports = router;
