jest.mock('../../src/models/User', () => ({ findById: jest.fn() }));

const User = require('../../src/models/User');
const { requirePermission, requireActiveStaff } = require('../../src/middleware/auth');
const { hasPermission } = require('../../src/config/permissions');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe('permission map', () => {
  it('gives operators day-to-day ops permissions only', () => {
    ['disputes.resolve', 'cleaners.verify', 'cleaners.review', 'payments.retry', 'jobs.note'].forEach((p) =>
      expect(hasPermission('operator', p)).toBe(true)
    );
    ['cleaners.suspend', 'refunds.over_limit', 'approvals.decide', 'audit.read', 'users.manage'].forEach((p) =>
      expect(hasPermission('operator', p)).toBe(false)
    );
  });

  it('gives admins every operator permission plus the separation-of-duties ones', () => {
    ['disputes.resolve', 'cleaners.suspend', 'refunds.over_limit', 'approvals.decide', 'users.manage'].forEach((p) =>
      expect(hasPermission('admin', p)).toBe(true)
    );
  });

  it('gives customers and cleaners no staff permissions', () => {
    expect(hasPermission('customer', 'disputes.read')).toBe(false);
    expect(hasPermission('cleaner', 'jobs.read')).toBe(false);
  });
});

describe('requirePermission', () => {
  it('lets a role with the permission through', () => {
    const next = jest.fn();
    requirePermission('disputes.resolve')({ user: { role: 'operator' } }, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when the role lacks the permission', () => {
    const res = mockRes();
    const next = jest.fn();
    requirePermission('cleaners.suspend')({ user: { role: 'operator' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireActiveStaff', () => {
  it('returns 403 for non-staff roles without touching the database', async () => {
    const res = mockRes();
    await requireActiveStaff({ user: { id: 'u1', role: 'customer' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(User.findById).not.toHaveBeenCalled();
  });

  it('lets an active staff member through', async () => {
    User.findById.mockResolvedValue({ _id: 'u1', role: 'operator', active: true, name: 'Olu' });
    const next = jest.fn();
    const req = { user: { id: 'u1', role: 'operator' } };
    await requireActiveStaff(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
    expect(req.user.name).toBe('Olu');
  });

  it('returns 401 for a deactivated account even with a valid token', async () => {
    User.findById.mockResolvedValue({ _id: 'u1', role: 'operator', active: false });
    const res = mockRes();
    const next = jest.fn();
    await requireActiveStaff({ user: { id: 'u1', role: 'operator' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the stored role no longer matches the token', async () => {
    User.findById.mockResolvedValue({ _id: 'u1', role: 'operator', active: true });
    const res = mockRes();
    await requireActiveStaff({ user: { id: 'u1', role: 'admin' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when the account no longer exists', async () => {
    User.findById.mockResolvedValue(null);
    const res = mockRes();
    await requireActiveStaff({ user: { id: 'u1', role: 'admin' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
