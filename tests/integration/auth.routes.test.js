process.env.AUTH_RATE_LIMIT_MAX = '1000'; // these tests make many auth calls from one IP
jest.mock('../../src/models/User', () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../src/services/notification.service', () => ({ passwordResetRequested: jest.fn() }));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../../src/models/User');
const notificationService = require('../../src/services/notification.service');
const createApp = require('../../src/app');
const totp = require('../../src/services/totp.service');
const twoFactor = require('../../src/services/two-factor.service');

describe('Auth routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  describe('POST /auth/register', () => {
    it('returns 400 for an invalid body', async () => {
      const res = await request(app).post('/auth/register').send({ email: 'not-an-email', role: 'wizard' });
      expect(res.status).toBe(400);
      expect(res.body.details).toBeDefined();
      expect(User.create).not.toHaveBeenCalled();
    });

    it('rejects self-registration as an admin', async () => {
      const res = await request(app).post('/auth/register').send({
        name: 'Mallory',
        email: 'mallory@example.com',
        password: 'password123',
        role: 'admin',
      });

      expect(res.status).toBe(400);
      expect(User.create).not.toHaveBeenCalled();
    });

    it('registers a new user and returns a valid token', async () => {
      User.findOne.mockResolvedValue(null);
      User.create.mockResolvedValue({
        _id: 'user1',
        name: 'Alice',
        email: 'alice@example.com',
        role: 'customer',
      });

      const res = await request(app).post('/auth/register').send({
        name: 'Alice',
        email: 'alice@example.com',
        password: 'password123',
        role: 'customer',
      });

      expect(res.status).toBe(201);
      expect(res.body.user).toMatchObject({ id: 'user1', email: 'alice@example.com', role: 'customer' });
      expect(typeof res.body.token).toBe('string');

      const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
      expect(decoded).toMatchObject({ sub: 'user1', role: 'customer' });
    });

    it('returns 409 when the email is already registered', async () => {
      User.findOne.mockResolvedValue({ _id: 'existing' });

      const res = await request(app).post('/auth/register').send({
        name: 'Alice',
        email: 'alice@example.com',
        password: 'password123',
        role: 'customer',
      });

      expect(res.status).toBe(409);
      expect(User.create).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/login', () => {
    it('logs in with correct credentials', async () => {
      const passwordHash = await bcrypt.hash('password123', 10);
      User.findOne.mockResolvedValue({
        _id: 'user1',
        name: 'Alice',
        email: 'alice@example.com',
        role: 'customer',
        passwordHash,
      });

      const res = await request(app).post('/auth/login').send({
        email: 'alice@example.com',
        password: 'password123',
      });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('alice@example.com');
      expect(typeof res.body.token).toBe('string');
    });

    it('rejects a deactivated account even with the correct password', async () => {
      const passwordHash = await bcrypt.hash('password123', 4);
      User.findOne.mockResolvedValue({
        _id: 'user9',
        name: 'Former Operator',
        email: 'former@example.com',
        role: 'operator',
        active: false,
        passwordHash,
      });

      const res = await request(app).post('/auth/login').send({ email: 'former@example.com', password: 'password123' });

      expect(res.status).toBe(401);
      expect(res.body.token).toBeUndefined();
    });

    it('rejects an unknown email', async () => {
      User.findOne.mockResolvedValue(null);

      const res = await request(app).post('/auth/login').send({
        email: 'nobody@example.com',
        password: 'password123',
      });

      expect(res.status).toBe(401);
    });

    it('rejects an incorrect password', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 10);
      User.findOne.mockResolvedValue({ _id: 'user1', email: 'alice@example.com', passwordHash });

      const res = await request(app).post('/auth/login').send({
        email: 'alice@example.com',
        password: 'wrong-password',
      });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/request-password-reset', () => {
    it('returns 400 for an invalid email', async () => {
      const res = await request(app).post('/auth/request-password-reset').send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
    });

    it('returns 200 and sends a reset email when the account exists', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      const user = { _id: 'user1', email: 'alice@example.com', save };
      User.findOne.mockResolvedValue(user);

      const res = await request(app).post('/auth/request-password-reset').send({ email: 'alice@example.com' });

      expect(res.status).toBe(200);
      expect(user.resetPasswordTokenHash).toEqual(expect.any(String));
      expect(user.resetPasswordExpiresAt).toBeInstanceOf(Date);
      expect(save).toHaveBeenCalledTimes(1);
      expect(notificationService.passwordResetRequested).toHaveBeenCalledWith(user, expect.any(String));
    });

    it('returns the same 200 response when the email is not registered, without sending anything', async () => {
      User.findOne.mockResolvedValue(null);

      const res = await request(app).post('/auth/request-password-reset').send({ email: 'nobody@example.com' });

      expect(res.status).toBe(200);
      expect(notificationService.passwordResetRequested).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/reset-password', () => {
    it('returns 400 for a password shorter than 8 characters', async () => {
      const res = await request(app).post('/auth/reset-password').send({ token: 'abc', password: 'short' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for an invalid or expired token', async () => {
      User.findOne.mockResolvedValue(null);

      const res = await request(app)
        .post('/auth/reset-password')
        .send({ token: 'bad-token', password: 'newpassword123' });

      expect(res.status).toBe(400);
    });

    it('resets the password and returns a fresh token for a valid reset token', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      const user = {
        _id: 'user1',
        name: 'Alice',
        email: 'alice@example.com',
        role: 'customer',
        resetPasswordTokenHash: 'stale-hash',
        resetPasswordExpiresAt: new Date(Date.now() + 1000 * 60),
        save,
      };
      User.findOne.mockResolvedValue(user);

      const res = await request(app)
        .post('/auth/reset-password')
        .send({ token: 'good-token', password: 'newpassword123' });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('alice@example.com');
      expect(typeof res.body.token).toBe('string');
      expect(user.resetPasswordTokenHash).toBeUndefined();
      expect(user.resetPasswordExpiresAt).toBeUndefined();
      expect(save).toHaveBeenCalledTimes(1);
    });
  });

  describe('two-step login for admins', () => {
    const adminUser = async (extra = {}) => ({
      _id: 'admin1',
      name: 'Ops',
      email: 'ops@example.com',
      role: 'admin',
      active: true,
      passwordHash: await bcrypt.hash('a-long-passphrase', 4),
      twoFactor: { enabled: false, recoveryCodeHashes: [], failedAttempts: 0 },
      save: jest.fn().mockResolvedValue(undefined),
      ...extra,
    });

    it('does not give an admin a session on the password alone', async () => {
      User.findOne.mockResolvedValue(await adminUser());
      const res = await request(app).post('/auth/login').send({ email: 'ops@example.com', password: 'a-long-passphrase' });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeUndefined();
      expect(res.body.user).toBeUndefined();
      expect(res.body.twoFactorSetupRequired).toBe(true);
      expect(typeof res.body.setupToken).toBe('string');
    });

    it('walks an admin through first-time set-up to a session', async () => {
      const user = await adminUser();
      User.findOne.mockResolvedValue(user);
      User.findById.mockResolvedValue(user);
      const login = await request(app).post('/auth/login').send({ email: 'ops@example.com', password: 'a-long-passphrase' });

      const setup = await request(app).post('/auth/2fa/setup').send({ setupToken: login.body.setupToken });
      expect(setup.status).toBe(200);
      expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);

      const wrong = await request(app).post('/auth/2fa/enable').send({ setupToken: login.body.setupToken, code: '000000' });
      expect(wrong.status).toBe(401);

      const done = await request(app)
        .post('/auth/2fa/enable')
        .send({ setupToken: login.body.setupToken, code: totp.totpAt(setup.body.secret, Date.now()) });
      expect(done.status).toBe(200);
      expect(done.body.recoveryCodes).toHaveLength(10);
      expect(jwt.verify(done.body.token, process.env.JWT_SECRET)).toMatchObject({ sub: 'admin1', role: 'admin' });
    });

    it('asks an admin who has set it up for a code, and signs in with the right one', async () => {
      const secret = totp.generateSecret();
      const user = await adminUser({ twoFactor: { enabled: true, secretEnc: twoFactor.encrypt(secret), recoveryCodeHashes: [], failedAttempts: 0 } });
      User.findOne.mockResolvedValue(user);
      User.findById.mockResolvedValue(user);

      const login = await request(app).post('/auth/login').send({ email: 'ops@example.com', password: 'a-long-passphrase' });
      expect(login.body.twoFactorRequired).toBe(true);
      expect(login.body.token).toBeUndefined();

      const bad = await request(app).post('/auth/2fa/verify').send({ challengeToken: login.body.challengeToken, code: '111111' });
      expect(bad.status).toBe(401);
      const good = await request(app)
        .post('/auth/2fa/verify')
        .send({ challengeToken: login.body.challengeToken, code: totp.totpAt(secret, Date.now()) });
      expect(good.status).toBe(200);
      expect(typeof good.body.token).toBe('string');
    });

    it('does not accept a challenge token as a login token anywhere else', async () => {
      const secret = totp.generateSecret();
      const user = await adminUser({ twoFactor: { enabled: true, secretEnc: twoFactor.encrypt(secret), recoveryCodeHashes: [], failedAttempts: 0 } });
      User.findOne.mockResolvedValue(user);
      const login = await request(app).post('/auth/login').send({ email: 'ops@example.com', password: 'a-long-passphrase' });
      const res = await request(app).get('/admin/summary').set('Authorization', `Bearer ${login.body.challengeToken}`);
      expect(res.status).toBe(401);
    });

    it('does not let a password-reset link skip the second step', async () => {
      const user = await adminUser({ resetPasswordTokenHash: 'x', resetPasswordExpiresAt: new Date(Date.now() + 60000) });
      User.findOne.mockResolvedValue(user);
      const res = await request(app).post('/auth/reset-password').send({ token: 'abc', password: 'a-new-long-passphrase' });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeUndefined();
      expect(res.body.twoFactorSetupRequired).toBe(true);
    });

    it('leaves customers and cleaners as they were', async () => {
      User.findOne.mockResolvedValue(await adminUser({ role: 'cleaner' }));
      const res = await request(app).post('/auth/login').send({ email: 'ops@example.com', password: 'a-long-passphrase' });
      expect(typeof res.body.token).toBe('string');
    });
  });
});
