const mongoose = require('mongoose');
const Review = require('../models/Review');
const Job = require('../models/Job');
const CleanerProfile = require('../models/CleanerProfile');
const auditService = require('./audit.service');
const { STATES } = require('./payment-state-machine');

const PUBLIC_LIST_LIMIT = 50;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// "Rachel Hughes" -> "Rachel H." — enough to show a real person wrote it
// without publishing their full name.
function displayName(name) {
  if (!name) return 'Verified customer';
  const [first, ...rest] = String(name).trim().split(/\s+/);
  const last = rest.length ? rest[rest.length - 1] : '';
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

function publicView(review) {
  return {
    _id: review._id,
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt,
    reviewer: displayName(review.customer && review.customer.name),
    cleaner: review.cleaner && review.cleaner.name ? { _id: review.cleaner._id, name: review.cleaner.name } : undefined,
  };
}

// A job can be reviewed once the cleaner has marked it complete and it is
// no longer waiting for the customer's confirmation or under dispute.
function isReviewable(job) {
  return (
    Boolean(job.awaitingConfirmationAt) &&
    Boolean(job.cleaner) &&
    ![STATES.AWAITING_CONFIRMATION, STATES.DISPUTED].includes(job.paymentStatus)
  );
}

async function recalculateCleanerRating(cleanerId) {
  const [stats] = await Review.aggregate([
    { $match: { cleaner: new mongoose.Types.ObjectId(String(cleanerId)), status: 'published' } },
    { $group: { _id: '$cleaner', average: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const ratingAverage = stats ? Math.round(stats.average * 10) / 10 : 0;
  const ratingCount = stats ? stats.count : 0;
  await CleanerProfile.updateOne({ _id: cleanerId }, { $set: { ratingAverage, ratingCount } });
  return { ratingAverage, ratingCount };
}

async function createReview(jobId, { rating, comment }, user) {
  const job = await Job.findById(jobId);
  if (!job) throw httpError(404, 'Job not found');
  if (job.customer.toString() !== user.id) throw httpError(403, 'Only the customer who booked this job can review it');
  if (!isReviewable(job)) {
    throw httpError(400, 'You can review a job once it has been completed and confirmed');
  }

  let review;
  try {
    review = await Review.create({
      job: job._id,
      customer: user.id,
      cleaner: job.cleaner,
      rating,
      comment: comment || undefined,
    });
  } catch (err) {
    if (err && err.code === 11000) throw httpError(409, 'You have already reviewed this job');
    throw err;
  }

  await recalculateCleanerRating(job.cleaner);
  return review;
}

async function getReviewForJob(jobId, user) {
  const job = await Job.findById(jobId);
  if (!job) throw httpError(404, 'Job not found');
  if (job.customer.toString() !== user.id) throw httpError(403, 'You do not have access to this job');
  const review = await Review.findOne({ job: job._id });
  return { review, canReview: !review && isReviewable(job) };
}

async function listForCleaner(cleanerId) {
  const reviews = await Review.find({ cleaner: cleanerId, status: 'published' })
    .populate('customer', 'name')
    .sort({ createdAt: -1 })
    .limit(PUBLIC_LIST_LIMIT);
  return reviews.map(publicView);
}

// Latest reviews in date order, whatever the rating, with the overall
// average — showing only hand-picked positive reviews would mislead
// customers (Digital Markets, Competition and Consumers Act 2024).
async function listLatest({ limit = 6 } = {}) {
  const [reviews, [stats]] = await Promise.all([
    Review.find({ status: 'published', comment: { $nin: [null, ''] } })
      .populate('customer', 'name')
      .populate('cleaner', 'name')
      .sort({ createdAt: -1 })
      .limit(limit),
    Review.aggregate([
      { $match: { status: 'published' } },
      { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]),
  ]);
  return {
    averageRating: stats ? Math.round(stats.average * 10) / 10 : null,
    count: stats ? stats.count : 0,
    reviews: reviews.map(publicView),
  };
}

async function listForModeration({ status } = {}) {
  const filter = status ? { status } : {};
  return Review.find(filter)
    .populate('customer', 'name email')
    .populate('cleaner', 'name')
    .sort({ createdAt: -1 })
    .limit(200);
}

async function setVisibility(reviewId, { hidden, reason }, req) {
  const review = await Review.findById(reviewId);
  if (!review) throw httpError(404, 'Review not found');

  const before = { status: review.status };
  review.status = hidden ? 'hidden' : 'published';
  review.hiddenReason = hidden ? reason : undefined;
  await review.save();

  await auditService.record({
    req,
    action: hidden ? 'review.hide' : 'review.publish',
    targetType: 'review',
    targetId: review._id,
    before,
    after: { status: review.status },
    reason,
  });
  await recalculateCleanerRating(review.cleaner);
  return review;
}

module.exports = {
  displayName,
  isReviewable,
  recalculateCleanerRating,
  createReview,
  getReviewForJob,
  listForCleaner,
  listLatest,
  listForModeration,
  setVisibility,
};
