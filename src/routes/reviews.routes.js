const express = require('express');
const ReviewController = require('../controllers/ReviewController');
const { validateQuery } = require('../middleware/validate');
const { latestReviewsQuerySchema } = require('../validation/review.validation');

const router = express.Router();

// Public: latest published reviews and the overall average, for the
// landing page.
router.get('/latest', validateQuery(latestReviewsQuerySchema), ReviewController.listLatest);

module.exports = router;
