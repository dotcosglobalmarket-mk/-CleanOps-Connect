const reviewService = require('../services/review.service');

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

const create = wrap(async (req) => ({
  status: 201,
  body: await reviewService.createReview(req.params.id, req.body, req.user),
}));

const getForJob = wrap(async (req) => ({ body: await reviewService.getReviewForJob(req.params.id, req.user) }));

const listForCleaner = wrap(async (req) => ({ body: await reviewService.listForCleaner(req.params.id) }));

const listLatest = wrap(async (req) => ({ body: await reviewService.listLatest(req.query) }));

const listForModeration = wrap(async (req) => ({ body: await reviewService.listForModeration(req.query) }));

const setVisibility = wrap(async (req) => ({
  body: await reviewService.setVisibility(req.params.id, req.body, req),
}));

module.exports = {
  create,
  getForJob,
  listForCleaner,
  listLatest,
  listForModeration,
  setVisibility,
};
