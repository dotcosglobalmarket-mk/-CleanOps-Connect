const Subscription = require('../models/Subscription');
const CleanerProfile = require('../models/CleanerProfile');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

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

async function assertOwnsCleanerProfile(cleanerId, requestingUser) {
  const cleaner = await CleanerProfile.findById(cleanerId);
  if (!cleaner) {
    throw notFound('Cleaner not found');
  }

  if (requestingUser.role !== 'admin' && cleaner.user.toString() !== requestingUser.id) {
    throw forbidden('You do not have access to this cleaner profile');
  }
}

async function activateSubscription(cleanerId, plan, requestingUser) {
  await assertOwnsCleanerProfile(cleanerId, requestingUser);

  const subscription = new Subscription({
    cleaner: cleanerId,
    plan,
    isActive: true,
    startedAt: new Date(),
    renewsAt: new Date(Date.now() + THIRTY_DAYS_MS),
  });

  await subscription.save();
  return subscription;
}

async function addInsuranceAddOn(cleanerId, requestingUser) {
  await assertOwnsCleanerProfile(cleanerId, requestingUser);

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

module.exports = {
  activateSubscription,
  addInsuranceAddOn,
};
