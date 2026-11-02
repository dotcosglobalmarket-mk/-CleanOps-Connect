jest.mock('../../src/models/User', () => ({
  findById: jest.fn((id) => Promise.resolve({ _id: id, name: 'Staff', role: 'operator', active: true })),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../src/services/series-view.service');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const viewService = require('../../src/services/series-view.service');
const User = require('../../src/models/User');

const auth = (role) => `Bearer ${jwt.sign({ sub: 'staff1', role }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;

describe('GET /ops/series', () => {
  const app = createApp();
  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockResolvedValue({ _id: 'staff1', name: 'Staff', role: 'operator', active: true });
  });

  it.each(['cleaner', 'customer'])('is staff only (%s gets 403)', async (role) => {
    expect((await request(app).get('/ops/series').set('Authorization', auth(role))).status).toBe(403);
  });

  it.each(['operator', 'admin'])('lets %s list series, passing the status filter', async (role) => {
    User.findById.mockResolvedValue({ _id: 'staff1', name: 'Staff', role, active: true });
    viewService.listForStaff.mockResolvedValue([{ status: 'paused' }]);
    const res = await request(app).get('/ops/series?status=paused').set('Authorization', auth(role));
    expect(res.status).toBe(200);
    expect(viewService.listForStaff).toHaveBeenCalledWith({ status: 'paused' });
  });

  it('rejects an unknown status', async () => {
    expect((await request(app).get('/ops/series?status=nonsense').set('Authorization', auth('operator'))).status).toBe(400);
  });
});
