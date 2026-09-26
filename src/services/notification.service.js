const User = require('../models/User');
const CleanerProfile = require('../models/CleanerProfile');
const ServiceType = require('../models/ServiceType');
const emailService = require('./email.service');
const logger = require('../utils/logger');

// Transactional emails for the job lifecycle. Every function here is
// fire-and-forget: it never throws, so callers don't await it and a
// notification problem can never block a booking, payment or payout.

function frontendUrl(path) {
  const base = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  return base ? `${base}/${path}` : undefined;
}

function pounds(pence) {
  return typeof pence === 'number' ? `£${(pence / 100).toFixed(2)}` : '';
}

function area(postcode) {
  if (!postcode) return 'your area';
  const compact = postcode.replace(/\s+/g, '').toUpperCase();
  return compact.length > 3 ? compact.slice(0, -3) : compact;
}

async function customerEmail(job) {
  const user = await User.findById(job.customer);
  return user && user.email;
}

async function cleanerEmail(cleanerProfileId) {
  const profile = await CleanerProfile.findById(cleanerProfileId);
  if (!profile) return undefined;
  const user = await User.findById(profile.user);
  return user && user.email;
}

async function serviceName(job) {
  if (job.serviceType && job.serviceType.name) return job.serviceType.name;
  const serviceType = job.serviceType ? await ServiceType.findById(job.serviceType) : null;
  return serviceType ? serviceType.name : 'cleaning';
}

function safely(name, fn) {
  return (...args) =>
    Promise.resolve()
      .then(() => fn(...args))
      .catch((err) => logger.error(`[notifications] ${name} failed: ${err.message}`));
}

const customerJobLink = (job) => ({ label: 'View your job', url: frontendUrl(`customer.html?job=${job._id}`) });
const cleanerLink = (label, tab) => ({ label, url: frontendUrl(`cleaner.html?tab=${tab}`) });

