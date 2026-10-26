jest.mock('../../src/models/User', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../src/services/notification.service', () => ({ passwordResetRequested: jest.fn() }));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../../src/models/User');
const notificationService = require('../../src/services/notification.service');
const createApp = require('../../src/app');

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
});
