const subscriptionService = require('../services/subscription.service');

async function activate(req, res, next) {
  try {
    const { cleanerId, plan } = req.body;
    const subscription = await subscriptionService.activateSubscription(cleanerId, plan, req.user);
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

module.exports = {
  activate,
  addInsurance,
};
