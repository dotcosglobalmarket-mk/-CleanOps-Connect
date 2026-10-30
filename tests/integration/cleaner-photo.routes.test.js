jest.mock('../../src/models/User', () => ({
  findById: jest.fn((id) => Promise.resolve({ _id: id, name: 'Staff', role: 'admin', active: true })),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../src/services/cleaner-photo.service', () => ({
  setPhoto: jest.fn(), removePhoto: jest.fn(), getPhoto: jest.fn(), detectMimeType: jest.fn(), MAX_BYTES: 1048576,
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const service = require('../../src/services/cleaner-photo.service');
const User = require('../../src/models/User');

const CLEANER = '507f1f77bcf86cd799439011';
const auth = (role) => `Bearer ${jwt.sign({ sub: 'user1', role }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0]);

describe('cleaner picture routes', () => {
  let app;
  beforeEach(() => { jest.clearAllMocks(); app = createApp(); });

  it('lets only a cleaner upload, with the raw image as the body', async () => {
    service.setPhoto.mockResolvedValue({ hasPhoto: true });
    const post = (role) => request(app).post('/cleaners/me/photo').set('Authorization', auth(role)).set('Content-Type', 'image/jpeg').send(JPG);
    expect((await post('cleaner')).status).toBe(200);
    expect(Buffer.isBuffer(service.setPhoto.mock.calls[0][0].buffer)).toBe(true);
    expect((await post('customer')).status).toBe(403);
    expect((await request(app).post('/cleaners/me/photo').set('Content-Type', 'image/jpeg').send(JPG)).status).toBe(401);
  });

  it('lets only a cleaner remove their picture', async () => {
    service.removePhoto.mockResolvedValue();
    expect((await request(app).delete('/cleaners/me/photo').set('Authorization', auth('cleaner'))).status).toBe(204);
    expect((await request(app).delete('/cleaners/me/photo').set('Authorization', auth('customer'))).status).toBe(403);
  });

  it('serves a picture to a logged-in user with safe headers, and needs a login', async () => {
    service.getPhoto.mockResolvedValue({ file: { data: JPG, mimeType: 'image/jpeg' } });
    expect((await request(app).get(`/cleaners/${CLEANER}/photo`)).status).toBe(401);
    for (const role of ['customer', 'cleaner', 'operator', 'admin']) {
      User.findById.mockImplementation((id) => Promise.resolve({ _id: id, name: 'S', role, active: true }));
      const res = await request(app).get(`/cleaners/${CLEANER}/photo`).set('Authorization', auth(role));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch('image/jpeg');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toMatch('no-store');
    }
  });

  it('answers 404 when the service says there is no picture', async () => {
    const err = new Error('No picture'); err.status = 404;
    service.getPhoto.mockRejectedValue(err);
    expect((await request(app).get(`/cleaners/${CLEANER}/photo`).set('Authorization', auth('customer'))).status).toBe(404);
  });
});
