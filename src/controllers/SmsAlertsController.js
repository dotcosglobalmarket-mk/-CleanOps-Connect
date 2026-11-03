const smsAlertsService = require('../services/sms-alerts.service');

function handler(fn) {
  return async (req, res, next) => {
    try {
      res.status(200).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  get: handler((req) => smsAlertsService.getSettings(req.user.id)),
  enable: handler((req) => smsAlertsService.enable(req.user.id, req.body)),
  disable: handler((req) => smsAlertsService.disable(req.user.id)),
};
