const CleanerProfile = require('../models/CleanerProfile');
const Subscription = require('../models/Subscription');
const SubscriptionPayment = require('../models/SubscriptionPayment');
const User = require('../models/User');
const stripeService = require('./stripe.service');
const notificationService = require('./notification.service');

// The only platform fees — see the business decision this was built from.
// Pro and Industrial Pro share a price; only the plan label differs.
const PLAN_PRICES_PENCE = {
  starter: 250,
  pro: 1000,
  industrial_pro: 1000,
};

const PLAN_LABELS = {
  starter: 'CleanOps Starter',
  pro: 'CleanOps Pro',
  industrial_pro: 'CleanOps Industrial Pro',
};

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

async function requireOwnedCleaner(cleanerId, requestingUser) {
  const cleaner = await CleanerProfile.findById(cleanerId);
  if (!cleaner) {
    throw notFound('Cleaner not found');
  }
  if (requestingUser.role !== 'admin' && cleaner.user.toString() !== requestingUser.id) {
    throw forbidden('You do not have access to this cleaner profile');
  }
  return cleaner;
}

// Creates the billing Customer on first use and claims it atomically, the
// same pattern as startPayoutOnboarding's Connect account claim — a double
// click must not leave two Customers for one cleaner.
async function ensureStripeCustomer(cleaner) {
  if (cleaner.stripeCustomerId) return cleaner.stripeCustomerId;

  const user = await User.findById(cleaner.user);
  const customer = await stripeService.createCustomer({
    email: user ? user.email : undefined,
    metadata: { cleanerProfileId: cleaner._id.toString() },
  });

  const claimed = await CleanerProfile.findOneAndUpdate(
    { _id: cleaner._id, stripeCustomerId: { $in: [null, ''] } },
    { $set: { stripeCustomerId: customer.id } },
    { new: true }
  );
  return claimed ? claimed.stripeCustomerId : (await CleanerProfile.findById(cleaner._id)).stripeCustomerId;
}

async function createSetupIntent(cleanerId, requestingUser) {
  const cleaner = await requireOwnedCleaner(cleanerId, requestingUser);
  const customerId = await ensureStripeCustomer(cleaner);
  const setupIntent = await stripeService.createSetupIntent({
    customerId,
    metadata: { cleanerProfileId: cleaner._id.toString() },
  });
  return { clientSecret: setupIntent.client_secret };
}

async function getMySubscription(userId) {
  const cleaner = await CleanerProfile.findOne({ user: userId });
  if (!cleaner) return null;
  return Subscription.findOne({ cleaner: cleaner._id, isActive: true }).sort({ createdAt: -1 });
}

function currentPeriodEndUnix(stripeSubscription) {
  return stripeSubscription.current_period_end ?? stripeSubscription.items?.data?.[0]?.current_period_end;
}

async function activateSubscription(cleanerId, plan, paymentMethodId, requestingUser) {
  const cleaner = await requireOwnedCleaner(cleanerId, requestingUser);
  if (!cleaner.stripeCustomerId) {
    throw badRequest('Set up a payment method first');
  }

  // The client only ever hands us a payment method id it just confirmed via
  // Stripe.js — verify it actually belongs to this cleaner's Customer
  // before trusting it, rather than taking the id on faith.
  const paymentMethod = await stripeService.retrievePaymentMethod(paymentMethodId);
  if (paymentMethod.customer !== cleaner.stripeCustomerId) {
    throw forbidden('This payment method does not belong to you');
  }

  await stripeService.setDefaultPaymentMethod({ customerId: cleaner.stripeCustomerId, paymentMethodId });

  // A cleaner can only have one live platform-fee subscription — switching
  // plans cancels the old one first rather than running two in parallel.
  const existing = await Subscription.findOne({ cleaner: cleaner._id, isActive: true }).sort({ createdAt: -1 });
  if (existing && existing.stripeSubscriptionId) {
    await stripeService.cancelSubscription(existing.stripeSubscriptionId);
    existing.isActive = false;
    existing.stripeStatus = 'canceled';
    await existing.save();
  }

  const pricePence = PLAN_PRICES_PENCE[plan];
  const stripeSubscription = await stripeService.createSubscription({
    customerId: cleaner.stripeCustomerId,
    pricePence,
    productName: PLAN_LABELS[plan],
    paymentMethodId,
    metadata: { cleanerProfileId: cleaner._id.toString(), plan },
  });

  const periodEndUnix = currentPeriodEndUnix(stripeSubscription);
  const subscription = new Subscription({
    cleaner: cleanerId,
    plan,
    pricePence,
    isActive: ['active', 'trialing'].includes(stripeSubscription.status),
    stripeSubscriptionId: stripeSubscription.id,
    stripeStatus: stripeSubscription.status,
    startedAt: new Date(),
    renewsAt: periodEndUnix ? new Date(periodEndUnix * 1000) : undefined,
  });

  await subscription.save();
  return subscription;
}

