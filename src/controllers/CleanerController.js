const cleanerService = require('../services/cleaner.service');

async function create(req, res, next) {
  try {
    const cleaner = await cleanerService.createCleaner({ ...req.body, user: req.user.id });
    res.status(201).json(cleaner);
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const cleaner = await cleanerService.getCleanerById(req.params.id);
    if (!cleaner) {
      return res.status(404).json({ message: 'Cleaner not found' });
    }
    res.status(200).json(cleaner);
  } catch (err) {
    next(err);
  }
}

async function getMe(req, res, next) {
  try {
    const cleaner = await cleanerService.getMyProfile(req.user.id);
    if (!cleaner) {
      return res.status(404).json({ message: 'Cleaner profile not found — register as a cleaner first' });
    }
    res.status(200).json(cleaner);
  } catch (err) {
    next(err);
  }
}

async function updateMe(req, res, next) {
  try {
    const cleaner = await cleanerService.updateMyProfile(req.user.id, req.body);
    res.status(200).json(cleaner);
  } catch (err) {
    next(err);
  }
}

async function setCoverage(req, res, next) {
  try {
    const { cleanerId } = req.body;
    const cleaner = await cleanerService.setCoverage(cleanerId, req.body, req.user);
    res.status(200).json(cleaner);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  create,
  getById,
  getMe,
  updateMe,
  setCoverage,
};
