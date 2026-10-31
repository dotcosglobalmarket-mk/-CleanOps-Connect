const User = require('../models/User');
const stripeService = require('./stripe.service');

// Which wording the customer agreed to when saving the card. The wording itself
// is shown on the customer page; bump this when it changes so each saved card
// records exactly what it was saved under.
const CARD_CONSENT_VERSION = 'card-v1';

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

function cardView(user) {
  const card = user.savedCard;
  if (!card || !card.paymentMethodId) return { saved: false };
  return {
    saved: true,
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
async function saveCard(userId, paymentMethodId, consent) {
  if (consent !== true) throw httpError(400, 'Please tick the box to agree before saving your card');

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
  await user.save();

  // Replacing a card removes the old one from Stripe too, so only one is kept.
  if (previous && previous !== paymentMethodId) {
    await stripeService.detachPaymentMethod(previous).catch(() => {});
  }
  return cardView(user);
}

async function removeCard(userId) {
  const user = await requireCustomer(userId);
  const current = user.savedCard && user.savedCard.paymentMethodId;
  if (!current) throw httpError(400, 'You have no saved card');

  await stripeService.detachPaymentMethod(current);
  user.savedCard = undefined;
  await user.save();
  return { saved: false };
}

module.exports = { CARD_CONSENT_VERSION, getCard, createSetupIntent, saveCard, removeCard };
