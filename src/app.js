const express = require('express');
const cors = require('cors');

const routes = require('./routes');
const loadSwagger = require('./config/swagger');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  loadSwagger(app);

  app.use('/', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
