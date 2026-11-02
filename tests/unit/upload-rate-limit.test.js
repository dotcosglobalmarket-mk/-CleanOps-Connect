const express = require('express');
const request = require('supertest');
const { uploadLimiter, limitFor } = require('../../src/middleware/upload-rate-limit');

// Mounted the way the routes do: after login, before the body is read.
function appWith(limit) {
  const app = express();
  app.use((req, res, next) => {
    req.user = { id: req.headers['x-user'] || 'u1' };
    next();
  });
  let reads = 0;
  app.post('/upload', uploadLimiter({ limit }), (req, res, next) => {
    reads += 1;
    next();
  }, (req, res) => res.status(201).json({ ok: true }));
  return { app, readCount: () => reads };
}

describe('uploadLimiter', () => {
  // The test set-up raises every limit; these tests want the real numbers they ask for.
  const saved = process.env.UPLOAD_RATE_LIMIT_MAX;
  beforeAll(() => { delete process.env.UPLOAD_RATE_LIMIT_MAX; });
  afterAll(() => { process.env.UPLOAD_RATE_LIMIT_MAX = saved; });

  it('lets a person upload up to the limit, then refuses with a plain message and never reads the upload', async () => {
    const { app, readCount } = appWith(2);
    expect((await request(app).post('/upload')).status).toBe(201);
    expect((await request(app).post('/upload')).status).toBe(201);
    const refused = await request(app).post('/upload');
    expect(refused.status).toBe(429);
    expect(refused.body.message).toMatch(/uploaded a lot/);
    expect(readCount()).toBe(2);
  });

  it('counts each logged-in person separately', async () => {
    const { app } = appWith(1);
    expect((await request(app).post('/upload').set('x-user', 'a')).status).toBe(201);
    expect((await request(app).post('/upload').set('x-user', 'a')).status).toBe(429);
    expect((await request(app).post('/upload').set('x-user', 'b')).status).toBe(201);
  });

  it('UPLOAD_RATE_LIMIT_MAX replaces the normal limit', () => {
    process.env.UPLOAD_RATE_LIMIT_MAX = '7';
    expect(limitFor(60)).toBe(7);
    delete process.env.UPLOAD_RATE_LIMIT_MAX;
    expect(limitFor(60)).toBe(60);
  });
});
