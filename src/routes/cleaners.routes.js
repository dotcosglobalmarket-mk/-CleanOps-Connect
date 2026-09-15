const express = require('express');
const CleanerController = require('../controllers/CleanerController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/', requireAuth, requireRole('cleaner'), CleanerController.create);
router.post('/coverage', requireAuth, requireRole('cleaner', 'admin'), CleanerController.setCoverage);
router.get('/:id', CleanerController.getById);

module.exports = router;
