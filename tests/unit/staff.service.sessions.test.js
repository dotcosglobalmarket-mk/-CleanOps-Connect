jest.mock('../../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('../../src/services/audit.service', () => ({ record: jest.fn() }));
jest.mock('../../src/services/two-factor.service', () => ({ reset: jest.fn() }));

const User = require('../../src/models/User');
const staffService = require('../../src/services/staff.service');

const staff = (extra = {}) => ({ _id: 'op1', name: 'Op', email: 'op@example.com', role: 'operator', active: true, tokenVersion: 1, save: jest.fn(), ...extra });
const req = { user: { id: 'admin1', role: 'admin' }, ip: '1.1.1.1' };

beforeEach(() => jest.clearAllMocks());

describe('deactivating staff', () => {
  it('ends every session they already have', async () => {
    const user = staff();
    User.findById.mockResolvedValue(user);
    await staffService.setStaffActive('op1', false, 'Left the company', req);
    expect(user.active).toBe(false);
    expect(user.tokenVersion).toBe(2);
    expect(user.save).toHaveBeenCalled();
  });

  it('does not touch sessions when an account is switched back on', async () => {
    const user = staff({ active: false });
    User.findById.mockResolvedValue(user);
    await staffService.setStaffActive('op1', true, 'Back from leave', req);
    expect(user.active).toBe(true);
    expect(user.tokenVersion).toBe(1);
  });
});
