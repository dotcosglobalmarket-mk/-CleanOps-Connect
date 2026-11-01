const User = require('../models/User');
const stripeService = require('./stripe.service');

// The wording shown beside the tick box when a card is saved. It is stored by
// version with each agreement, so a card always records exactly what was agreed.
// Change the text => change the version: cards agreed under an older version do not
// authorise recurring charges until the customer agrees again.
const CARD_CONSENT = Object.freeze({
  version: 'card-v2',
  text:
    'I agree that CleanOps Connect may keep this card with Stripe and charge it for bookings I have agreed. ' +
    'For a regular booking (weekly, fortnightly or monthly), each visit is charged to this card 48 hours before it, ' +
    'at the price per visit shown above, until the series ends or I cancel it. If a payment cannot be taken, that visit ' +
    'is skipped and I am told. I can skip a visit for free until it is charged, pause or cancel a series, or remove this ' +
    'card, at any time from my account.',
});
const CARD_CONSENT_VERSION = CARD_CONSENT.version;
// Wording versions that allow a card to be charged automatically for later visits.
const RECURRING_CONSENT_VERSIONS = [CARD_CONSENT_VERSION];

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function requireCustomer(userId) {
  const user = await User.findById(userId);
  if (!user) throw httpError(404, 'Account not found');
  return user;
}

// Creates the Stripe Customer on first use and claims it atomically, so a double
// click cannot leave two Customers for one account.
async function ensureStripeCustomer(user) {
  if (user.stripeCustomerId) {
    // A customer saved under another Stripe mode no longer exists: start again.
    try {
      const existing = await stripeService.retrieveCustomer(user.stripeCustomerId);
      if (existing && !existing.deleted) return user.stripeCustomerId;
    } catch (err) {
      if (!stripeService.isMissingResource(err)) throw err;
    }
    const fresh = await stripeService.createCustomer({ email: user.email, metadata: { userId: user._id.toString() } });
    await User.updateOne({ _id: user._id }, { $set: { stripeCustomerId: fresh.id }, $unset: { savedCard: '' } });
    user.stripeCustomerId = fresh.id;
    return fresh.id;
  }

  const customer = await stripeService.createCustomer({
    email: user.email,
    metadata: { userId: user._id.toString() },
  });

  const claimed = await User.findOneAndUpdate(
    { _id: user._id, stripeCustomerId: { $in: [null, ''] } },
    { $set: { stripeCustomerId: customer.id } },
    { new: true }
  );
  return claimed ? claimed.stripeCustomerId : (await User.findById(user._id)).stripeCustomerId;
}

// Has this customer agreed, under wording that covers it, to later visits being charged
// to their saved card?
function hasRecurringConsent(user) {
  const card = user && user.savedCard;
  return Boolean(card && card.paymentMethodId && RECURRING_CONSENT_VERSIONS.includes(card.consentVersion));
}

function cardView(user) {
  const card = user.savedCard;
  const consent = { version: CARD_CONSENT.version, text: CARD_CONSENT.text };
  if (!card || !card.paymentMethodId) return { saved: false, consent };
  return {
    saved: true,
    consent,
    // False for a card agreed under older wording: it is kept, but must be agreed to again.
    recurringConsent: hasRecurringConsent(user),
    brand: card.brand,
    last4: card.last4,
    expMonth: card.expMonth,
    expYear: card.expYear,
    savedAt: card.consentAt,
  };
}

async function getCard(userId) {
  return cardView(await requireCustomer(userId));
}

async function createSetupIntent(userId) {
  const user = await requireCustomer(userId);
  const customerId = await ensureStripeCustomer(user);
  // off_session: the card may be charged later without the customer present.
  const setupIntent = await stripeService.createSetupIntent({
    customerId,
    metadata: { userId: user._id.toString() },
    paymentMethodTypes: ['card'],
  });
  return { clientSecret: setupIntent.client_secret };
}

// The browser hands back a payment method id it just confirmed with Stripe.js.
// Check it really belongs to this customer before trusting it.
function requireCurrentConsent(consent, consentVersion) {
  if (consent !== true) throw httpError(400, 'Please tick the box to agree before saving your card');
  if (consentVersion !== CARD_CONSENT_VERSION) {
    throw httpError(409, 'The wording you agree to has just been updated. Please read it and tick the box again.');
  }
}

function logConsent(user, event, card) {
  user.cardConsentLog = user.cardConsentLog || [];
  user.cardConsentLog.push({ event, at: new Date(), version: CARD_CONSENT_VERSION, brand: card.brand, last4: card.last4 });
}

async function saveCard(userId, paymentMethodId, consent, consentVersion) {
  requireCurrentConsent(consent, consentVersion);

  const user = await requireCustomer(userId);
  if (!user.stripeCustomerId) throw httpError(400, 'Start saving a card first');

  const paymentMethod = await stripeService.retrievePaymentMethod(paymentMethodId);
  if (paymentMethod.customer !== user.stripeCustomerId) {
    throw httpError(403, 'This card does not belong to you');
  }
  if (paymentMethod.type !== 'card' || !paymentMethod.card) {
    throw httpError(400, 'Only debit and credit cards can be saved');
  }

  const previous = user.savedCard && user.savedCard.paymentMethodId;
  await stripeService.setDefaultPaymentMethod({ customerId: user.stripeCustomerId, paymentMethodId });

  user.savedCard = {
    paymentMethodId,
    brand: paymentMethod.card.brand,
    last4: paymentMethod.card.last4,
    expMonth: paymentMethod.card.exp_month,
    expYear: paymentMethod.card.exp_year,
    consentAt: new Date(),
    consentVersion: CARD_CONSENT_VERSION,
  };
  logConsent(user, 'saved', user.savedCard);
  await user.save();

  // Replacing a card removes the old one from Stripe too, so only one is kept.
  if (previous && previous !== paymentMethodId) {
    await stripeService.detachPaymentMethod(previous).catch(() => {});
  }
  return cardView(user);
}

// A card saved under older wording is kept; the customer agrees to the current wording.
async function agreeToCurrentWording(userId, consent, consentVersion) {
  requireCurrentConsent(consent, consentVersion);
  const user = await requireCustomer(userId);
  if (!user.savedCard || !user.savedCard.paymentMethodId) throw httpError(400, 'You have no saved card');

  user.savedCard.consentAt = new Date();
  user.savedCard.consentVersion = CARD_CONSENT_VERSION;
  logConsent(user, 'agreed', user.savedCard);
  await user.save();
  return cardView(user);
}

async function removeCard(userId) {
  const user = await requireCustomer(userId);
  const current = user.savedCard && user.savedCard.paymentMethodId;
  if (!current) throw httpError(400, 'You have no saved card');

  await stripeService.detachPaymentMethod(current);
  logConsent(user, 'removed', user.savedCard);
  user.savedCard = undefined;
  await user.save();
  return { saved: false };
}

module.exports = {
  CARD_CONSENT,
  CARD_CONSENT_VERSION,
  hasRecurringConsent,
  getCard,
  createSetupIntent,
  saveCard,
  agreeToCurrentWording,
  removeCard,
};
