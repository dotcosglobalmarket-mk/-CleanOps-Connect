const rules = require('../services/series-rules.service');

function handler(fn) {
  return async (req, res, next) => {
    try {
      res.status(200).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };
}

const viewService = require('../services/series-view.service');

module.exports = {
  mine: handler((req) => viewService.listMine(req.user)),
  skipVisit: handler((req) => rules.skipVisit(req.params.id, req.params.jobId, req.user.id)),
  pause: handler((req) => rules.pause(req.params.id, req.user.id)),
  resume: handler((req) => rules.resume(req.params.id, req.user.id)),
  cancel: handler((req) => rules.cancel(req.params.id, req.user.id)),
  cleanerCancelVisit: handler((req) => rules.cleanerCancelVisit(req.params.id, req.params.jobId, req.user.id)),
  cleanerEnd: handler((req) => rules.cleanerEnd(req.params.id, req.user.id)),
};
