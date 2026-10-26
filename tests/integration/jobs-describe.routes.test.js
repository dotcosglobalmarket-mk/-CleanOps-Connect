jest.mock('../../src/models/User', () => ({
  findById: jest.fn((id) => Promise.resolve({ _id: id, name: 'U', role: 'customer', active: true })),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../src/services/ai-description.service', () => ({
  suggestDescription: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const ai = require('../../src/services/ai-description.service');

const auth = (role) =>
  `Bearer ${jwt.sign({ sub: 'user1', role }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;

describe('POST /jobs/describe', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/jobs/describe').send({ category: 'domestic' });
    expect(res.status).toBe(401);
  });

  it('is customer-only', async () => {
    const res = await request(app).post('/jobs/describe').set('Authorization', auth('cleaner')).send({ category: 'domestic' });
    expect(res.status).toBe(403);
    expect(ai.suggestDescription).not.toHaveBeenCalled();
  });

  it('rejects an over-long draft', async () => {
    const res = await request(app)
      .post('/jobs/describe')
      .set('Authorization', auth('customer'))
      .send({ category: 'domestic', draft: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
  });

  it('returns the suggestion', async () => {
    ai.suggestDescription.mockResolvedValue({ suggestion: 'Hello' });
    const res = await request(app)
      .post('/jobs/describe')
      .set('Authorization', auth('customer'))
      .send({ category: 'domestic', draft: 'flat' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ suggestion: 'Hello' });
    expect(ai.suggestDescription).toHaveBeenCalledWith({ category: 'domestic', draft: 'flat' });
  });
});
