const express = require('express');
const ServiceTypeController = require('../controllers/ServiceTypeController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateBody, validateQuery } = require('../middleware/validate');
const { listServiceTypesQuerySchema, createServiceTypeSchema } = require('../validation/service-type.validation');

const router = express.Router();

router.get('/', validateQuery(listServiceTypesQuerySchema), ServiceTypeController.list);
router.post('/', requireAuth, requireRole('admin'), validateBody(createServiceTypeSchema), ServiceTypeController.create);

module.exports = router;