async function addInsuranceAddOn(cleanerId, requestingUser) {
  await requireOwnedCleaner(cleanerId, requestingUser);

  const subscription = await Subscription.findOne({ cleaner: cleanerId, isActive: true }).sort({
    createdAt: -1,
  });

  if (!subscription) {
    throw notFound('No active subscription found for this cleaner');
  }

  subscription.insuranceAddOn = true;
  await subscription.save();
  return subscription;
}

// --- Stripe webhooks ---

async function handleStripeSubscriptionUpdated(stripeSubscription) {
  const subscription = await Subscription.findOne({ stripeSubscriptionId: stripeSubscription.id });
  if (!subscription) return null;

  subscription.stripeStatus = stripeSubscription.status;
  subscription.isActive = ['active', 'trialing'].includes(stripeSubscription.status);
  const periodEndUnix = currentPeriodEndUnix(stripeSubscription);
  if (periodEndUnix) {
    subscription.renewsAt = new Date(periodEndUnix * 1000);
  }
  await subscription.save();
  return subscription;
}

// Newer Stripe API versions moved the subscription link from invoice.subscription
// to invoice.parent.subscription_details.subscription; accept either.
function invoiceSubscriptionId(invoice) {
  const link = invoice.subscription || (invoice.parent && invoice.parent.subscription_details && invoice.parent.subscription_details.subscription);
  if (!link) return null;
  return typeof link === 'string' ? link : link.id || null;
}

// Keeps one row per invoice. A late "failed" event never overwrites a payment
// that already succeeded (events can arrive out of order).
async function recordInvoicePayment(invoice, subscription, status) {
  const existing = await SubscriptionPayment.findOne({ stripeInvoiceId: invoice.id });
  if (existing && existing.status === 'paid' && status === 'failed') return existing;

  const fields = {
    stripeSubscriptionId: subscription.stripeSubscriptionId,
    cleaner: subscription.cleaner,
    plan: subscription.plan,
    amountPence: status === 'paid' ? invoice.amount_paid : invoice.amount_due,
    status,
    attemptCount: invoice.attempt_count,
    nextRetryAt: status === 'failed' && invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000) : undefined,
    occurredAt: new Date((invoice.status_transitions && invoice.status_transitions.paid_at ? invoice.status_transitions.paid_at : invoice.created || Date.now() / 1000) * 1000),
  };
  if (status === 'failed') fields.occurredAt = new Date();

  if (existing) {
    Object.assign(existing, fields);
    await existing.save();
    return existing;
  }
  return SubscriptionPayment.create({ stripeInvoiceId: invoice.id, ...fields });
}

async function handleInvoicePaymentFailed(invoice) {
  const stripeSubscriptionId = invoiceSubscriptionId(invoice);
  if (!stripeSubscriptionId) return null;
  const subscription = await Subscription.findOne({ stripeSubscriptionId });
  if (!subscription) return null;

  await recordInvoicePayment(invoice, subscription, 'failed');

  const cleaner = await CleanerProfile.findById(subscription.cleaner);
  if (cleaner) {
    await notificationService.subscriptionPaymentFailed(cleaner);
  }
  return subscription;
}

async function handleInvoicePaid(invoice) {
  const stripeSubscriptionId = invoiceSubscriptionId(invoice);
  if (!stripeSubscriptionId) return null;
  const subscription = await Subscription.findOne({ stripeSubscriptionId });
  if (!subscription) return null;

  await recordInvoicePayment(invoice, subscription, 'paid');
  return subscription;
}

module.exports = {
  PLAN_PRICES_PENCE,
  createSetupIntent,
  activateSubscription,
  addInsuranceAddOn,
  getMySubscription,
  handleStripeSubscriptionUpdated,
  handleInvoicePaymentFailed,
  handleInvoicePaid,
};
