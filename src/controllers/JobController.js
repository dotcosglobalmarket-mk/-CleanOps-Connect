const jobService = require('../services/job.service');

async function create(req, res, next) {
  try {
    const job = await jobService.createJob({ ...req.body, customer: req.user.id });
    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const job = await jobService.getJobForUser(req.params.id, req.user);
    res.status(200).json(job);
  } catch (err) {
    next(err);
  }
}

async function allocate(req, res, next) {
  try {
    const result = await jobService.allocateJob(req.params.id, req.user);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function acceptOffer(req, res, next) {
  try {
    const job = await jobService.acceptOffer(req.params.id, req.params.offerId, req.user, req.body.pricePence);
    res.status(200).json(job);
  } catch (err) {
    next(err);
  }
}

async function declineOffer(req, res, next) {
  try {
    const offer = await jobService.declineOffer(req.params.id, req.params.offerId, req.user);
    res.status(200).json(offer);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  create,
  getById,
  allocate,
  acceptOffer,
  declineOffer,
};
