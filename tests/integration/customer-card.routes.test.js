jest.mock('../../src/models/User', () => ({
  findById: jest.fn((id) => Promise.resolve({ _id: id, name: 'U', role: 'customer', active: true })),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../src/services/customer-card.service');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const cards = require('../../src/services/customer-card.service');

const auth = (role, id = 'u1') => `Bearer ${jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;

describe('customer saved card routes', () => {
  const app = createApp();
  beforeEach(() => jest.clearAllMocks());

  it('need a login', async () => {
    expect((await request(app).get('/customers/me/card')).status).toBe(401);
  });

  it.each(['cleaner', 'admin'])('are for customers only (%s gets 403)', async (role) => {
    const res = await request(app).post('/customers/me/card/setup-intent').set('Authorization', auth(role));
    expect(res.status).toBe(403);
    expect(cards.createSetupIntent).not.toHaveBeenCalled();
  });

  it('shows the signed-in customer’s own card only', async () => {
    cards.getCard.mockResolvedValue({ saved: true, last4: '4242' });
    const res = await request(app).get('/customers/me/card').set('Authorization', auth('customer', 'cust9'));
    expect(res.status).toBe(200);
    expect(cards.getCard).toHaveBeenCalledWith('cust9');
  });

  it('starts saving a card', async () => {
    cards.createSetupIntent.mockResolvedValue({ clientSecret: 'x' });
    const res = await request(app).post('/customers/me/card/setup-intent').set('Authorization', auth('customer'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ clientSecret: 'x' });
  });

  it('will not save a card without consent', async () => {
    const res = await request(app).post('/customers/me/card').set('Authorization', auth('customer')).send({ paymentMethodId: 'pm_1' });
    expect(res.status).toBe(400);
    const res2 = await request(app).post('/customers/me/card').set('Authorization', auth('customer')).send({ paymentMethodId: 'pm_1', consent: false });
    expect(res2.status).toBe(400);
    expect(cards.saveCard).not.toHaveBeenCalled();
  });

  it('rejects something that is not a card reference', async () => {
    const res = await request(app).post('/customers/me/card').set('Authorization', auth('customer')).send({ paymentMethodId: 'tok; drop', consent: true });
    expect(res.status).toBe(400);
  });

  it('saves with consent', async () => {
    cards.saveCard.mockResolvedValue({ saved: true });
    const res = await request(app).post('/customers/me/card').set('Authorization', auth('customer', 'c2')).send({ paymentMethodId: 'pm_1', consent: true });
    expect(res.status).toBe(201);
    expect(cards.saveCard).toHaveBeenCalledWith('c2', 'pm_1', true);
  });

  it('removes the card', async () => {
    cards.removeCard.mockResolvedValue({ saved: false });
    const res = await request(app).delete('/customers/me/card').set('Authorization', auth('customer'));
    expect(res.status).toBe(200);
  });
});
