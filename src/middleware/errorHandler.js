function notFoundHandler(req, res, next) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error(err.stack || err.message);

  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ message: `Invalid value for field "${err.path}"` });
  }

  if (err.code === 11000) {
    return res.status(409).json({ message: 'Duplicate value violates a unique constraint' });
  }

  const status = err.status || 500;
  const body = { message: err.message || 'Internal server error' };
  if (err.details) {
    body.details = err.details;
  }
  res.status(status).json(body);
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
