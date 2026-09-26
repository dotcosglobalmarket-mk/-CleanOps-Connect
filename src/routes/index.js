const express = require('express');

const authRoutes = require('./auth.routes');
const jobsRoutes = require('./jobs.routes');
const cleanersRoutes = require('./cleaners.routes');
const subscriptionsRoutes = require('./subscriptions.routes');
const serviceTypesRoutes = require('./service-types.routes');
const paymentsRoutes = require('./payments.routes');
const adminRoutes = require('./admin.routes');
const opsRoutes = require('./ops.routes');
const reviewsRoutes = require('./reviews.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/jobs', jobsRoutes);
router.use('/cleaners', cleanersRoutes);
router.use('/subscriptions', subscriptionsRoutes);
router.use('/service-types', serviceTypesRoutes);
router.use('/payments', paymentsRoutes);
router.use('/admin', adminRoutes);
router.use('/ops', opsRoutes);
router.use('/reviews', reviewsRoutes);

module.exports = router;
