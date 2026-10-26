jest.mock('../../src/models/User', () => ({
  findById: jest.fn((id) => Promise.resolve({ _id: id, name: 'U', role: 'cleaner', active: true })),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../src/services/ai-description.service', () => ({
  suggestDescription: jest.fn(),
  suggestBio: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const ai = require('../../src/services/ai-description.service');

const auth = (role) =>
  `Bearer ${jwt.sign({ sub: 'user1', role }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;

describe('POST /cleaners/me/describe-bio', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  it('requires authentication', async () => {
    expect((await request(app).post('/cleaners/me/describe-bio').send({})).status).toBe(401);
  });

  it('is cleaner-only', async () => {
    const res = await request(app).post('/cleaners/me/describe-bio').set('Authorization', auth('customer')).send({});
    expect(res.status).toBe(403);
    expect(ai.suggestBio).not.toHaveBeenCalled();
  });

  it('rejects an over-long draft and bad service ids', async () => {
    const long = await request(app)
      .post('/cleaners/me/describe-bio')
      .set('Authorization', auth('cleaner'))
      .send({ draft: 'x'.repeat(2001) });
    expect(long.status).toBe(400);
    const bad = await request(app)
      .post('/cleaners/me/describe-bio')
      .set('Authorization', auth('cleaner'))
      .send({ services: ['nope'] });
    expect(bad.status).toBe(400);
  });

  it('returns the suggestion', async () => {
    ai.suggestBio.mockResolvedValue({ suggestion: 'Hi' });
    const res = await request(app)
      .post('/cleaners/me/describe-bio')
      .set('Authorization', auth('cleaner'))
      .send({ draft: 'leeds cleaner', travelDistanceMiles: 10 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ suggestion: 'Hi' });
    expect(ai.suggestBio).toHaveBeenCalledWith({ draft: 'leeds cleaner', travelDistanceMiles: 10 });
  });
});
