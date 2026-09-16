require('dotenv').config();

const createApp = require('./app');
const connectDB = require('./config/db');
const logger = require('./utils/logger');
const { seedDefaultServiceTypes } = require('./services/service-type-seed.service');

const PORT = process.env.PORT || 4000;

async function start() {
  if (!process.env.JWT_SECRET) {
    logger.error('JWT_SECRET is not set in the environment');
    process.exit(1);
  }

  await connectDB();
  await seedDefaultServiceTypes();

  const app = createApp();

  app.listen(PORT, () => {
    logger.info(`CleanOps Connect API listening on port ${PORT}`);
  });
}

start().catch((err) => {
  logger.error(`Failed to start server: ${err.message}`);
  process.exit(1);
});
