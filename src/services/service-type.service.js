const ServiceType = require('../models/ServiceType');

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

async function listServiceTypes(category) {
  const filter = category ? { category } : {};
  return ServiceType.find(filter).sort({ name: 1 });
}

async function createServiceType(data) {
  return ServiceType.create(data);
}

async function updateServiceType(id, updates) {
  const serviceType = await ServiceType.findById(id);
  if (!serviceType) throw notFound('Service type not found');
  Object.assign(serviceType, updates);
  await serviceType.save();
  return serviceType;
}

module.exports = {
  listServiceTypes,
  createServiceType,
  updateServiceType,
};
