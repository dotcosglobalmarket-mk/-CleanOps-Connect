const express = require('express');
const ServiceTypeController = require('../controllers/ServiceTypeController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');
const {
  listServiceTypesQuerySchema,
  createServiceTypeSchema,
  serviceTypeIdParamSchema,
  updateServiceTypeSchema,
} = require('../validation/service-type.validation');

const router = express.Router();

router.get('/', validateQuery(listServiceTypesQuerySchema), ServiceTypeController.list);
router.post('/', requireAuth, requireRole('admin'), validateBody(createServiceTypeSchema), ServiceTypeController.create);
router.patch(
  '/:id',
  requireAuth,
  requireRole('admin'),
  validateParams(serviceTypeIdParamSchema),
  validateBody(updateServiceTypeSchema),
  ServiceTypeController.update
);

module.exports = router;
