const Subscription = require('../models/Subscription');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

async function activateSubscription(cleanerId, plan) {
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

async function addInsuranceAddOn(cleanerId) {
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
