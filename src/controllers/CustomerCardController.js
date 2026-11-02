const customerCardService = require('../services/customer-card.service');

function handler(fn, status = 200) {
  return async (req, res, next) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  get: handler((req) => customerCardService.getCard(req.user.id)),
  setupIntent: handler((req) => customerCardService.createSetupIntent(req.user.id)),
  save: handler(
    (req) => customerCardService.saveCard(req.user.id, req.body.paymentMethodId, req.body.consent, req.body.consentVersion),
    201
  ),
  agree: handler((req) => customerCardService.agreeToCurrentWording(req.user.id, req.body.consent, req.body.consentVersion)),
  remove: handler((req) => customerCardService.removeCard(req.user.id)),
};