module.exports = {
  offersSent: safely('offersSent', async (job, offers) => {
    const service = await serviceName(job);
    await Promise.all(
      offers.map(async (offer) =>
        emailService.send({
          to: await cleanerEmail(offer.cleaner),
          subject: `New job offer: ${service} in ${area(job.postcode)}`,
          paragraphs: [
            `A customer in ${area(job.postcode)} is looking for ${service}. Their budget is £${job.budgetMin}–£${job.budgetMax}.`,
            'Offers go to several cleaners, and the first one to accept books the job. You set your own price when you accept.',
          ],
          action: cleanerLink('See the offer', 'offers'),
        })
      )
    );
  }),

  jobBooked: safely('jobBooked', async (job) => {
    await emailService.send({
      to: await customerEmail(job),
      subject: 'A cleaner has accepted your job — pay to confirm',
      paragraphs: [
        `Your ${await serviceName(job)} job has been accepted at ${pounds(job.pricePence)}.`,
        'Pay now to confirm the booking. Your payment is held securely and only released to the cleaner after you confirm the job is done.',
      ],
      action: { label: 'Pay and confirm', url: frontendUrl(`customer.html?job=${job._id}`) },
    });
  }),

  paymentReceived: safely('paymentReceived', async (job) => {
    await emailService.send({
      to: await cleanerEmail(job.cleaner),
      subject: 'Payment secured — your job is confirmed',
      paragraphs: [
        `The customer has paid ${pounds(job.pricePence)} for your ${await serviceName(job)} job. The money is held until the job is confirmed complete.`,
        'Check in on the day when you arrive, and mark the job complete when you finish.',
      ],
      action: cleanerLink('Open my jobs', 'jobs'),
    });
  }),

  cleanerArrived: safely('cleanerArrived', async (job) => {
    await emailService.send({
      to: await customerEmail(job),
      subject: 'Your cleaner has checked in',
      paragraphs: ['Your cleaner has arrived and checked in for your job.'],
      action: customerJobLink(job),
    });
  }),

  jobCompleted: safely('jobCompleted', async (job) => {
    await emailService.send({
      to: await customerEmail(job),
      subject: 'Your job is marked complete — please confirm',
      paragraphs: [
        'Your cleaner has marked the job as complete.',
        'Please confirm it, or tell us about a problem, within 48 hours. If we hear nothing, the job is confirmed automatically and the cleaner is paid.',
      ],
      action: customerJobLink(job),
    });
  }),

  jobConfirmed: safely('jobConfirmed', async (job) => {
    await emailService.send({
      to: await customerEmail(job),
      subject: 'Thanks — how did it go?',
      paragraphs: [
        'Your job is confirmed and the cleaner is being paid.',
        'Your review helps other customers choose, and helps good cleaners get more work.',
      ],
      action: { label: 'Leave a review', url: frontendUrl(`customer.html?job=${job._id}&review=1`) },
    });
  }),

  disputeRaised: safely('disputeRaised', async (job) => {
    await emailService.send({
      to: await cleanerEmail(job.cleaner),
      subject: 'The customer has reported a problem with a job',
      paragraphs: [
        'The customer has reported a problem with a job you completed. Payment is on hold while our team reviews it.',
        'We may contact you for your side. You do not need to do anything else right now.',
      ],
      action: cleanerLink('Open my jobs', 'jobs'),
    });
    if (process.env.OPS_NOTIFICATION_EMAIL) {
      await emailService.send({
        to: process.env.OPS_NOTIFICATION_EMAIL,
        subject: `New dispute on job ${String(job._id).slice(-8)}`,
        paragraphs: [`Reason: ${job.disputeReason}.`],
        action: { label: 'Open the ops dashboard', url: frontendUrl('ops.html') },
      });
    }
  }),

  disputeResolved: safely('disputeResolved', async (job, { outcome, refundPence }) => {
    const summary = {
      payout: 'The cleaner will be paid in full.',
      refund: `The customer will receive a full refund of ${pounds(refundPence)}.`,
      partial: `The customer will receive a refund of ${pounds(refundPence)} and the cleaner will be paid the rest.`,
    }[outcome];
    await Promise.all([
      emailService.send({
        to: await customerEmail(job),
        subject: 'Your problem report has been resolved',
        paragraphs: ['We have reviewed the problem you reported.', summary, 'Refunds usually reach your card within 5–10 working days.'],
        action: customerJobLink(job),
      }),
      emailService.send({
        to: await cleanerEmail(job.cleaner),
        subject: 'A disputed job has been resolved',
        paragraphs: ['Our team has reviewed the problem the customer reported.', summary],
        action: cleanerLink('Open my earnings', 'earnings'),
      }),
    ]);
  }),

  jobCancelled: safely('jobCancelled', async (job, { by, refundPence }) => {
    if (by === 'cleaner') {
      await emailService.send({
        to: await customerEmail(job),
        subject: 'Your cleaner has cancelled',
        paragraphs: [
          'Sorry — your cleaner has had to cancel this job.',
          `You will get a full refund of ${pounds(refundPence ?? job.pricePence)}. You can post the job again at any time.`,
        ],
        action: customerJobLink(job),
      });
      return;
    }
    await emailService.send({
      to: await cleanerEmail(job.cleaner),
      subject: 'A customer has cancelled a booking',
      paragraphs: ['The customer has cancelled this booking, so you do not need to attend.'],
      action: cleanerLink('Open my jobs', 'jobs'),
    });
  }),

  payoutSent: safely('payoutSent', async (job) => {
    await emailService.send({
      to: await cleanerEmail(job.cleaner),
      subject: `Payout sent: ${pounds(job.cleanerPayoutPence)}`,
      paragraphs: [
        `We have sent ${pounds(job.cleanerPayoutPence)} to your Stripe account for a completed job. Stripe pays it into your bank on your payout schedule.`,
      ],
      action: cleanerLink('Open my earnings', 'earnings'),
    });
  }),

  payoutsNeedSetup: safely('payoutsNeedSetup', async (job) => {
    await emailService.send({
      to: await cleanerEmail(job.cleaner),
      subject: 'Set up payouts to get paid',
      paragraphs: [
        'You have money waiting for a completed job, but we cannot pay you until you finish setting up payouts with Stripe.',
      ],
      action: cleanerLink('Set up payouts', 'earnings'),
    });
  }),

  bankPayoutFailed: safely('bankPayoutFailed', async (cleanerProfile) => {
    await emailService.send({
      to: await cleanerEmail(cleanerProfile._id),
      subject: 'Your bank payout failed',
      paragraphs: ['Stripe could not pay money into your bank account. Please check your bank details in your Stripe dashboard.'],
      action: cleanerLink('Open my earnings', 'earnings'),
    });
  }),

  opsAlert: safely('opsAlert', async (subject, message) => {
    if (!process.env.OPS_NOTIFICATION_EMAIL) {
      logger.error(`[ops-alert] ${subject}: ${message}`);
      return;
    }
    await emailService.send({
      to: process.env.OPS_NOTIFICATION_EMAIL,
      subject,
      paragraphs: [message],
      action: { label: 'Open the ops dashboard', url: frontendUrl('ops.html') },
    });
  }),
};
