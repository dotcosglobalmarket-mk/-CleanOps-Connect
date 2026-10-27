jest.mock('../../src/models/User', () => ({ findById: jest.fn() }));

const jwt = require('jsonwebtoken');
const User = require('../../src/models/User');
const totp = require('../../src/services/totp.service');
const svc = require('../../src/services/two-factor.service');

const mkUser = (extra = {}) => ({
  _id: 'u1',
  name: 'Ops',
  email: 'ops@example.com',
  role: 'admin',
  active: true,
  twoFactor: { enabled: false, recoveryCodeHashes: [], failedAttempts: 0 },
  save: jest.fn().mockResolvedValue(undefined),
  ...extra,
});

// A user who has finished set-up, with a known secret.
function enrolled(secret = totp.generateSecret(), twoFactor = {}) {
  return mkUser({
    twoFactor: { enabled: true, secretEnc: svc.encrypt(secret), recoveryCodeHashes: [], failedAttempts: 0, ...twoFactor },
  });
}

const decode = (token) => jwt.decode(token);

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ADMIN_2FA_REQUIRED;
});

describe('afterPassword', () => {
  it('gives an admin without two-step login a set-up token, never a session', () => {
    const out = svc.afterPassword(mkUser());
    expect(out.token).toBeUndefined();
    expect(out.twoFactorSetupRequired).toBe(true);
    expect(decode(out.setupToken).purpose).toBe('mfa-setup');
  });

  it('gives an admin who has set it up a code challenge', () => {
    const out = svc.afterPassword(enrolled());
    expect(out.token).toBeUndefined();
    expect(out.twoFactorRequired).toBe(true);
    expect(decode(out.challengeToken).purpose).toBe('mfa');
  });

  it('lets other roles straight in, unless they have turned it on', () => {
    expect(svc.afterPassword(mkUser({ role: 'customer' })).token).toEqual(expect.any(String));
    expect(svc.afterPassword({ ...enrolled(), role: 'operator' }).twoFactorRequired).toBe(true);
  });

  it('can be relaxed for a lock-out with ADMIN_2FA_REQUIRED=false, but not for someone who has it on', () => {
    process.env.ADMIN_2FA_REQUIRED = 'false';
    expect(svc.afterPassword(mkUser()).token).toEqual(expect.any(String));
    expect(svc.afterPassword(enrolled()).twoFactorRequired).toBe(true);
  });

  it('signs the step tokens so they cannot be used as a login token', () => {
    const { challengeToken } = svc.afterPassword(enrolled());
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
  const setupToken = (user) => svc.afterPassword(user).setupToken;

  it('makes a secret, keeps it encrypted and pending, and returns the link', async () => {
    const user = mkUser();
    User.findById.mockResolvedValue(user);
    const out = await svc.startSetup({ setupToken: setupToken(user) });
    expect(out.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(out.otpauthUri).toContain(`secret=${out.secret}`);
    expect(user.twoFactor.pendingSecretEnc).toBeDefined();
    expect(user.twoFactor.pendingSecretEnc).not.toContain(out.secret);
    expect(user.twoFactor.enabled).toBe(false);
  });

  it('turns it on only with a correct first code, then returns a session and ten recovery codes once', async () => {
    const user = mkUser();
    User.findById.mockResolvedValue(user);
    const token = setupToken(user);
    const { secret } = await svc.startSetup({ setupToken: token });

    await expect(svc.enable({ setupToken: token, code: '000000' })).rejects.toMatchObject({ status: 401 });
    expect(user.twoFactor.enabled).toBe(false);

    const out = await svc.enable({ setupToken: token, code: totp.totpAt(secret, Date.now()) });
    expect(user.twoFactor.enabled).toBe(true);
    expect(user.twoFactor.pendingSecretEnc).toBeUndefined();
    expect(out.token).toEqual(expect.any(String));
    expect(out.recoveryCodes).toHaveLength(10);
    expect(user.twoFactor.recoveryCodeHashes).toHaveLength(10);
    expect(JSON.stringify(user.twoFactor.recoveryCodeHashes)).not.toContain(out.recoveryCodes[0]);
  });

  it('refuses a token that is not a set-up token, or an account already set up', async () => {
    const user = enrolled();
    User.findById.mockResolvedValue(user);
    await expect(svc.startSetup({ setupToken: svc.afterPassword(user).challengeToken })).rejects.toMatchObject({ status: 401 });
    await expect(svc.startSetup({ setupToken: 'garbage' })).rejects.toMatchObject({ status: 401 });
    const fresh = mkUser();
    const token = svc.afterPassword(fresh).setupToken;
    User.findById.mockResolvedValue(enrolled());
    await expect(svc.startSetup({ setupToken: token })).rejects.toMatchObject({ status: 400 });
  });
});

describe('verifyLogin', () => {
  it('signs in with a correct code and refuses the same code a second time', async () => {
    const secret = totp.generateSecret();
    const user = enrolled(secret);
    User.findById.mockResolvedValue(user);
    const { challengeToken } = svc.afterPassword(user);
    const code = totp.totpAt(secret, Date.now());

    const out = await svc.verifyLogin({ challengeToken, code });
    expect(out.token).toEqual(expect.any(String));
    expect(out.user).toMatchObject({ id: 'u1', role: 'admin' });
    await expect(svc.verifyLogin({ challengeToken, code })).rejects.toMatchObject({ status: 401 });
  });

  it('locks the account for a while after five wrong codes, even for the right one', async () => {
    const secret = totp.generateSecret();
    const user = enrolled(secret);
    User.findById.mockResolvedValue(user);
    const { challengeToken } = svc.afterPassword(user);

    for (let i = 0; i < svc.MAX_FAILED_ATTEMPTS; i += 1) {
      await expect(svc.verifyLogin({ challengeToken, code: '000000' })).rejects.toMatchObject({ status: 401 });
    }
    expect(user.twoFactor.lockedUntil.getTime()).toBeGreaterThan(Date.now());
    await expect(svc.verifyLogin({ challengeToken, code: totp.totpAt(secret, Date.now()) })).rejects.toMatchObject({ status: 429 });
  });

  it('accepts a recovery code once, and only once', async () => {
    const codes = svc.newRecoveryCodes();
    const user = enrolled(undefined, { recoveryCodeHashes: codes.map(svc.hashRecoveryCode) });
    User.findById.mockResolvedValue(user);
    const { challengeToken } = svc.afterPassword(user);

    const out = await svc.verifyLogin({ challengeToken, code: codes[3].toLowerCase() });
    expect(out.recoveryUsed).toBe(true);
    expect(out.recoveryCodesLeft).toBe(9);
    await expect(svc.verifyLogin({ challengeToken, code: codes[3] })).rejects.toMatchObject({ status: 401 });
  });

  it('refuses an expired or foreign challenge, and a deactivated account', async () => {
    const user = enrolled();
    User.findById.mockResolvedValue(user);
    const expired = jwt.sign({ sub: 'u1', purpose: 'mfa' }, `${process.env.JWT_SECRET}:two-factor`, { expiresIn: -10 });
    await expect(svc.verifyLogin({ challengeToken: expired, code: '123456' })).rejects.toMatchObject({ status: 401 });
    const wrongKey = jwt.sign({ sub: 'u1', purpose: 'mfa' }, 'x'.repeat(32));
    await expect(svc.verifyLogin({ challengeToken: wrongKey, code: '123456' })).rejects.toMatchObject({ status: 401 });
    const { challengeToken } = svc.afterPassword(user);
    User.findById.mockResolvedValue({ ...user, active: false });
    await expect(svc.verifyLogin({ challengeToken, code: '123456' })).rejects.toMatchObject({ status: 401 });
  });
});

describe('reset', () => {
  it('clears everything so the next sign-in starts set-up again', async () => {
    const user = enrolled(undefined, { recoveryCodeHashes: ['x'], failedAttempts: 3, lockedUntil: new Date() });
    await svc.reset(user);
    expect(user.twoFactor).toMatchObject({ enabled: false, recoveryCodeHashes: [], failedAttempts: 0 });
    expect(user.twoFactor.secretEnc).toBeUndefined();
    expect(user.save).toHaveBeenCalled();
    expect(svc.afterPassword(user).twoFactorSetupRequired).toBe(true);
  });
});
