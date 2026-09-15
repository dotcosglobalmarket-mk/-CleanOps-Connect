const CleanerProfile = require('../models/CleanerProfile');
const mapboxService = require('./mapbox.service');

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
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

async function setCoverage(cleanerId, coverageData) {
  const cleaner = await CleanerProfile.findById(cleanerId);
  if (!cleaner) {
    throw notFound('Cleaner not found');
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
  setCoverage,
};
