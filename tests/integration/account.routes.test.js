jest.mock('../../src/models/User', () => ({
  findById: jest.fn((id) => Promise.resolve({ _id: id, name: 'U', role: 'customer', active: true })),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../src/services/account.service', () => ({
  changePassword: jest.fn(),
  listMine: jest.fn(),
  createDataRequest: jest.fn(),
  view: jest.fn(),
}));
jest.mock('../../src/services/data-request.service', () => ({ listPending: jest.fn(), close: jest.fn(), afterErasure: jest.fn() }));
jest.mock('../../src/services/audit.service', () => ({ record: jest.fn() }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const User = require('../../src/models/User');
const account = require('../../src/services/account.service');
const dataRequests = require('../../src/services/data-request.service');

const auth = (role, id = 'u1') => `Bearer ${jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
const REQ = '507f1f77bcf86cd799439011';

describe('account routes', () => {
  const app = createApp();
  beforeEach(() => jest.clearAllMocks());

  it('need a login', async () => {
    expect((await request(app).post('/account/change-password').send({})).status).toBe(401);
    expect((await request(app).get('/account/data-requests')).status).toBe(401);
    expect((await request(app).post('/account/data-requests').send({ type: 'export' })).status).toBe(401);
  });

  it.each(['admin', 'operator'])('are for customers and cleaners only (%s gets 403)', async (role) => {
    const res = await request(app).get('/account/data-requests').set('Authorization', auth(role));
    expect(res.status).toBe(403);
    expect(account.listMine).not.toHaveBeenCalled();
  });

  it('changes the signed-in person\'s own password', async () => {
    account.changePassword.mockResolvedValue({ token: 't', user: { id: 'p1' } });
    const res = await request(app)
      .post('/account/change-password')
      .set('Authorization', auth('cleaner', 'p1'))
      .send({ currentPassword: 'old-pass-1', newPassword: 'new-pass-22' });
    expect(res.status).toBe(200);
    expect(account.changePassword).toHaveBeenCalledWith('p1', { currentPassword: 'old-pass-1', newPassword: 'new-pass-22' });
  });

  it.each([
    [{ currentPassword: 'x', newPassword: 'short' }],
    [{ currentPassword: '', newPassword: 'long-enough-1' }],
    [{ newPassword: 'long-enough-1' }],
  ])('rejects %p before anything changes', async (bad) => {
    const res = await request(app).post('/account/change-password').set('Authorization', auth('customer')).send(bad);
    expect(res.status).toBe(400);
    expect(account.changePassword).not.toHaveBeenCalled();
  });

  it('lists only the signed-in person\'s requests', async () => {
    account.listMine.mockResolvedValue([]);
    const res = await request(app).get('/account/data-requests').set('Authorization', auth('customer', 'p9'));
    expect(res.status).toBe(200);
    expect(account.listMine).toHaveBeenCalledWith('p9');
  });

  it('records a request, and rejects an unknown kind', async () => {
    account.createDataRequest.mockResolvedValue({ id: 'r1', type: 'export', alreadyOpen: false });
    const ok = await request(app).post('/account/data-requests').set('Authorization', auth('customer', 'p2')).send({ type: 'export', note: 'hi' });
    expect(ok.status).toBe(200);
    expect(account.createDataRequest).toHaveBeenCalledWith('p2', expect.objectContaining({ type: 'export', note: 'hi' }));
    const bad = await request(app).post('/account/data-requests').set('Authorization', auth('customer')).send({ type: 'sell' });
    expect(bad.status).toBe(400);
  });
});

describe('admin: requests from the account page', () => {
  const app = createApp();
  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockImplementation((id) => Promise.resolve({ _id: id, name: 'Admin', role: 'admin', active: true }));
  });

  it('are for admins only', async () => {
    User.findById.mockImplementation((id) => Promise.resolve({ _id: id, name: 'Op', role: 'operator', active: true }));
    expect((await request(app).get('/admin/privacy/requests').set('Authorization', auth('operator'))).status).toBe(403);
    expect((await request(app).post(`/admin/privacy/requests/${REQ}/close`).set('Authorization', auth('operator')).send({ outcome: 'done' })).status).toBe(403);
    expect(dataRequests.listPending).not.toHaveBeenCalled();
  });

  it('lists what is waiting', async () => {
    dataRequests.listPending.mockResolvedValue([{ id: REQ }]);
    const res = await request(app).get('/admin/privacy/requests').set('Authorization', auth('admin'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: REQ }]);
  });

  it('closes as done, and needs a reason to decline', async () => {
    dataRequests.close.mockResolvedValue({ id: REQ, status: 'done' });
    const done = await request(app).post(`/admin/privacy/requests/${REQ}/close`).set('Authorization', auth('admin')).send({ outcome: 'done' });
    expect(done.status).toBe(200);
    expect(dataRequests.close).toHaveBeenCalledWith(REQ, { outcome: 'done' }, expect.anything());

    const noReason = await request(app).post(`/admin/privacy/requests/${REQ}/close`).set('Authorization', auth('admin')).send({ outcome: 'declined' });
    expect(noReason.status).toBe(400);
    const bad = await request(app).post(`/admin/privacy/requests/${REQ}/close`).set('Authorization', auth('admin')).send({ outcome: 'maybe' });
    expect(bad.status).toBe(400);
    expect(dataRequests.close).toHaveBeenCalledTimes(1);
  });
});
