jest.mock('../../src/models/User', () => ({
  findById: jest.fn((id) => Promise.resolve({ _id: id, name: 'Staff', role: 'admin', active: true })),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../src/services/ops.service');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const opsService = require('../../src/services/ops.service');

const auth = (role, id = 'u1') => `Bearer ${jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
const url = '/admin/cleaners/507f1f77bcf86cd799439033/reset-payouts';

describe('POST /admin/cleaners/:id/reset-payouts', () => {
  const app = createApp();
  beforeEach(() => jest.clearAllMocks());

  it.each(['cleaner', 'customer'])('is not for %s', async (role) => {
    const res = await request(app).post(url).set('Authorization', auth(role)).send({ reason: 'Test mode' });
    expect(res.status).toBe(403);
    expect(opsService.resetCleanerPayoutSetup).not.toHaveBeenCalled();
  });

  it('requires a reason', async () => {
    const res = await request(app).post(url).set('Authorization', auth('admin')).send({});
    expect(res.status).toBe(400);
  });

  it('resets, passing the reason through for the audit log', async () => {
    opsService.resetCleanerPayoutSetup.mockResolvedValue({});
    const res = await request(app).post(url).set('Authorization', auth('admin', 'admin1')).send({ reason: 'Created in test mode' });
    expect(res.status).toBe(200);
    expect(opsService.resetCleanerPayoutSetup).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439033',
      'Created in test mode',
      expect.objectContaining({ user: expect.objectContaining({ id: 'admin1' }) })
    );
  });
});
