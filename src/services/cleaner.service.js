const CleanerProfile = require('../models/CleanerProfile');
const mapboxService = require('./mapbox.service');

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

async function createCleaner(cleanerData) {
  const { lat, lng } = await mapboxService.geocodePostcode(cleanerData.basePostcode);

  const cleaner = new CleanerProfile({
    ...cleanerData,
    lat,
    lng,
  });

  await cleaner.save();
  return cleaner;
}

async function getCleanerById(cleanerId) {
  return CleanerProfile.findById(cleanerId);
}

async function getMyProfile(userId) {
  return CleanerProfile.findOne({ user: userId });
}

async function updateMyProfile(userId, updates) {
  const cleaner = await CleanerProfile.findOne({ user: userId });
  if (!cleaner) {
    throw notFound('Cleaner profile not found — register as a cleaner first');
  }

  Object.assign(cleaner, updates);
  await cleaner.save();
  return cleaner;
}

async function setCoverage(cleanerId, coverageData, requestingUser) {
  const cleaner = await CleanerProfile.findById(cleanerId);
  if (!cleaner) {
    throw notFound('Cleaner not found');
  }

  if (requestingUser.role !== 'admin' && cleaner.user.toString() !== requestingUser.id) {
    throw forbidden('You do not have access to this cleaner profile');
  }

  cleaner.coverageType = coverageData.coverageType;
  if (coverageData.coverageType === 'radius') {
    cleaner.coverageRadiusKm = coverageData.radiusKm;
    cleaner.coveragePolygon = undefined;
  } else if (coverageData.coverageType === 'polygon') {
    cleaner.coveragePolygon = coverageData.polygon;
    cleaner.coverageRadiusKm = undefined;
  }

  await cleaner.save();
  return cleaner;
}

module.exports = {
  createCleaner,
  getCleanerById,
  getMyProfile,
  updateMyProfile,
  setCoverage,
};
