const crypto = require('crypto');

// Time-based one-time passwords (RFC 6238, with RFC 4226 underneath): the
// six-digit codes an authenticator app shows. SHA-1, 30-second steps, which
// is what every authenticator app expects.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_SECONDS = 30;
const DIGITS = 6;

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of String(text).toUpperCase().replace(/=+$/, '')) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Not a base32 string');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(key, counter, digits = DIGITS) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

const stepAt = (nowMs) => Math.floor(nowMs / 1000 / PERIOD_SECONDS);

function totpAt(secret, nowMs, digits = DIGITS) {
  return hotp(base32Decode(secret), stepAt(nowMs), digits);
}

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Returns the step the code belongs to, or null. One step either side of now
// is accepted for clock drift. A step at or before `afterStep` is refused, so
// a code that has already been used cannot be used again.
function verify(secret, code, { now = Date.now(), window = 1, afterStep = -1 } = {}) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const key = base32Decode(secret);
  const current = stepAt(now);
  let matched = null;
  for (let step = current - window; step <= current + window; step += 1) {
    if (step > afterStep && safeEqual(hotp(key, step), String(code))) matched = step;
  }
  return matched;
}

function otpauthUri(secret, account, issuer) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_SECONDS}`;
}

module.exports = { generateSecret, base32Encode, base32Decode, hotp, totpAt, verify, otpauthUri };
