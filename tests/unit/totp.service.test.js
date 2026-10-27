const totp = require('../../src/services/totp.service');

// RFC 6238 appendix B test vectors (SHA-1, secret "12345678901234567890"), last 6 digits.
const SECRET = totp.base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches the RFC 6238 vector at %i seconds', (seconds, expected) => {
    expect(totp.totpAt(SECRET, seconds * 1000)).toBe(expected);
  });

  it('round-trips base32 and makes a 32-character secret', () => {
    const secret = totp.generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(totp.base32Encode(totp.base32Decode(secret))).toBe(secret);
    expect(() => totp.base32Decode('not*base32')).toThrow();
  });

  it('accepts the current code and one step either side, but not further', () => {
    const now = 1111111109 * 1000;
    const current = totp.totpAt(SECRET, now);
    expect(totp.verify(SECRET, current, { now })).not.toBeNull();
    expect(totp.verify(SECRET, totp.totpAt(SECRET, now - 30000), { now })).not.toBeNull();
    expect(totp.verify(SECRET, totp.totpAt(SECRET, now + 30000), { now })).not.toBeNull();
    expect(totp.verify(SECRET, totp.totpAt(SECRET, now - 90000), { now })).toBeNull();
  });

  it('refuses a code from a step that was already used', () => {
    const now = 1111111109 * 1000;
    const step = totp.verify(SECRET, totp.totpAt(SECRET, now), { now });
    expect(totp.verify(SECRET, totp.totpAt(SECRET, now), { now, afterStep: step })).toBeNull();
  });

  it('refuses anything that is not six digits', () => {
    expect(totp.verify(SECRET, '12345')).toBeNull();
    expect(totp.verify(SECRET, 'abcdef')).toBeNull();
    expect(totp.verify(SECRET, '1234567')).toBeNull();
  });

  it('builds the link an authenticator app understands', () => {
    const uri = totp.otpauthUri('ABCDEFGH', 'ops@example.com', 'CleanOps Connect');
    expect(uri).toBe(
      'otpauth://totp/CleanOps%20Connect:ops%40example.com?secret=ABCDEFGH&issuer=CleanOps%20Connect&algorithm=SHA1&digits=6&period=30'
    );
  });
});
