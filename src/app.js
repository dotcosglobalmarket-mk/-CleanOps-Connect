const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const routes = require('./routes');
const webhooksRoutes = require('./routes/webhooks.routes');
const loadSwagger = require('./config/swagger');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

// CORS_ORIGINS is a comma-separated allow-list, e.g.
// "https://www.cleanop-connect.co.uk,https://cleanop-connect.co.uk".
// When unset (local development and tests) every origin is allowed.
function buildCorsOptions() {
  const allowList = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowList.length === 0) return {};

  return {
    origin(origin, callback) {
      // Requests with no Origin header (curl, server-to-server, Stripe
      // webhooks) are not subject to CORS.
      if (!origin || allowList.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
  };
}

function createApp() {
  const app = express();

  // Behind DigitalOcean's load balancer: trust the first proxy hop so
  // req.ip (and therefore rate limiting) uses the real client address.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors(buildCorsOptions()));

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
