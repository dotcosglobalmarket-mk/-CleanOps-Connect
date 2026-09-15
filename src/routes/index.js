const express = require('express');

const jobsRoutes = require('./jobs.routes');
const cleanersRoutes = require('./cleaners.routes');
const subscriptionsRoutes = require('./subscriptions.routes');

const router = express.Router();

router.use('/jobs', jobsRoutes);
router.use('/cleaners', cleanersRoutes);
router.use('/subscriptions', subscriptionsRoutes);

module.exports = router;
