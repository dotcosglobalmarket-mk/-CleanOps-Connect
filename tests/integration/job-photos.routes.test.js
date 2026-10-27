jest.mock('../../src/models/User', () => ({
  findById: jest.fn((id) => Promise.resolve({ _id: id, name: 'Staff', role: 'admin', active: true })),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../src/services/job-photo.service', () => ({
  upload: jest.fn(), list: jest.fn(), getFile: jest.fn(), remove: jest.fn(), scheduleExpiry: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const service = require('../../src/services/job-photo.service');
const User = require('../../src/models/User');

const JOB = '507f1f77bcf86cd799439011';
const PHOTO = '507f1f77bcf86cd799439012';
const auth = (role) => `Bearer ${jwt.sign({ sub: 'user1', role }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0]);

describe('job photo routes', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  it('needs a login', async () => {
    expect((await request(app).get(`/jobs/${JOB}/photos`)).status).toBe(401);
  });

  it('lists photos for customers, cleaners and staff', async () => {
    service.list.mockResolvedValue([{ _id: PHOTO, kind: 'after' }]);
    for (const role of ['customer', 'cleaner', 'operator', 'admin']) {
      User.findById.mockImplementation((id) => Promise.resolve({ _id: id, name: 'Staff', role, active: true }));
      const res = await request(app).get(`/jobs/${JOB}/photos`).set('Authorization', auth(role));
      expect(res.status).toBe(200);
    }
  });

  it('uploads the raw image with its kind and returns 201', async () => {
    service.upload.mockResolvedValue({ _id: PHOTO, kind: 'before' });
    const res = await request(app)
      .post(`/jobs/${JOB}/photos?kind=before&filename=kitchen.jpg`)
      .set('Authorization', auth('cleaner'))
      .set('Content-Type', 'image/jpeg')
      .send(JPG);
    expect(res.status).toBe(201);
    const args = service.upload.mock.calls[0][0];
    expect(args).toMatchObject({ jobId: JOB, kind: 'before', filename: 'kitchen.jpg' });
    expect(Buffer.isBuffer(args.buffer)).toBe(true);
  });

  it('refuses staff uploads, unknown kinds and non-image content types', async () => {
    const post = (role, kind, type) =>
      request(app).post(`/jobs/${JOB}/photos?kind=${kind}`).set('Authorization', auth(role)).set('Content-Type', type).send(JPG);
    expect((await post('admin', 'before', 'image/jpeg')).status).toBe(403);
    expect((await post('cleaner', 'selfie', 'image/jpeg')).status).toBe(400);
    // A PDF is not read as a body, so the service gets no image and refuses it (400).
    await post('cleaner', 'before', 'application/pdf');
    expect(Buffer.isBuffer(service.upload.mock.calls[0][0].buffer)).toBe(false);
  });

  it('serves a photo with safe headers', async () => {
    service.getFile.mockResolvedValue({ photo: { originalName: 'a.jpg' }, file: { data: JPG, mimeType: 'image/jpeg' } });
    const res = await request(app).get(`/jobs/${JOB}/photos/${PHOTO}/file`).set('Authorization', auth('admin'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch('image/jpeg');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('lets only customers and cleaners remove a photo', async () => {
    service.remove.mockResolvedValue();
    expect((await request(app).delete(`/jobs/${JOB}/photos/${PHOTO}`).set('Authorization', auth('cleaner'))).status).toBe(204);
    expect((await request(app).delete(`/jobs/${JOB}/photos/${PHOTO}`).set('Authorization', auth('admin'))).status).toBe(403);
  });
});
