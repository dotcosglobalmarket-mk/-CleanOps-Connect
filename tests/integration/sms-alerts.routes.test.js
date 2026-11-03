jest.mock('../../src/models/User', () => ({
  findById: jest.fn((id) => Promise.resolve({ _id: id, name: 'U', role: 'customer', active: true })),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../src/services/sms-alerts.service', () => ({
  CONSENT: { version: 'sms-test', text: 'wording' },
  getSettings: jest.fn(),
  enable: jest.fn(),
  disable: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const alerts = require('../../src/services/sms-alerts.service');

const auth = (role, id = 'u1') => `Bearer ${jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
const body = (extra = {}) => ({ mobile: '07123 456789', consent: true, consentVersion: 'sms-test', ...extra });

describe('text alert settings routes', () => {
  const app = createApp();
  beforeEach(() => jest.clearAllMocks());

  it('need a login', async () => {
    expect((await request(app).get('/sms-alerts/me')).status).toBe(401);
    expect((await request(app).put('/sms-alerts/me').send(body())).status).toBe(401);
    expect((await request(app).delete('/sms-alerts/me')).status).toBe(401);
  });

  it.each(['admin', 'operator'])('are for customers and cleaners only (%s gets 403)', async (role) => {
    const res = await request(app).get('/sms-alerts/me').set('Authorization', auth(role));
    expect(res.status).toBe(403);
    expect(alerts.getSettings).not.toHaveBeenCalled();
  });

  it.each(['customer', 'cleaner'])('let a %s see only their own settings', async (role) => {
    alerts.getSettings.mockResolvedValue({ enabled: false });
    const res = await request(app).get('/sms-alerts/me').set('Authorization', auth(role, 'person7'));
    expect(res.status).toBe(200);
    expect(alerts.getSettings).toHaveBeenCalledWith('person7');
  });

  it('turns alerts on for the signed-in person', async () => {
    alerts.enable.mockResolvedValue({ enabled: true, mobile: '+447123456789' });
    const res = await request(app).put('/sms-alerts/me').set('Authorization', auth('cleaner', 'p1')).send(body());
    expect(res.status).toBe(200);
    expect(alerts.enable).toHaveBeenCalledWith('p1', expect.objectContaining({ mobile: '07123 456789', consent: true }));
  });

  it.each([
    [{ consent: false }],
    [{ consent: 'yes' }],
    [{ consent: undefined }],
    [{ mobile: '' }],
    [{ consentVersion: undefined }],
  ])('rejects %p before anything is saved', async (bad) => {
    const res = await request(app).put('/sms-alerts/me').set('Authorization', auth('customer')).send(body(bad));
    expect(res.status).toBe(400);
    expect(alerts.enable).not.toHaveBeenCalled();
  });

  it('turns alerts off', async () => {
    alerts.disable.mockResolvedValue({ enabled: false });
    const res = await request(app).delete('/sms-alerts/me').set('Authorization', auth('customer', 'p2'));
    expect(res.status).toBe(200);
    expect(alerts.disable).toHaveBeenCalledWith('p2');
  });
});
