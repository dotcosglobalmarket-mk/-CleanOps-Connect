const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const swaggerUi = require('swagger-ui-express');

function loadSwagger(app) {
  const openapiPath = path.join(__dirname, '..', '..', 'openapi.yaml');
  const openapiDoc = yaml.load(fs.readFileSync(openapiPath, 'utf8'));

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiDoc));
  console.log('Swagger docs available at /docs');
}

module.exports = loadSwagger;
