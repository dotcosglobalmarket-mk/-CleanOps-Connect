process.env.UPLOAD_RATE_LIMIT_MAX = '2'; // set before the routes are loaded: each limiter reads it once
jest.mock('../../src/models/User', () => ({ findById: jest.fn(), findOne: jest.fn(), create: jest.fn() }));
jest.mock('../../src/services/job-photo.service', () => ({ upload: jest.fn(), list: jest.fn(), getFile: jest.fn(), remove: jest.fn(), scheduleExpiry: jest.fn() }));
jest.mock('../../src/services/cleaner-photo.service', () => ({ setPhoto: jest.fn(), removePhoto: jest.fn(), getPhoto: jest.fn() }));
jest.mock('../../src/services/compliance-document.service', () => ({ upload: jest.fn(), listMine: jest.fn() }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const jobPhotos = require('../../src/services/job-photo.service');
const cleanerPhoto = require('../../src/services/cleaner-photo.service');
const documents = require('../../src/services/compliance-document.service');

const JOB = '507f1f77bcf86cd799439011';
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0]);
const auth = (role, sub) => `Bearer ${jwt.sign({ sub, role }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;

describe('upload rate limits on the real routes', () => {
  const app = createApp();

  it('limits job photo uploads per person, and refuses before the upload is read', async () => {
    jobPhotos.upload.mockResolvedValue({ _id: 'p' });
    const send = (sub) =>
      request(app).post(`/jobs/${JOB}/photos?kind=before`).set('Authorization', auth('cleaner', sub)).set('Content-Type', 'image/jpeg').send(JPG);
    expect((await send('c1')).status).toBe(201);
    expect((await send('c1')).status).toBe(201);
    const refused = await send('c1');
    expect(refused.status).toBe(429);
    expect(jobPhotos.upload).toHaveBeenCalledTimes(2);
    expect((await send('c2')).status).toBe(201);
  });

  it('limits cleaner picture uploads', async () => {
    cleanerPhoto.setPhoto.mockResolvedValue({ hasPhoto: true });
    const send = () => request(app).post('/cleaners/me/photo').set('Authorization', auth('cleaner', 'c3')).set('Content-Type', 'image/jpeg').send(JPG);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
    expect(cleanerPhoto.setPhoto).toHaveBeenCalledTimes(2);
  });

  it('limits compliance document uploads', async () => {
    documents.upload.mockResolvedValue({ _id: 'd' });
    const send = () => request(app).post('/compliance-documents?type=dbs').set('Authorization', auth('cleaner', 'c4')).set('Content-Type', 'application/pdf').send(Buffer.from('%PDF-1.7 x'));
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(429);
    expect(documents.upload).toHaveBeenCalledTimes(2);
  });
});
