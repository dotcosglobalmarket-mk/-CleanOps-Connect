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
    const job = await jobService.getJobById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }
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

module.exports = {
  create,
  getById,
  allocate,
};
