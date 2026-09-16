const ServiceType = require('../models/ServiceType');

async function listServiceTypes(category) {
  const filter = category ? { category } : {};
  return ServiceType.find(filter).sort({ name: 1 });
}

async function createServiceType(data) {
  return ServiceType.create(data);
}

module.exports = {
  listServiceTypes,
  createServiceType,
};
