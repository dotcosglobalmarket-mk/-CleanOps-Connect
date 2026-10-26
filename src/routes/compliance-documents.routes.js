const express = require('express');
const ComplianceDocumentController = require('../controllers/ComplianceDocumentController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateQuery } = require('../middleware/validate');
const { uploadQuerySchema } = require('../validation/compliance-document.validation');

const router = express.Router();

router.get('/mine', requireAuth, requireRole('cleaner'), ComplianceDocumentController.listMine);

// The file itself is the request body (Content-Type: application/pdf, image/jpeg
// or image/png), up to 5 MB. Its first bytes are checked again in the service.
router.post(
  '/',
  requireAuth,
  requireRole('cleaner'),
  express.raw({ type: ['application/pdf', 'image/jpeg', 'image/png'], limit: '5mb' }),
  validateQuery(uploadQuerySchema),
  ComplianceDocumentController.upload
);

module.exports = router;
