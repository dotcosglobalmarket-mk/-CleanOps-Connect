// Thin wrapper around the Stripe SDK. Uses Separate Charges and Transfers
// (never Destination Charges / on_behalf_of at charge time): the customer's
// payment lands in the platform's own Stripe balance, and funds only move
// to the cleaner via an explicit, later Transfer.create() call — that gap
// is the escrow window.
const Stripe = require('stripe');

let stripeClient;

function getClient() {
  if (!stripeClient) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not set in the environment');
    }
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

async function createPaymentIntent({ amountPence, currency = 'gbp', metadata }) {
  return getClient().paymentIntents.create({
    amount: amountPence,
    currency,
    metadata,
  });
}

// Connect Express payout to the cleaner's connected account. Idempotency
// key must be reused across retry attempts (see payment.service.js) —
// Stripe treats a repeated key as "same request", which is exactly what a
// retry of the same transfer needs.
async function createTransfer({ amountPence, destinationAccountId, idempotencyKey, metadata }) {
  return getClient().transfers.create(
    {
      amount: amountPence,
      currency: 'gbp',
      destination: destinationAccountId,
      metadata,
    },
    { idempotencyKey }
  );
}

async function createRefund({ paymentIntentId, amountPence, idempotencyKey }) {
  const params = { payment_intent: paymentIntentId };
  if (amountPence !== undefined) {
    params.amount = amountPence;
  }
  return getClient().refunds.create(params, { idempotencyKey });
}

// Verifies the Stripe signature BEFORE the caller trusts event.id for dedup
// or acts on the payload at all.
function constructWebhookEvent(payload, signatureHeader) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not set in the environment');
  }
  return getClient().webhooks.constructEvent(payload, signatureHeader, process.env.STRIPE_WEBHOOK_SECRET);
}

module.exports = {
  getClient,
  createPaymentIntent,
  createTransfer,
  createRefund,
  constructWebhookEvent,
};
