const Job = require('../models/Job');
const Series = require('../models/Series');
const User = require('../models/User');
const CleanerProfile = require('../models/CleanerProfile');
const { STATES } = require('./payment-state-machine');
const seriesService = require('./series.service');

const LIST_LIMIT = 50;
// Visits shown on a card: those from the last two weeks onwards, up to this many.
const VISITS_BACK_DAYS = 14;
const VISITS_SHOWN = 12;

const CANCELLED_STATES = new Set([
  STATES.CANCELLED,
  STATES.CANCELLED_BY_CLEANER,
  STATES.CANCELLED_BY_CUSTOMER,
  STATES.REFUNDED,
  STATES.PARTIALLY_REFUNDED,
  STATES.RESOLVED_REFUND,
]);
const DONE_STATES = new Set([
  STATES.CONFIRMED,
  STATES.PAYOUT_PENDING,
  STATES.PAYOUT_BLOCKED,
  STATES.TRANSFER_FAILED,
  STATES.MANUAL_REVIEW_HOLD,
  STATES.RESOLVED_PAYOUT,
  STATES.RESOLVED_PARTIAL,
  STATES.PAID_OUT,
]);

// One plain word for where a visit is, whatever its payment state underneath.
function visitState(job) {
  if (job.visitState === 'skipped') return 'skipped';
  if (job.visitState === 'scheduled') return 'scheduled';
  const s = job.paymentStatus;
  if (s === STATES.BOOKED) return 'awaiting_payment';
  if (s === STATES.PAID_HELD) return 'paid';
  if (s === STATES.IN_PROGRESS) return 'in_progress';
  if (s === STATES.AWAITING_CONFIRMATION) return 'awaiting_confirmation';
  if (s === STATES.DISPUTED) return 'disputed';
  if (DONE_STATES.has(s)) return 'done';
  if (CANCELLED_STATES.has(s)) return 'cancelled';
  return 'scheduled';
}

const CAN_STILL_CANCEL = new Set(['scheduled', 'awaiting_payment', 'paid']);

function visitView(job, role, now) {
  const state = visitState(job);
  const upcoming = job.preferredStartAt > now;
  return {
    _id: job._id,
    visitNumber: job.visitNumber,
    startsAt: job.preferredStartAt,
    state,
    skipReason: job.skipReason,
    pricePence: job.pricePence,
    // The first visit is cancelled like an ordinary job, so only later ones get a skip button.
    canSkip: role === 'customer' && job.visitNumber > 1 && CAN_STILL_CANCEL.has(state) && upcoming,
    canCancel: role === 'cleaner' && CAN_STILL_CANCEL.has(state) && upcoming,
  };
}

async function attachVisits(seriesDocs, role, now) {
  const since = new Date(now.getTime() - VISITS_BACK_DAYS * 24 * 3600 * 1000);
  const jobs = await Job.find({ series: { $in: seriesDocs.map((s) => s._id) }, preferredStartAt: { $gte: since } })
    .select('series visitNumber preferredStartAt visitState paymentStatus skipReason pricePence')
    .sort({ visitNumber: 1 })
    .lean();
  const bySeries = {};
  jobs.forEach((j) => {
    const key = String(j.series);
    (bySeries[key] = bySeries[key] || []).push(visitView(j, role, now));
  });
  return bySeries;
}

function base(series) {
  return {
    _id: series._id,
    status: series.status,
    pausedBy: series.pausedBy,
    frequency: series.frequency,
    pricePence: series.pricePence,
    firstVisitAt: series.firstVisitAt,
    endsOn: series.endsOn,
    endNoticeGivenAt: series.endNoticeGivenAt,
    serviceType: series.serviceType,
  };
}

// The signed-in customer's or cleaner's own series, each with its next visits.
// `enabled` tells the page whether to show the section at all while the feature is off.
async function listMine(user, now = new Date()) {
  const enabled = seriesService.isEnabled();
  let filter;
  let populate;
  if (user.role === 'customer') {
    filter = { customer: user.id };
    populate = { path: 'cleaner', select: 'name' };
  } else {
    const profile = await CleanerProfile.findOne({ user: user.id });
    if (!profile) return { enabled, series: [] };
    filter = { cleaner: profile._id };
    populate = { path: 'customer', select: 'name' };
  }

  const docs = await Series.find(filter)
    .populate('serviceType', 'name')
    .populate(populate)
    .sort({ createdAt: -1 })
    .limit(LIST_LIMIT)
    .lean();
  if (!docs.length) return { enabled, series: [] };

  const visits = await attachVisits(docs, user.role, now);
  let hasCard = true;
  if (user.role === 'customer') {
    const me = await User.findById(user.id);
    hasCard = Boolean(me && me.savedCard && me.savedCard.paymentMethodId);
  }

  const series = docs.map((s) => ({
    ...base(s),
    with: user.role === 'customer' ? s.cleaner && s.cleaner.name : s.customer && s.customer.name,
    // The series cannot start until a card is saved, so the page asks for one.
    needsCard: user.role === 'customer' && s.status !== 'cancelled' && s.status !== 'ended' && !hasCard,
    visits: (visits[String(s._id)] || []).slice(0, VISITS_SHOWN),
  }));
  return { enabled, series };
}

// Staff view of every series, with what needs attention first.
async function listForStaff({ status } = {}, now = new Date()) {
  const filter = status ? { status } : {};
  const docs = await Series.find(filter)
    .populate('serviceType', 'name')
    .populate('cleaner', 'name companyName')
    .populate('customer', 'name email')
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  if (!docs.length) return [];

  const upcoming = await Job.find({
    series: { $in: docs.map((s) => s._id) },
    preferredStartAt: { $gt: now },
    visitState: { $ne: 'skipped' },
  })
    .select('series preferredStartAt')
    .sort({ preferredStartAt: 1 })
    .lean();
  const next = {};
  upcoming.forEach((j) => {
    if (!next[String(j.series)]) next[String(j.series)] = j.preferredStartAt;
  });

  return docs.map((s) => ({
    ...base(s),
    customer: s.customer && { name: s.customer.name, email: s.customer.email },
    cleaner: s.cleaner && (s.cleaner.companyName || s.cleaner.name),
    visitsCreated: s.visitsCreated,
    paymentFailureStreak: s.paymentFailureStreak || 0,
    cleanerCancellations: s.cleanerCancellations || 0,
    nextVisitAt: next[String(s._id)],
    createdAt: s.createdAt,
  }));
}

module.exports = { visitState, listMine, listForStaff };
