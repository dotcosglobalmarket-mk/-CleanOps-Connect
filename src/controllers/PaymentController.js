const paymentService = require('../services/payment.service');
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
  return { body: await paymentService.raiseDispute(req.params.id, req.body.reasonCode) };
});

const resolveRefund = wrap(async (req) => ({ body: await paymentService.resolveDisputeRefund(req.params.id) }));

const resolvePartial = wrap(async (req) => ({
  body: await paymentService.resolveDisputePartial(req.params.id, req.body),
}));

const resolvePayout = wrap(async (req) => ({ body: await paymentService.resolveDisputePayout(req.params.id) }));

const manualRetry = wrap(async (req) => ({ body: await paymentService.manualRetryTransfer(req.params.id) }));

const opsQueue = wrap(async () => {
  const jobs = await Job.find({
    paymentStatus: { $in: ['MANUAL_REVIEW_HOLD', 'PAYOUT_BLOCKED'] },
  }).sort({ updatedAt: 1 });
  return { body: jobs };
});

module.exports = {
  book,
  cancel,
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
