// A small in-memory stand-in for the users collection (see tests/helpers/fake-users.js).
// Each database call is applied in one step, as MongoDB applies a single-document
// update, so these tests exercise the service's logic under simultaneous requests.
// They do not prove MongoDB itself is atomic.
jest.mock('../../src/models/User', () => require('../helpers/fake-users').model);
const { store, clone } = require('../helpers/fake-users');

const jwt = require('jsonwebtoken');
const totp = require('../../src/services/totp.service');
const svc = require('../../src/services/two-factor.service');

const baseUser = (extra = {}) => ({
  _id: 'u1',
  name: 'Ops',
  email: 'ops@example.com',
  role: 'admin',
  active: true,
  tokenVersion: 0,
  twoFactor: { enabled: false, recoveryCodeHashes: [], failedAttempts: 0 },
  ...extra,
});

// A user who has finished set-up, with a known secret, held in the store.
function enrolled(secret = totp.generateSecret(), twoFactor = {}) {
  store.doc = baseUser({
    twoFactor: { enabled: true, secretEnc: svc.encrypt(secret), recoveryCodeHashes: [], failedAttempts: 0, ...twoFactor },
  });
  return { user: clone(store.doc), secret };
}
const fresh = () => { store.doc = baseUser(); return clone(store.doc); };

const decode = (token) => jwt.decode(token);

beforeEach(() => {
  jest.clearAllMocks();
  store.doc = null;
  delete process.env.ADMIN_2FA_REQUIRED;
});

describe('afterPassword', () => {
  it('gives an admin without two-step login a set-up token, never a session', () => {
    const out = svc.afterPassword(baseUser());
    expect(out.token).toBeUndefined();
    expect(out.twoFactorSetupRequired).toBe(true);
    expect(decode(out.setupToken).purpose).toBe('mfa-setup');
  });

  it('gives an admin who has set it up a code challenge', () => {
    const out = svc.afterPassword(enrolled().user);
    expect(out.token).toBeUndefined();
    expect(out.twoFactorRequired).toBe(true);
    expect(decode(out.challengeToken).purpose).toBe('mfa');
  });

  it('lets customers and cleaners straight in, unless they have turned it on', () => {
    expect(svc.afterPassword(baseUser({ role: 'customer' })).token).toEqual(expect.any(String));
    expect(svc.afterPassword(baseUser({ role: 'cleaner' })).token).toEqual(expect.any(String));
    expect(svc.afterPassword({ ...enrolled().user, role: 'customer' }).twoFactorRequired).toBe(true);
  });

  it('makes operators set it up too, and ask for a code once they have', () => {
    const fresh = svc.afterPassword(baseUser({ role: 'operator' }));
    expect(fresh.token).toBeUndefined();
    expect(fresh.twoFactorSetupRequired).toBe(true);
    const done = svc.afterPassword({ ...enrolled().user, role: 'operator' });
    expect(done.twoFactorRequired).toBe(true);
    expect(done.token).toBeUndefined();
  });

  it('puts the account\'s session version in the session, so a reset can end it', () => {
    const out = svc.afterPassword(baseUser({ role: 'customer', tokenVersion: 4 }));
    expect(decode(out.token).tv).toBe(4);
  });

  it('ADMIN_2FA_REQUIRED=false only spares staff who have not set it up; enrolled staff are still asked', () => {
    process.env.ADMIN_2FA_REQUIRED = 'false';
    expect(svc.afterPassword(baseUser()).token).toEqual(expect.any(String));
    expect(svc.afterPassword(baseUser({ role: 'operator' })).token).toEqual(expect.any(String));
    expect(svc.afterPassword(enrolled().user).twoFactorRequired).toBe(true);
  });

  it('signs the step tokens so they cannot be used as a login token', () => {
    const { challengeToken } = svc.afterPassword(enrolled().user);
    expect(() => jwt.verify(challengeToken, process.env.JWT_SECRET)).toThrow();
  });
});

describe('secrets at rest', () => {
  it('encrypts the authenticator secret and reads it back', () => {
    const stored = svc.encrypt('JBSWY3DPEHPK3PXP');
    expect(stored).not.toContain('JBSWY3DPEHPK3PXP');
    expect(svc.decrypt(stored)).toBe('JBSWY3DPEHPK3PXP');
    expect(svc.encrypt('JBSWY3DPEHPK3PXP')).not.toBe(stored);
  });

  it('makes ten distinct recovery codes and compares them case- and hyphen-insensitively', () => {
    const codes = svc.newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(svc.hashRecoveryCode(codes[0])).toBe(svc.hashRecoveryCode(codes[0].toLowerCase().replace('-', ' ')));
  });
});

