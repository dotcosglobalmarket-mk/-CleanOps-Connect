require('dotenv').config();

const createApp = require('./app');
const connectDB = require('./config/db');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 4000;

async function start() {
  await connectDB();

  const app = createApp();

  app.listen(PORT, () => {
    logger.info(`CleanOps Connect API listening on port ${PORT}`);
  });
}

start().catch((err) => {
  logger.error(`Failed to start server: ${err.message}`);
  process.exit(1);
});
