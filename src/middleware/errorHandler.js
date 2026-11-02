const GENERIC_SERVER_MESSAGE = 'Something went wrong on our side. Please try again, and contact us if it keeps happening.';

function notFoundHandler(req, res, next) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error(err.stack || err.message);
  // Stripe's SDK wraps network-level failures (StripeConnectionError) with a
  // generic "connection to Stripe" message and puts the real underlying
  // Node error — the one with .code/.errno/.syscall/.address that actually
  // says ETIMEDOUT vs ENOTFOUND vs ECONNREFUSED vs a TLS failure — on
  // `.detail`. Node's default error printing doesn't recurse into that
  // custom property, so without this the real cause never reaches the logs.
  if (err.detail) {
    console.error('[stripe connection error detail]', err.detail);
  }

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
  // A plain 500 is a fault on our side (a missing setting, a database or Stripe
  // error). Its message is for the logs above, never for the browser: it can
  // name settings and internals.
  const body = { message: status === 500 ? GENERIC_SERVER_MESSAGE : err.message || GENERIC_SERVER_MESSAGE };
  if (err.details) {
    body.details = err.details;
  }
  res.status(status).json(body);
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
