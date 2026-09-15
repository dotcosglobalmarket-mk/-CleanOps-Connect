const express = require('express');
const JobController = require('../controllers/JobController');

const router = express.Router();

router.post('/', JobController.create);
router.get('/:id', JobController.getById);
router.post('/:id/allocate', JobController.allocate);

module.exports = router;
