const express = require('express');
const SeriesController = require('../controllers/SeriesController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateParams } = require('../middleware/validate');
const { seriesIdParamSchema, seriesVisitParamSchema } = require('../validation/series.validation');

const router = express.Router();

// A recurring booking: the customer can skip a visit, pause, resume or cancel it; the
// cleaner can cancel a visit or give notice to end it. Each only for their own series.
const customerOnly = [requireAuth, requireRole('customer')];
const cleanerOnly = [requireAuth, requireRole('cleaner')];

const eitherParty = [requireAuth, requireRole('customer', 'cleaner')];
router.get('/mine', ...eitherParty, SeriesController.mine);

router.post('/:id/visits/:jobId/skip', ...customerOnly, validateParams(seriesVisitParamSchema), SeriesController.skipVisit);
router.post('/:id/pause', ...customerOnly, validateParams(seriesIdParamSchema), SeriesController.pause);
router.post('/:id/resume', ...customerOnly, validateParams(seriesIdParamSchema), SeriesController.resume);
router.post('/:id/cancel', ...customerOnly, validateParams(seriesIdParamSchema), SeriesController.cancel);

router.post('/:id/visits/:jobId/cleaner-cancel', ...cleanerOnly, validateParams(seriesVisitParamSchema), SeriesController.cleanerCancelVisit);
router.post('/:id/end', ...cleanerOnly, validateParams(seriesIdParamSchema), SeriesController.cleanerEnd);

module.exports = router;
