jest.mock('../../src/models/User', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
}));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../../src/models/User');
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
});
