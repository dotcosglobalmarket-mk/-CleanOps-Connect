jest.mock('../../src/models/User', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
}));

const request = require('supertest');

function loadApp(env = {}) {
  let createApp;
  jest.isolateModules(() => {
    Object.assign(process.env, env);
    createApp = require('../../src/app');
  });
  return createApp();
}

describe('HTTP hardening', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('sets security headers', async () => {
    const app = loadApp();
    const res = await request(app).get('/service-types-does-not-exist');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('only returns CORS headers for allow-listed origins when CORS_ORIGINS is set', async () => {
    const app = loadApp({ CORS_ORIGINS: 'https://www.cleanop-connect.co.uk, https://cleanop-connect.co.uk' });

    const allowed = await request(app).get('/nope').set('Origin', 'https://www.cleanop-connect.co.uk');
    expect(allowed.headers['access-control-allow-origin']).toBe('https://www.cleanop-connect.co.uk');

    const blocked = await request(app).get('/nope').set('Origin', 'https://evil.example');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate limits repeated login attempts from the same client', async () => {
    const app = loadApp({ AUTH_RATE_LIMIT_MAX: '3' });
    const User = require('../../src/models/User');
    User.findOne.mockResolvedValue(null);

    const attempt = () => request(app).post('/auth/login').send({ email: 'a@example.com', password: 'wrong' });
    for (let i = 0; i < 3; i += 1) {
      const res = await attempt();
      expect(res.status).not.toBe(429);
    }
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
  });
});
