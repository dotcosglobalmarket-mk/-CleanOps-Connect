const paymentService = require('../services/payment.service');
const opsService = require('../services/ops.service');
const stripeService = require('../services/stripe.service');
const Job = require('../models/Job');
const CleanerProfile = require('../models/CleanerProfile');

function wrap(fn) {
  return async (req, res, next) => {
    try {
      const result = await fn(req, res);
      res.status(result.status || 200).json(result.body);
    } catch (err) {
      next(err);
    }
  };
}

const book = wrap(async (req) => ({
  status: 201,
  body: await paymentService.bookJob({
    jobId: req.params.id,
    cleanerId: req.body.cleanerId,
    pricePence: req.body.pricePence,
  }),
}));

const cancel = wrap(async (req) => {
  const job = await Job.findById(req.params.id);
  if (!job) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }

  if (req.user.role === 'cleaner') {
    const cleaner = await CleanerProfile.findOne({ user: req.user.id });
    if (!cleaner || !job.cleaner || job.cleaner.toString() !== cleaner._id.toString()) {
      const err = new Error('You do not have access to this job');
      err.status = 403;
      throw err;
    }
    return { body: await paymentService.cancelByCleaner(req.params.id) };
  }

  if (job.customer.toString() !== req.user.id && req.user.role !== 'admin') {
    const err = new Error('You do not have access to this job');
    err.status = 403;
    throw err;
  }
  if (job.paymentStatus === 'BOOKED') {
    return { body: await paymentService.cancelBooked(req.params.id) };
  }
  return { body: await paymentService.cancelByCustomer(req.params.id) };
});

async function requireOwningCleaner(req) {
  const job = await Job.findById(req.params.id);
  if (!job) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }
  const cleaner = await CleanerProfile.findOne({ user: req.user.id });
  if (!cleaner || !job.cleaner || job.cleaner.toString() !== cleaner._id.toString()) {
    const err = new Error('You do not have access to this job');
    err.status = 403;
    throw err;
  }
}

async function requireOwningCustomer(req) {
  const job = await Job.findById(req.params.id);
  if (!job) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }
  if (job.customer.toString() !== req.user.id && req.user.role !== 'admin') {
    const err = new Error('You do not have access to this job');
    err.status = 403;
    throw err;
  }
}

// The customer pays for a booked job in the browser with Stripe.js. Only
// the client secret is returned — it lets the customer's browser confirm
// this one payment and nothing else.
const paymentIntent = wrap(async (req) => {
  await requireOwningCustomer(req);
  const job = await Job.findById(req.params.id);
  if (job.paymentStatus !== 'BOOKED' || !job.stripePaymentIntentId) {
    const err = new Error('This job is not waiting for payment');
    err.status = 400;
    throw err;
  }
  const intent = await stripeService.retrievePaymentIntent(job.stripePaymentIntentId);
  return { body: { clientSecret: intent.client_secret, amountPence: job.pricePence, status: intent.status } };
});

const checkIn = wrap(async (req) => {
  await requireOwningCleaner(req);
  return { body: await paymentService.checkIn(req.params.id) };
});

const markComplete = wrap(async (req) => {
  await requireOwningCleaner(req);
  return { body: await paymentService.markComplete(req.params.id) };
});

const confirm = wrap(async (req) => {
  await requireOwningCustomer(req);
  return { body: await paymentService.confirmJob(req.params.id) };
});

const raiseDispute = wrap(async (req) => {
  await requireOwningCustomer(req);
  return { body: await paymentService.raiseDispute(req.params.id, req.body.reasonCode, req.body.detail) };
});

const resolveRefund = wrap(async (req) => ({ body: await paymentService.resolveDisputeRefund(req.params.id) }));

const resolvePartial = wrap(async (req) => ({
  body: await paymentService.resolveDisputePartial(req.params.id, req.body),
}));

const resolvePayout = wrap(async (req) => ({ body: await paymentService.resolveDisputePayout(req.params.id) }));

const manualRetry = wrap(async (req) => ({
  body: await opsService.manualRetryTransfer(req.params.id, req.body.reason || 'Manual payout retry', req),
}));

const opsQueue = wrap(async () => {
  const jobs = await Job.find({
    paymentStatus: { $in: ['MANUAL_REVIEW_HOLD', 'PAYOUT_BLOCKED'] },
  })
    .populate('customer', 'name email')
    .populate('cleaner', 'name')
    .sort({ updatedAt: 1 });
  return { body: jobs };
});

module.exports = {
  book,
  cancel,
  paymentIntent,
  checkIn,
  markComplete,
  confirm,
  raiseDispute,
  resolveRefund,
  resolvePartial,
  resolvePayout,
  manualRetry,
  opsQueue,
};
