jest.mock('../../src/models/User', () => ({ findById: jest.fn(), findOne: jest.fn(), create: jest.fn() }));
jest.mock('../../src/services/price-guide.service', () => ({ getGuide: jest.fn() }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const priceGuide = require('../../src/services/price-guide.service');

const auth = (role) => `Bearer ${jwt.sign({ sub: 'u1', role }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
const body = { serviceType: '507f1f77bcf86cd799439011', postcode: 'LS12', estimatedHours: 3 };

describe('POST /pricing/guide', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  it('needs a signed-in customer or cleaner', async () => {
    expect((await request(app).post('/pricing/guide').send(body)).status).toBe(401);
    expect((await request(app).post('/pricing/guide').set('Authorization', auth('operator')).send(body)).status).toBe(403);
    expect(priceGuide.getGuide).not.toHaveBeenCalled();
  });

  it('validates the request', async () => {
    const res = await request(app).post('/pricing/guide').set('Authorization', auth('customer')).send({ serviceType: 'nope', postcode: '' });
    expect(res.status).toBe(400);
  });

  it.each(['customer', 'cleaner'])('returns the guide to a %s', async (role) => {
    priceGuide.getGuide.mockResolvedValue({ hourlyLowPence: 1400, hourlyHighPence: 1900 });
    const res = await request(app).post('/pricing/guide').set('Authorization', auth(role)).send(body);
    expect(res.status).toBe(200);
    expect(res.body.hourlyLowPence).toBe(1400);
    expect(priceGuide.getGuide).toHaveBeenCalledWith({ serviceTypeId: body.serviceType, area: 'LS12', estimatedHours: 3 });
  });

  it('passes a "not available" error through as 503', async () => {
    const err = new Error('The price guide is not available right now');
    err.status = 503;
    priceGuide.getGuide.mockRejectedValue(err);
    const res = await request(app).post('/pricing/guide').set('Authorization', auth('cleaner')).send(body);
    expect(res.status).toBe(503);
  });
});
