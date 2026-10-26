const Anthropic = require('@anthropic-ai/sdk');

// One shared Anthropic client for the AI writing helpers and the price guide.
// `new Anthropic()` reads ANTHROPIC_API_KEY from the environment.

function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function unavailable(message) {
  const err = new Error(message);
  err.status = 503;
  return err;
}

let client;
function getClient() {
  if (!client) {
    client = new Anthropic({ maxRetries: 1, timeout: 20 * 1000 });
  }
  return client;
}

module.exports = { Anthropic, isConfigured, unavailable, getClient };
