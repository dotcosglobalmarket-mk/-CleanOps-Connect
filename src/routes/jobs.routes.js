const express = require('express');
const JobController = require('../controllers/JobController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateBody, validateParams } = require('../middleware/validate');
const { createJobSchema, jobIdParamSchema } = require('../validation/job.validation');

const router = express.Router();

router.post('/', requireAuth, requireRole('customer'), validateBody(createJobSchema), JobController.create);
router.get('/:id', validateParams(jobIdParamSchema), JobController.getById);
router.post('/:id/allocate', requireAuth, validateParams(jobIdParamSchema), JobController.allocate);

module.exports = router;
