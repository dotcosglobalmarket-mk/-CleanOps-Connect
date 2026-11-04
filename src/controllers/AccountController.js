const accountService = require('../services/account.service');

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
  changePassword: handler((req) => accountService.changePassword(req.user.id, req.body)),
  listDataRequests: handler((req) => accountService.listMine(req.user.id)),
  createDataRequest: handler((req) => accountService.createDataRequest(req.user.id, req.body)),
};
