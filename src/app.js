const express = require('express');
const cors = require('cors');

const routes = require('./routes');
const webhooksRoutes = require('./routes/webhooks.routes');
const loadSwagger = require('./config/swagger');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.use(cors());

  // Stripe webhook signature verification needs the raw request body, so
  // this must be mounted with express.raw() BEFORE the global
  // express.json() below strips it away by parsing the body into an object.
  app.use('/webhooks', express.raw({ type: 'application/json' }), webhooksRoutes);

  app.use(express.json());

  loadSwagger(app);

  app.use('/', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
