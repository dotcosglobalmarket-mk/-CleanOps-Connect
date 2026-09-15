const express = require('express');
const CleanerController = require('../controllers/CleanerController');

const router = express.Router();

router.post('/', CleanerController.create);
router.post('/coverage', CleanerController.setCoverage);
router.get('/:id', CleanerController.getById);

module.exports = router;
