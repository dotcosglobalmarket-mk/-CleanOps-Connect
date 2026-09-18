const adminService = require('../services/admin.service');

async function summary(req, res, next) {
  try {
    res.status(200).json(await adminService.getSummary());
  } catch (err) {
    next(err);
  }
}

async function listCleaners(req, res, next) {
  try {
    res.status(200).json(await adminService.listCleaners(req.query));
  } catch (err) {
    next(err);
  }
}

async function getCleaner(req, res, next) {
  try {
    res.status(200).json(await adminService.getCleanerById(req.params.id));
  } catch (err) {
    next(err);
  }
}

async function updateCleanerVerification(req, res, next) {
  try {
    res.status(200).json(await adminService.updateCleanerVerification(req.params.id, req.body));
  } catch (err) {
    next(err);
  }
}

async function updateCleanerDeactivation(req, res, next) {
  try {
    res.status(200).json(await adminService.updateCleanerDeactivation(req.params.id, req.body.deactivationStatus));
  } catch (err) {
    next(err);
  }
}

async function listJobs(req, res, next) {
  try {
    res.status(200).json(await adminService.listJobs(req.query));
  } catch (err) {
    next(err);
  }
}

async function getJob(req, res, next) {
  try {
    res.status(200).json(await adminService.getJobById(req.params.id));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  summary,
  listCleaners,
  getCleaner,
  updateCleanerVerification,
  updateCleanerDeactivation,
  listJobs,
  getJob,
};
