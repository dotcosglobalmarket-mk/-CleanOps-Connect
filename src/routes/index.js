const express = require('express');

const authRoutes = require('./auth.routes');
const jobsRoutes = require('./jobs.routes');
const cleanersRoutes = require('./cleaners.routes');
const customersRoutes = require('./customers.routes');
const seriesRoutes = require('./series.routes');
const subscriptionsRoutes = require('./subscriptions.routes');
const serviceTypesRoutes = require('./service-types.routes');
const paymentsRoutes = require('./payments.routes');
const adminRoutes = require('./admin.routes');
const opsRoutes = require('./ops.routes');
const reviewsRoutes = require('./reviews.routes');
const chatRoutes = require('./chat.routes');
const pricingRoutes = require('./pricing.routes');
const complianceDocumentsRoutes = require('./compliance-documents.routes');
const jobPhotosRoutes = require('./job-photos.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/jobs/:id/photos', jobPhotosRoutes);
router.use('/jobs', jobsRoutes);
router.use('/cleaners', cleanersRoutes);
router.use('/customers', customersRoutes);
router.use('/series', seriesRoutes);
router.use('/subscriptions', subscriptionsRoutes);
router.use('/service-types', serviceTypesRoutes);
router.use('/payments', paymentsRoutes);
router.use('/admin', adminRoutes);
router.use('/ops', opsRoutes);
router.use('/reviews', reviewsRoutes);
router.use('/chat', chatRoutes);
router.use('/pricing', pricingRoutes);
router.use('/compliance-documents', complianceDocumentsRoutes);

module.exports = router;