describe('set-up', () => {
  it('makes a secret, keeps it encrypted and pending, and returns the link', async () => {
    const user = fresh();
    const out = await svc.startSetup({ setupToken: svc.afterPassword(user).setupToken });
    expect(out.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(out.otpauthUri).toContain(`secret=${out.secret}`);
    expect(store.doc.twoFactor.pendingSecretEnc).toBeDefined();
    expect(store.doc.twoFactor.pendingSecretEnc).not.toContain(out.secret);
    expect(store.doc.twoFactor.enabled).toBe(false);
  });

  it('turns it on only with a correct first code, then returns a session and ten recovery codes once', async () => {
    const user = fresh();
    const token = svc.afterPassword(user).setupToken;
    const { secret } = await svc.startSetup({ setupToken: token });

    await expect(svc.enable({ setupToken: token, code: '000000' })).rejects.toMatchObject({ status: 401 });
    expect(store.doc.twoFactor.enabled).toBe(false);
    expect(store.doc.twoFactor.failedAttempts).toBe(1);

    const out = await svc.enable({ setupToken: token, code: totp.totpAt(secret, Date.now()) });
    expect(store.doc.twoFactor.enabled).toBe(true);
    expect(store.doc.twoFactor.pendingSecretEnc).toBeUndefined();
    expect(store.doc.twoFactor.failedAttempts).toBe(0);
    expect(out.token).toEqual(expect.any(String));
    expect(out.recoveryCodes).toHaveLength(10);
    expect(store.doc.twoFactor.recoveryCodeHashes).toHaveLength(10);
    expect(JSON.stringify(store.doc.twoFactor.recoveryCodeHashes)).not.toContain(out.recoveryCodes[0]);
  });

  it('refuses a token that is not a set-up token, or an account already set up', async () => {
    const { user } = enrolled();
    await expect(svc.startSetup({ setupToken: svc.afterPassword(user).challengeToken })).rejects.toMatchObject({ status: 401 });
    await expect(svc.startSetup({ setupToken: 'garbage' })).rejects.toMatchObject({ status: 401 });
    const token = svc.afterPassword(baseUser()).setupToken;
    await expect(svc.startSetup({ setupToken: token })).rejects.toMatchObject({ status: 400 });
  });

  it('cannot be turned on twice by two simultaneous requests', async () => {
    const user = fresh();
    const token = svc.afterPassword(user).setupToken;
    const { secret } = await svc.startSetup({ setupToken: token });
    const code = totp.totpAt(secret, Date.now());
    const results = await Promise.allSettled([svc.enable({ setupToken: token, code }), svc.enable({ setupToken: token, code })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});

describe('verifyLogin', () => {
  it('signs in with a correct code and refuses the same code a second time', async () => {
    const { user, secret } = enrolled();
    const { challengeToken } = svc.afterPassword(user);
    const code = totp.totpAt(secret, Date.now());

    const out = await svc.verifyLogin({ challengeToken, code });
    expect(out.token).toEqual(expect.any(String));
    expect(out.user).toMatchObject({ id: 'u1', role: 'admin' });
    await expect(svc.verifyLogin({ challengeToken, code })).rejects.toMatchObject({ status: 401 });
  });

  it('locks the account after five wrong codes, even for the right one', async () => {
    const { user, secret } = enrolled();
    const { challengeToken } = svc.afterPassword(user);

    for (let i = 0; i < svc.MAX_FAILED_ATTEMPTS; i += 1) {
      await expect(svc.verifyLogin({ challengeToken, code: '000000' })).rejects.toMatchObject({ status: 401 });
    }
    await expect(svc.verifyLogin({ challengeToken, code: totp.totpAt(secret, Date.now()) })).rejects.toMatchObject({ status: 429 });
  });

  it('lets simultaneous guesses through only up to the limit', async () => {
    const { user } = enrolled();
    const { challengeToken } = svc.afterPassword(user);
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, () => svc.verifyLogin({ challengeToken, code: '000000' }))
    );
    const statuses = results.map((r) => r.reason.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(svc.MAX_FAILED_ATTEMPTS);
    expect(statuses.filter((s) => s === 429)).toHaveLength(40 - svc.MAX_FAILED_ATTEMPTS);
  });

  it('starts counting again 15 minutes after the last attempt, and a good code clears the count', async () => {
    const { user, secret } = enrolled(undefined, { failedAttempts: 5, lastAttemptAt: new Date(Date.now() - 16 * 60 * 1000) });
    const out = await svc.verifyLogin({
      challengeToken: svc.afterPassword(user).challengeToken,
      code: totp.totpAt(secret, Date.now()),
    });
    expect(out.token).toEqual(expect.any(String));
    expect(store.doc.twoFactor.failedAttempts).toBe(0);
    expect(store.doc.twoFactor.lastAttemptAt).toBeUndefined();
  });

  it('is still locked 2 minutes after the fifth attempt', async () => {
    const { user } = enrolled(undefined, { failedAttempts: 5, lastAttemptAt: new Date(Date.now() - 2 * 60 * 1000) });
    await expect(
      svc.verifyLogin({ challengeToken: svc.afterPassword(user).challengeToken, code: '000000' })
    ).rejects.toMatchObject({ status: 429 });
  });

  it('accepts a recovery code once, and only once', async () => {
    const codes = svc.newRecoveryCodes();
    const { user } = enrolled(undefined, { recoveryCodeHashes: codes.map(svc.hashRecoveryCode) });
    const { challengeToken } = svc.afterPassword(user);

    const out = await svc.verifyLogin({ challengeToken, code: codes[3].toLowerCase() });
    expect(out.recoveryUsed).toBe(true);
    expect(out.recoveryCodesLeft).toBe(9);
    await expect(svc.verifyLogin({ challengeToken, code: codes[3] })).rejects.toMatchObject({ status: 401 });
  });

  it('lets only one of two simultaneous requests use the same code', async () => {
    const { user, secret } = enrolled();
    const { challengeToken } = svc.afterPassword(user);
    const code = totp.totpAt(secret, Date.now());
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => svc.verifyLogin({ challengeToken, code })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('lets only one of two simultaneous requests use the same recovery code', async () => {
    const codes = svc.newRecoveryCodes();
    const { user } = enrolled(undefined, { recoveryCodeHashes: codes.map(svc.hashRecoveryCode) });
    const { challengeToken } = svc.afterPassword(user);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => svc.verifyLogin({ challengeToken, code: codes[0] })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(store.doc.twoFactor.recoveryCodeHashes).toHaveLength(9);
  });

  it('refuses an expired or foreign challenge, and a deactivated account', async () => {
    const { user } = enrolled();
    const expired = jwt.sign({ sub: 'u1', purpose: 'mfa' }, `${process.env.JWT_SECRET}:two-factor`, { expiresIn: -10 });
    await expect(svc.verifyLogin({ challengeToken: expired, code: '123456' })).rejects.toMatchObject({ status: 401 });
    const wrongKey = jwt.sign({ sub: 'u1', purpose: 'mfa' }, 'x'.repeat(32));
    await expect(svc.verifyLogin({ challengeToken: wrongKey, code: '123456' })).rejects.toMatchObject({ status: 401 });
    const { challengeToken } = svc.afterPassword(user);
    store.doc.active = false;
    await expect(svc.verifyLogin({ challengeToken, code: '123456' })).rejects.toMatchObject({ status: 401 });
  });
});

describe('reset', () => {
  it('clears everything, ends existing sessions, and makes the next sign-in start set-up again', async () => {
    const user = {
      ...baseUser({ tokenVersion: 2, twoFactor: { enabled: true, recoveryCodeHashes: ['x'], failedAttempts: 3, lockedUntil: new Date(), lastAttemptAt: new Date() } }),
      save: jest.fn().mockResolvedValue(undefined),
    };
    await svc.reset(user);
    expect(user.twoFactor).toMatchObject({ enabled: false, recoveryCodeHashes: [], failedAttempts: 0 });
    expect(user.twoFactor.secretEnc).toBeUndefined();
    expect(user.twoFactor.lastAttemptAt).toBeUndefined();
    expect(user.tokenVersion).toBe(3);
    expect(user.save).toHaveBeenCalled();
    expect(svc.afterPassword(user).twoFactorSetupRequired).toBe(true);
  });
});
