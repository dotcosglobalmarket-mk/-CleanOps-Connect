const express = require('express');
const CleanerController = require('../controllers/CleanerController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateBody, validateParams } = require('../middleware/validate');
const {
  createCleanerSchema,
  coverageSchema,
  cleanerIdParamSchema,
} = require('../validation/cleaner.validation');

const router = express.Router();

router.post(
  '/',
  requireAuth,
  requireRole('cleaner'),
  validateBody(createCleanerSchema),
  CleanerController.create
);
router.post(
  '/coverage',
  requireAuth,
  requireRole('cleaner', 'admin'),
  validateBody(coverageSchema),
  CleanerController.setCoverage
);
router.get('/:id', validateParams(cleanerIdParamSchema), CleanerController.getById);

module.exports = router;
