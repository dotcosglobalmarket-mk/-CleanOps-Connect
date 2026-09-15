const subscriptionService = require('../services/subscription.service');

async function activate(req, res, next) {
  try {
    const { cleanerId, plan } = req.body;
    const subscription = await subscriptionService.activateSubscription(cleanerId, plan);
    res.status(201).json(subscription);
  } catch (err) {
    next(err);
  }
}

async function addInsurance(req, res, next) {
  try {
    const { cleanerId } = req.body;
    const subscription = await subscriptionService.addInsuranceAddOn(cleanerId);
    res.status(200).json(subscription);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  activate,
  addInsurance,
};
