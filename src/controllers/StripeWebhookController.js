const stripeService = require('../services/stripe.service');
const ProcessedWebhookEvent = require('../models/ProcessedWebhookEvent');
const paymentService = require('../services/payment.service');
const subscriptionService = require('../services/subscription.service');

async function dispatch(event) {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      await paymentService.handlePaymentSucceeded(pi.id, pi.amount_received);
      break;
    }
    case 'transfer.created':
      // No job-state action needed here — Transfer.create() already stored
      // stripeTransferId synchronously in the request/response cycle; this
      // event just confirms Stripe accepted it.
      break;
    case 'transfer.paid': {
      const transfer = event.data.object;
      await paymentService.handleTransferPaid(transfer.id);
      break;
    }
    case 'transfer.failed': {
      const transfer = event.data.object;
      await paymentService.handleTransferFailedWebhook(transfer.id);
      break;
    }
    case 'payout.failed': {
      const payout = event.data.object;
      await paymentService.handlePayoutFailed(payout.destination);
      break;
    }
    case 'account.updated': {
      const account = event.data.object;
      await paymentService.handleAccountUpdated(account.id, Boolean(account.payouts_enabled));
      break;
    }
    case 'charge.dispute.created': {
      const dispute = event.data.object;
      await paymentService.handleChargeDisputeCreated(dispute.payment_intent, dispute.reason);
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      await subscriptionService.handleStripeSubscriptionUpdated(subscription);
      break;
    }
    case 'invoice.payment_succeeded':
    case 'invoice.paid': {
      await subscriptionService.handleInvoicePaid(event.data.object);
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      await subscriptionService.handleInvoicePaymentFailed(invoice);
      break;
    }
    default:
      break;
  }
}

async function handle(req, res, next) {
  let event;
  try {
    // Verify signature BEFORE trusting event.id for dedup or acting on the
    // payload at all.
    event = stripeService.constructWebhookEvent(req.body, req.headers['stripe-signature']);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  try {
    await ProcessedWebhookEvent.create({ eventId: event.id });
  } catch (err) {
    if (err.code === 11000) {
      // Duplicate delivery, already handled.
      return res.status(200).json({ received: true, duplicate: true });
    }
    return next(err);
  }

  try {
    await dispatch(event);
    return res.status(200).json({ received: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = { handle, dispatch };
