const portalService = require('../services/cleaner-portal.service');

function wrap(fn) {
  return async (req, res, next) => {
    try {
      const result = await fn(req, res);
      res.status(result.status || 200).json(result.body);
    } catch (err) {
      next(err);
    }
  };
}

const listOffers = wrap(async (req) => ({ body: await portalService.listMyOffers(req.user.id, req.query) }));
const listJobs = wrap(async (req) => ({ body: await portalService.listMyJobs(req.user.id) }));
const earnings = wrap(async (req) => ({ body: await portalService.getEarnings(req.user.id) }));
const startPayoutOnboarding = wrap(async (req) => ({ body: await portalService.startPayoutOnboarding(req.user.id) }));
const payoutStatus = wrap(async (req) => ({ body: await portalService.getPayoutStatus(req.user.id) }));
const payoutDashboard = wrap(async (req) => ({ body: await portalService.createPayoutDashboardLink(req.user.id) }));

module.exports = {
  listOffers,
  listJobs,
  earnings,
  startPayoutOnboarding,
  payoutStatus,
  payoutDashboard,
};
