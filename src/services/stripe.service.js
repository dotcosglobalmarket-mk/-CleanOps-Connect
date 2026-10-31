// Thin wrapper around the Stripe SDK. Uses Separate Charges and Transfers
// (never Destination Charges / on_behalf_of at charge time): the customer's
// payment lands in the platform's own Stripe balance, and funds only move
// to the cleaner via an explicit, later Transfer.create() call — that gap
// is the escrow window.
const https = require('https');
const Stripe = require('stripe');

let stripeClient;

// DigitalOcean App Platform (and several other container hosts) have been
// seen to advertise IPv6 egress that doesn't actually route to the public
// internet: Node tries the AAAA address first, it hangs/fails, and every
// outbound HTTPS call times out even though the service is otherwise up and
// IPv4 works fine. Forcing IPv4 here is the fix for exactly that failure
// mode (seen as Stripe's SDK reporting "An error occurred with our
// connection to Stripe" after exhausting its retries).
const stripeHttpAgent = new https.Agent({ family: 4 });

function getClient() {
  if (!stripeClient) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not set in the environment');
    }
    // A hung connection to Stripe should fail in seconds with a clear message, not
    // hold the request open until the host's gateway gives up with a bare 504.
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
      httpAgent: stripeHttpAgent,
      timeout: 20000,
      maxNetworkRetries: 1,
    });
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

// --- Platform billing (monthly subscription fee charged TO the cleaner) ---
// Uses a plain Customer on the platform's own account — distinct from the
// Connect Express account above, which funds are paid OUT to.

// Stripe says "No such customer / payment_intent / subscription" when an id we
// stored does not exist for the key in use, e.g. it was created with a test-mode
// key and the site now runs on the live one. Callers replace such ids.
function isMissingResource(err) {
  return Boolean(err) && (err.code === 'resource_missing' || err.statusCode === 404);
}

async function retrieveCustomer(customerId) {
  return getClient().customers.retrieve(customerId);
}

async function createCustomer({ email, metadata }) {
  return getClient().customers.create({ email, metadata });
}

async function createSetupIntent({ customerId, metadata, paymentMethodTypes }) {
  // usage: 'off_session' — this payment method is charged automatically
  // every month, not while the cleaner is present to re-authenticate.
  return getClient().setupIntents.create({
    customer: customerId,
    usage: 'off_session',
    metadata,
    ...(paymentMethodTypes ? { payment_method_types: paymentMethodTypes } : {}),
  });
}

async function retrievePaymentMethod(paymentMethodId) {
  return getClient().paymentMethods.retrieve(paymentMethodId);
}

async function detachPaymentMethod(paymentMethodId) {
  return getClient().paymentMethods.detach(paymentMethodId);
}

async function setDefaultPaymentMethod({ customerId, paymentMethodId }) {
  return getClient().customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
}

// Subscription item price_data takes a Product ID, not inline product
// details (unlike one-off PaymentIntent/Checkout prices) — Stripe rejects
// `product_data` here with "Received unknown parameter". Each plan's
// Product is created once, with a deterministic id, and reused after that.
const planProductIds = new Map();

async function getOrCreatePlanProduct(planId, productName) {
  if (planProductIds.has(planId)) return planProductIds.get(planId);

  const id = `cleanops-plan-${planId}`;
  const client = getClient();
  let product;
  try {
    product = await client.products.retrieve(id);
  } catch (err) {
    if (err.statusCode !== 404) throw err;
    product = await client.products.create({ id, name: productName });
  }
  planProductIds.set(planId, product.id);
  return product.id;
}

async function createSubscription({ customerId, planId, pricePence, productName, paymentMethodId, metadata }) {
  const productId = await getOrCreatePlanProduct(planId, productName);
  return getClient().subscriptions.create({
    customer: customerId,
    items: [
      {
        price_data: {
          currency: 'gbp',
          unit_amount: pricePence,
          recurring: { interval: 'month' },
          product: productId,
        },
      },
    ],
    default_payment_method: paymentMethodId,
    // Fail the request immediately if the first charge doesn't go through,
    // rather than silently creating a subscription that's already behind.
    payment_behavior: 'error_if_incomplete',
    metadata,
  });
}

async function cancelSubscription(subscriptionId) {
  return getClient().subscriptions.cancel(subscriptionId);
}

// Keeps the subscription running (and the cleaner's access) until the period
// they have already paid for ends, then stops it with no further charge.
async function cancelSubscriptionAtPeriodEnd(subscriptionId) {
  return getClient().subscriptions.update(subscriptionId, { cancel_at_period_end: true });
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
  isMissingResource,
  retrieveCustomer,
  createCustomer,
  createSetupIntent,
  retrievePaymentMethod,
  detachPaymentMethod,
  setDefaultPaymentMethod,
  createSubscription,
  cancelSubscription,
  cancelSubscriptionAtPeriodEnd,
  constructWebhookEvent,
};
