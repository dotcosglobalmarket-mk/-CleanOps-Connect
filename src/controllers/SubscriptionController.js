const subscriptionService = require('../services/subscription.service');

async function createSetupIntent(req, res, next) {
  try {
    const { cleanerId } = req.body;
    const result = await subscriptionService.createSetupIntent(cleanerId, req.user);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function activate(req, res, next) {
  try {
    const { cleanerId, plan, paymentMethodId } = req.body;
    const subscription = await subscriptionService.activateSubscription(cleanerId, plan, paymentMethodId, req.user);
    res.status(201).json(subscription);
  } catch (err) {
    next(err);
  }
}

async function addInsurance(req, res, next) {
  try {
    const { cleanerId } = req.body;
    const subscription = await subscriptionService.addInsuranceAddOn(cleanerId, req.user);
    res.status(200).json(subscription);
  } catch (err) {
    next(err);
  }
}

async function mySubscription(req, res, next) {
  try {
    const subscription = await subscriptionService.getMySubscription(req.user.id);
    res.status(200).json(subscription);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createSetupIntent,
  activate,
  addInsurance,
  mySubscription,
};
