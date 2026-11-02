jest.mock('../../src/models/User', () => ({
  findById: jest.fn((id) => Promise.resolve({ _id: id, name: 'Admin', role: 'admin', active: true })),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../src/services/privacy-request.service', () => ({ lookup: jest.fn(), exportData: jest.fn(), erase: jest.fn() }));
jest.mock('../../src/services/audit.service', () => ({ record: jest.fn() }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const User = require('../../src/models/User');
const privacy = require('../../src/services/privacy-request.service');
const audit = require('../../src/services/audit.service');

const PERSON = '507f1f77bcf86cd799439011';
const auth = (role) => `Bearer ${jwt.sign({ sub: 'staff1', role }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;

describe('privacy request routes', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockImplementation((id) => Promise.resolve({ _id: id, name: 'Admin', role: 'admin', active: true }));
    app = createApp();
  });

  it('are for admins only', async () => {
    User.findById.mockImplementation((id) => Promise.resolve({ _id: id, name: 'Op', role: 'operator', active: true }));
    for (const call of [
      request(app).get('/admin/privacy/lookup?email=a@b.co').set('Authorization', auth('operator')),
      request(app).get(`/admin/privacy/${PERSON}/export?identityChecked=true`).set('Authorization', auth('operator')),
      request(app).post(`/admin/privacy/${PERSON}/erase`).set('Authorization', auth('operator')).send({}),
    ]) {
      expect((await call).status).toBe(403);
    }
    expect((await request(app).get('/admin/privacy/lookup?email=a@b.co')).status).toBe(401);
    expect(privacy.lookup).not.toHaveBeenCalled();
  });

  it('looks a person up by email', async () => {
    privacy.lookup.mockResolvedValue({ id: PERSON, name: 'Pat', blockers: [] });
    const res = await request(app).get('/admin/privacy/lookup?email=pat@example.com').set('Authorization', auth('admin'));
    expect(res.status).toBe(200);
    expect(privacy.lookup).toHaveBeenCalledWith('pat@example.com');
  });

  it('hands over a copy only once identity has been confirmed, as an uncached download, and records it', async () => {
    privacy.exportData.mockResolvedValue({ account: { name: 'Pat' } });
    const refused = await request(app).get(`/admin/privacy/${PERSON}/export`).set('Authorization', auth('admin'));
    expect(refused.status).toBe(400);
    expect(privacy.exportData).not.toHaveBeenCalled();

    const res = await request(app).get(`/admin/privacy/${PERSON}/export?identityChecked=true`).set('Authorization', auth('admin'));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="cleanops-data-507f1f77bcf86cd799439011\.json"/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.text)).toEqual({ account: { name: 'Pat' } });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.export', targetId: PERSON }));
  });

  it('sends nothing if the record of the copy cannot be written', async () => {
    privacy.exportData.mockResolvedValue({ account: { name: 'Pat' } });
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    const res = await request(app).get(`/admin/privacy/${PERSON}/export?identityChecked=true`).set('Authorization', auth('admin'));
    expect(res.status).toBe(500);
    expect(res.text).not.toMatch(/Pat/);
  });

  it('erases only with identity confirmed, the typed email and a reason', async () => {
    privacy.erase.mockResolvedValue({ erased: true, counts: {} });
    const post = (body) => request(app).post(`/admin/privacy/${PERSON}/erase`).set('Authorization', auth('admin')).send(body);

    expect((await post({ confirmEmail: 'pat@example.com', reason: 'Asked by email' })).status).toBe(400);
    expect((await post({ identityChecked: true, reason: 'Asked by email' })).status).toBe(400);
    expect((await post({ identityChecked: true, confirmEmail: 'pat@example.com', reason: 'x' })).status).toBe(400);
    expect(privacy.erase).not.toHaveBeenCalled();

    const ok = await post({ identityChecked: true, confirmEmail: 'pat@example.com', reason: 'Asked by email' });
    expect(ok.status).toBe(200);
    expect(privacy.erase).toHaveBeenCalledWith(PERSON, expect.objectContaining({ confirmEmail: 'pat@example.com', reason: 'Asked by email' }), expect.anything());
  });

  it('passes on a refusal from the service, such as money still in flight', async () => {
    const err = new Error('This account cannot be erased yet. 1 booking still in progress');
    err.status = 409;
    privacy.erase.mockRejectedValue(err);
    const res = await request(app).post(`/admin/privacy/${PERSON}/erase`).set('Authorization', auth('admin')).send({ identityChecked: true, confirmEmail: 'pat@example.com', reason: 'Asked by email' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/cannot be erased yet/);
  });
});
