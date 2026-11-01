const express = require('express');
const request = require('supertest');
const { perUserLimiter } = require('../../src/middleware/user-rate-limit');

// Sign-in is faked: the user id comes from a header.
function appWith(max) {
  const app = express();
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    req.user = { id: req.headers['x-user'] };
    next();
  });
  app.post('/try', perUserLimiter({ windowMs: 60 * 60 * 1000, max, message: 'Too many tries' }), (req, res) => res.json({ ok: true }));
  return app;
}

describe('a limit counted per signed-in user', () => {
  it('stops one user after the limit, with a clear message', async () => {
    const app = appWith(3);
    for (let i = 0; i < 3; i += 1) expect((await request(app).post('/try').set('x-user', 'u1')).status).toBe(200);
    const blocked = await request(app).post('/try').set('x-user', 'u1');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ message: 'Too many tries' });
  });

  it('does not count one user against another', async () => {
    const app = appWith(2);
    await request(app).post('/try').set('x-user', 'u1');
    await request(app).post('/try').set('x-user', 'u1');
    expect((await request(app).post('/try').set('x-user', 'u1')).status).toBe(429);
    expect((await request(app).post('/try').set('x-user', 'u2')).status).toBe(200);
  });

  it('does not let a changing IP address get round it', async () => {
    const app = appWith(2);
    for (const ip of ['1.1.1.1', '2.2.2.2']) await request(app).post('/try').set('x-user', 'u1').set('X-Forwarded-For', ip);
    expect((await request(app).post('/try').set('x-user', 'u1').set('X-Forwarded-For', '3.3.3.3')).status).toBe(429);
  });
});
