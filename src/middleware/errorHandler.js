const GENERIC_SERVER_MESSAGE = 'Something went wrong on our side. Please try again, and contact us if it keeps happening.';

const PROVIDER_ERROR_MESSAGE =
  "We couldn't complete that with our payment provider. Please try again in a moment, or contact support if it keeps happening.";

// Stripe's SDK errors carry a type such as StripeInvalidRequestError.
function isProviderError(err) {
  return typeof err.type === 'string' && err.type.startsWith('Stripe');
}

// Defence in depth for any message that reaches a browser: Stripe keys,
// webhook secrets and account ids must never be shown to a user.
const SECRET_PATTERN = /\b(?:[sr]k|pk)_(?:live|test)_[A-Za-z0-9*]+|\bwhsec_[A-Za-z0-9*]+|\bacct_[A-Za-z0-9]+/g;
function redactSecrets(message) {
  return String(message).replace(SECRET_PATTERN, '[hidden]');
}

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

  // A Stripe failure is not something the person using the site can act on, and
  // its text can name our API key and account ids. The full error is already in
  // the server log above; the user gets a plain message instead. A declined
  // card is the one exception: that message is written for the customer.
  if (isProviderError(err) && err.type !== 'StripeCardError') {
    return res.status(502).json({ message: PROVIDER_ERROR_MESSAGE });
  }

  const status = err.status || 500;
  // A plain 500 is a fault on our side (a missing setting, a database error).
  // Its message is for the logs above, never for the browser: it can name
  // settings and internals. Anything else shown to a person is still checked
  // for keys and account ids first.
  const body = {
    message: status === 500 ? GENERIC_SERVER_MESSAGE : redactSecrets(err.message || GENERIC_SERVER_MESSAGE),
  };
  if (err.details) {
    body.details = err.details;
  }
  res.status(status).json(body);
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
