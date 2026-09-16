const serviceTypeService = require('../services/service-type.service');

async function list(req, res, next) {
  try {
    const serviceTypes = await serviceTypeService.listServiceTypes(req.query.category);
    res.status(200).json(serviceTypes);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const serviceType = await serviceTypeService.createServiceType(req.body);
    res.status(201).json(serviceType);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  create,
};
