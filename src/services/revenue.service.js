const Job = require('../models/Job');
const Series = require('../models/Series');
const Subscription = require('../models/Subscription');
const SubscriptionPayment = require('../models/SubscriptionPayment');
const { STATES } = require('./payment-state-machine');
const { PLAN_PRICES_PENCE } = require('./subscription.service');

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS_SHOWN = 8;
const RECENT_PAYMENTS_LIMIT = 20;

// A job's commission counts as platform revenue once the customer has
// confirmed it, whatever has happened to the payout since. Refunds, disputes
// and partial resolutions are left out: their commission is not settled.
const REVENUE_STATES = [
  STATES.CONFIRMED,
  STATES.PAYOUT_PENDING,
  STATES.PAYOUT_BLOCKED,
  STATES.TRANSFER_FAILED,
  STATES.MANUAL_REVIEW_HOLD,
  STATES.PAID_OUT,
];

const PLAN_LABELS = { starter: 'Starter', pro: 'Pro', industrial_pro: 'Industrial Pro' };

function rangeBounds(range, now) {
  if (range === 'year') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const previousStart = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
    return { start, previousStart };
  }
  const days = range === '7d' ? 7 : 30;
  return { start: new Date(now.getTime() - days * DAY_MS), previousStart: new Date(now.getTime() - 2 * days * DAY_MS) };
}

const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] || 0), 0);
const inWindow = (date, from, to) => date >= from && (!to || date < to);

async function getRevenue({ range = '30d' } = {}, now = new Date()) {
  const { start, previousStart } = rangeBounds(range, now);
  const weeksStart = new Date(now.getTime() - WEEKS_SHOWN * 7 * DAY_MS);
  const earliest = new Date(Math.min(previousStart.getTime(), weeksStart.getTime()));

  const [jobs, payments, activeSubscriptions, atRiskSubscriptions, recent, activeSeries] = await Promise.all([
    Job.find({ paymentStatus: { $in: REVENUE_STATES }, confirmedAt: { $gte: earliest } })
      .select('commissionPence confirmedAt series')
      .lean(),
    SubscriptionPayment.find({ status: 'paid', occurredAt: { $gte: earliest } })
      .select('amountPence occurredAt')
      .lean(),
    Subscription.find({ isActive: true }).select('plan pricePence').lean(),
    Subscription.find({ stripeStatus: { $in: ['past_due', 'unpaid'] } })
      .populate('cleaner', 'name companyName')
      .lean(),
    SubscriptionPayment.find({})
      .sort({ occurredAt: -1 })
      .limit(RECENT_PAYMENTS_LIMIT)
      .populate('cleaner', 'name companyName')
      .lean(),
    Series.countDocuments({ status: 'active' }),
  ]);

  const commissionNow = jobs.filter((j) => inWindow(j.confirmedAt, start));
  const commissionBefore = jobs.filter((j) => inWindow(j.confirmedAt, previousStart, start));
  const billedNow = payments.filter((p) => inWindow(p.occurredAt, start));
  const billedBefore = payments.filter((p) => inWindow(p.occurredAt, previousStart, start));

  const commissionPence = sum(commissionNow, 'commissionPence');
  const subscriptionBilledPence = sum(billedNow, 'amountPence');
  const totalPence = commissionPence + subscriptionBilledPence;
  const previousTotalPence = sum(commissionBefore, 'commissionPence') + sum(billedBefore, 'amountPence');

  const weeks = Array.from({ length: WEEKS_SHOWN }, (_, i) => {
    const from = new Date(now.getTime() - (WEEKS_SHOWN - i) * 7 * DAY_MS);
    const to = new Date(from.getTime() + 7 * DAY_MS);
    return {
      from,
      commissionPence: sum(jobs.filter((j) => inWindow(j.confirmedAt, from, to)), 'commissionPence'),
      subscriptionPence: sum(payments.filter((p) => inWindow(p.occurredAt, from, to)), 'amountPence'),
    };
  });

  const planCounts = {};
  activeSubscriptions.forEach((s) => {
    const row = planCounts[s.plan] || (planCounts[s.plan] = { plan: s.plan, label: PLAN_LABELS[s.plan] || s.plan, cleaners: 0, monthlyPence: 0 });
    row.cleaners += 1;
    row.monthlyPence += typeof s.pricePence === 'number' ? s.pricePence : PLAN_PRICES_PENCE[s.plan] || 0;
  });
  const plans = Object.values(planCounts);

  const failedByStripeId = {};
  if (atRiskSubscriptions.length) {
    const failed = await SubscriptionPayment.find({
      status: 'failed',
      stripeSubscriptionId: { $in: atRiskSubscriptions.map((s) => s.stripeSubscriptionId).filter(Boolean) },
    })
      .sort({ occurredAt: -1 })
      .lean();
    failed.forEach((f) => {
      if (!failedByStripeId[f.stripeSubscriptionId]) failedByStripeId[f.stripeSubscriptionId] = f;
    });
  }
  const atRisk = atRiskSubscriptions.map((s) => {
    const failure = failedByStripeId[s.stripeSubscriptionId];
    return {
      cleanerId: s.cleaner && s.cleaner._id,
      cleaner: s.cleaner ? s.cleaner.companyName || s.cleaner.name : 'Unknown cleaner',
      plan: s.plan,
      planLabel: PLAN_LABELS[s.plan] || s.plan,
      status: s.stripeStatus,
      amountPence: typeof s.pricePence === 'number' ? s.pricePence : PLAN_PRICES_PENCE[s.plan] || 0,
      failedOn: failure ? failure.occurredAt : null,
      nextRetryAt: failure ? failure.nextRetryAt || null : null,
    };
  });

  return {
    range,
    from: start,
    to: now,
    totals: {
      totalPence,
      previousTotalPence,
      commissionPence,
      jobsCount: commissionNow.length,
      // Part of the commission above: visits of regular (recurring) bookings.
      recurringCommissionPence: sum(commissionNow.filter((j) => j.series), 'commissionPence'),
      recurringVisitsCount: commissionNow.filter((j) => j.series).length,
      activeSeriesCount: activeSeries,
      subscriptionBilledPence,
      mrrPence: sum(plans, 'monthlyPence'),
      activeSubscribers: activeSubscriptions.length,
      failedCount: atRisk.length,
      atRiskPence: sum(atRisk, 'amountPence'),
    },
    weeks,
    plans,
    atRisk,
    recentPayments: recent.map((p) => ({
      occurredAt: p.occurredAt,
      cleaner: p.cleaner ? p.cleaner.companyName || p.cleaner.name : 'Unknown cleaner',
      planLabel: PLAN_LABELS[p.plan] || p.plan || '—',
      status: p.status,
      amountPence: p.amountPence,
    })),
  };
}

module.exports = { getRevenue, REVENUE_STATES };
