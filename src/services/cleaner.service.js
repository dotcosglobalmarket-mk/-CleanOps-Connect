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

// Fields safe to show to anyone. Contact details, exact base postcode,
// coordinates, Stripe identifiers and commission terms are never public.
const PUBLIC_CLEANER_FIELDS = [
  '_id',
  'name',
  'companyName',
  'services',
  'dbsVerified',
  'coshhTrained',
  'insuranceStatus',
  'ratingAverage',
  'ratingCount',
  'experienceYears',
  'available',
  'bio',
  'responseTime',
  'workingDays',
  'acceptEmergencyBookings',
  'customServices',
];

// Outward code only (e.g. "LS12" from "LS12 1AB") — enough to show the area
// a cleaner works from without disclosing their home address.
function outwardCode(postcode) {
  if (!postcode) return undefined;
  const compact = postcode.replace(/\s+/g, '').toUpperCase();
  return compact.length > 3 ? compact.slice(0, -3) : compact;
}

async function getPublicCleanerById(cleanerId) {
  const cleaner = await CleanerProfile.findById(cleanerId);
  if (!cleaner || cleaner.deactivationStatus === 'suspended') return null;

  const source = typeof cleaner.toObject === 'function' ? cleaner.toObject() : cleaner;
  const publicProfile = {};
  PUBLIC_CLEANER_FIELDS.forEach((field) => {
    if (source[field] !== undefined) publicProfile[field] = source[field];
  });
  publicProfile.area = outwardCode(source.basePostcode);
  return publicProfile;
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
  getPublicCleanerById,
  getMyProfile,
  updateMyProfile,
  setCoverage,
};
