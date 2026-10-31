jest.mock('../../src/models/User', () => ({
  findById: jest.fn((id) => Promise.resolve({ _id: id, name: 'U', role: 'customer', active: true })),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../src/services/series-rules.service');
jest.mock('../../src/services/series-view.service');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const rules = require('../../src/services/series-rules.service');
const viewService = require('../../src/services/series-view.service');

const auth = (role, id = 'u1') => `Bearer ${jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
const sid = '507f1f77bcf86cd799439044';
const jid = '507f1f77bcf86cd799439055';

describe('series routes', () => {
  const app = createApp();
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['post', `/series/${sid}/pause`],
    ['post', `/series/${sid}/visits/${jid}/skip`],
    ['post', `/series/${sid}/end`],
  ])('%s %s needs a login', async (method, url) => {
    expect((await request(app)[method](url)).status).toBe(401);
  });

  it.each([
    ['/pause'],
    ['/resume'],
    ['/cancel'],
    [`/visits/${jid}/skip`],
  ])('customer action %s is for customers only', async (path) => {
    const res = await request(app).post(`/series/${sid}${path}`).set('Authorization', auth('cleaner'));
    expect(res.status).toBe(403);
  });

  it.each([['/end'], [`/visits/${jid}/cleaner-cancel`]])('cleaner action %s is for cleaners only', async (path) => {
    const res = await request(app).post(`/series/${sid}${path}`).set('Authorization', auth('customer'));
    expect(res.status).toBe(403);
  });

  it('rejects a malformed id', async () => {
    const res = await request(app).post('/series/nope/pause').set('Authorization', auth('customer'));
    expect(res.status).toBe(400);
  });

  it('passes the signed-in user to the rules, never an id from the request', async () => {
    rules.skipVisit.mockResolvedValue({ ok: true });
    const res = await request(app).post(`/series/${sid}/visits/${jid}/skip`).set('Authorization', auth('customer', 'cust7')).send({ userId: 'someone-else' });
    expect(res.status).toBe(200);
    expect(rules.skipVisit).toHaveBeenCalledWith(sid, jid, 'cust7');
  });

  it.each([
    ['pause', 'pause'],
    ['resume', 'resume'],
    ['cancel', 'cancel'],
  ])('customer %s', async (path, fn) => {
    rules[fn].mockResolvedValue({});
    const res = await request(app).post(`/series/${sid}/${path}`).set('Authorization', auth('customer', 'cust7'));
    expect(res.status).toBe(200);
    expect(rules[fn]).toHaveBeenCalledWith(sid, 'cust7');
  });

  it('cleaner cancels a visit and ends a series', async () => {
    rules.cleanerCancelVisit.mockResolvedValue({});
    rules.cleanerEnd.mockResolvedValue({});
    expect((await request(app).post(`/series/${sid}/visits/${jid}/cleaner-cancel`).set('Authorization', auth('cleaner', 'cl1'))).status).toBe(200);
    expect(rules.cleanerCancelVisit).toHaveBeenCalledWith(sid, jid, 'cl1');
    expect((await request(app).post(`/series/${sid}/end`).set('Authorization', auth('cleaner', 'cl1'))).status).toBe(200);
    expect(rules.cleanerEnd).toHaveBeenCalledWith(sid, 'cl1');
  });

  it('turns a rule refusal into the right status', async () => {
    rules.pause.mockRejectedValue(Object.assign(new Error('Only a running series can be paused'), { status: 400 }));
    const res = await request(app).post(`/series/${sid}/pause`).set('Authorization', auth('customer'));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Only a running series can be paused');
  });

  describe('GET /series/mine', () => {
    it('needs a login, and is for customers and cleaners only', async () => {
      expect((await request(app).get('/series/mine')).status).toBe(401);
      expect((await request(app).get('/series/mine').set('Authorization', auth('admin'))).status).toBe(403);
    });

    it.each(['customer', 'cleaner'])('shows a %s only their own series', async (role) => {
      viewService.listMine.mockResolvedValue({ enabled: true, series: [] });
      const res = await request(app).get('/series/mine').set('Authorization', auth(role, 'me1'));
      expect(res.status).toBe(200);
      expect(viewService.listMine).toHaveBeenCalledWith(expect.objectContaining({ id: 'me1', role }));
    });
  });
});
