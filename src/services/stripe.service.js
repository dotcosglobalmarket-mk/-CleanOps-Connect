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

// The customer's browser confirms the payment with this client secret via
// Stripe.js; card details never touch our servers.
async function retrievePaymentIntent(paymentIntentId) {
  return getClient().paymentIntents.retrieve(paymentIntentId);
}

async function cancelPaymentIntent(paymentIntentId) {
  return getClient().paymentIntents.cancel(paymentIntentId);
}

// --- Stripe Connect (Express) for cleaner payouts ---

// Stripe collects and verifies the cleaner's identity and bank details
// during hosted onboarding; we only store the account id.
async function createExpressAccount({ email, cleanerProfileId }) {
  return getClient().accounts.create(
    {
      type: 'express',
      country: 'GB',
      email,
      capabilities: { transfers: { requested: true } },
      metadata: { cleanerProfileId },
    },
    { idempotencyKey: `connect-account:${cleanerProfileId}` }
  );
}

async function createAccountOnboardingLink({ accountId, refreshUrl, returnUrl }) {
  return getClient().accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });
}

async function retrieveAccount(accountId) {
  return getClient().accounts.retrieve(accountId);
}

// Single-use link into the cleaner's Stripe Express dashboard (payouts,
// bank details, tax documents).
async function createExpressDashboardLink(accountId) {
  return getClient().accounts.createLoginLink(accountId);
}

// Verifies the Stripe signature BEFORE the caller trusts event.id for dedup
// or acts on the payload at all.
//
// Stripe signs events from the platform's own account and events from
// connected (cleaner) accounts with different secrets when they come from
// separate webhook endpoints, so either secret is accepted:
// STRIPE_WEBHOOK_SECRET (account events) and STRIPE_CONNECT_WEBHOOK_SECRET
// (Connect events such as account.updated for cleaners' payout set-up).
function constructWebhookEvent(payload, signatureHeader) {
  const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(Boolean);
  if (!secrets.length) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not set in the environment');
  }

  let lastError;
  for (const secret of secrets) {
    try {
      return getClient().webhooks.constructEvent(payload, signatureHeader, secret);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

module.exports = {
  getClient,
  createPaymentIntent,
  createTransfer,
  createRefund,
  retrievePaymentIntent,
  cancelPaymentIntent,
  createExpressAccount,
  createAccountOnboardingLink,
  retrieveAccount,
  createExpressDashboardLink,
  constructWebhookEvent,
};
