const express = require('express');
const JobController = require('../controllers/JobController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/', requireAuth, requireRole('customer'), JobController.create);
router.get('/:id', JobController.getById);
router.post('/:id/allocate', requireAuth, JobController.allocate);

module.exports = router;
