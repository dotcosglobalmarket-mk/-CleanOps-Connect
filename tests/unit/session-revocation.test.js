jest.mock('../../src/models/User', () => ({ findById: jest.fn() }));

const jwt = require('jsonwebtoken');
const User = require('../../src/models/User');
const { requireAuth, requireActiveIfStaff } = require('../../src/middleware/auth');
const { signToken, revokeSessions, isCurrent } = require('../../src/services/session.service');

const sign = (claims) => jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: '1h' });
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};
const run = async (token, extra = {}) => {
  const req = { headers: { authorization: `Bearer ${token}` }, method: 'GET', ...extra };
  const res = mockRes();
  const next = jest.fn();
  await requireAuth(req, res, next);
  return { req, res, next };
};

beforeEach(() => jest.clearAllMocks());

describe('session version', () => {
  it('signToken carries the account\'s version, and revokeSessions raises it', () => {
    const user = { _id: 'u1', role: 'customer', tokenVersion: 2 };
    expect(jwt.decode(signToken(user)).tv).toBe(2);
    revokeSessions(user);
    expect(user.tokenVersion).toBe(3);
    const fresh = { _id: 'u2', role: 'customer' };
    revokeSessions(fresh);
    expect(fresh.tokenVersion).toBe(1);
    expect(jwt.decode(signToken({ _id: 'u3', role: 'customer' })).tv).toBe(0);
  });

  it('isCurrent: matching version yes; older no; missing or inactive account no; old tokens without a version are left to expire', () => {
    expect(isCurrent({ tv: 1 }, { tokenVersion: 1 })).toBe(true);
    expect(isCurrent({ tv: 0 }, { tokenVersion: 1 })).toBe(false);
    expect(isCurrent({ tv: 0 }, { })).toBe(true);
    expect(isCurrent({ tv: 0 }, null)).toBe(false);
    expect(isCurrent({ tv: 0 }, { tokenVersion: 0, active: false })).toBe(false);
    expect(isCurrent({}, null)).toBe(true);
  });
});

describe('requireAuth with session versions', () => {
  it('lets a session through while its version is the account\'s current one', async () => {
    User.findById.mockResolvedValue({ _id: 'u1', tokenVersion: 3, active: true });
    const { req, next } = await run(sign({ sub: 'u1', role: 'customer', tv: 3 }));
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({ id: 'u1', role: 'customer' });
  });

  it('ends a session once the version has been raised (password reset, two-step reset, deactivation)', async () => {
    User.findById.mockResolvedValue({ _id: 'u1', tokenVersion: 4, active: true });
    const { res, next } = await run(sign({ sub: 'u1', role: 'admin', tv: 3 }));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Your session has ended. Please log in again.' });
    expect(next).not.toHaveBeenCalled();
  });

  it('refuses a session for an account that no longer exists or is inactive', async () => {
    User.findById.mockResolvedValue(null);
    expect((await run(sign({ sub: 'gone', role: 'customer', tv: 0 }))).res.status).toHaveBeenCalledWith(401);
    User.findById.mockResolvedValue({ _id: 'u1', tokenVersion: 0, active: false });
    expect((await run(sign({ sub: 'u1', role: 'operator', tv: 0 }))).res.status).toHaveBeenCalledWith(401);
  });

  it('does not look anything up for a session issued before versions existed', async () => {
    const { next } = await run(sign({ sub: 'u1', role: 'customer' }));
    expect(next).toHaveBeenCalledWith();
    expect(User.findById).not.toHaveBeenCalled();
  });

  it('does not look anything up for a read-only support view', async () => {
    const { next } = await run(sign({ sub: 'c1', role: 'cleaner', imp: 'admin1' }));
    expect(next).toHaveBeenCalledWith();
    expect(User.findById).not.toHaveBeenCalled();
  });

  it('treats a database failure as a server error, not as a logged-out user', async () => {
    const boom = new Error('db down');
    User.findById.mockRejectedValue(boom);
    const { res, next } = await run(sign({ sub: 'u1', role: 'customer', tv: 0 }));
    expect(next).toHaveBeenCalledWith(boom);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('requireActiveIfStaff', () => {
  const call = async (user) => {
    const res = mockRes();
    const next = jest.fn();
    await requireActiveIfStaff({ user }, res, next);
    return { res, next };
  };

  it('passes customers and cleaners straight through, with no lookup', async () => {
    expect((await call({ id: 'c1', role: 'customer' })).next).toHaveBeenCalledWith();
    expect((await call({ id: 'c2', role: 'cleaner' })).next).toHaveBeenCalledWith();
    expect(User.findById).not.toHaveBeenCalled();
  });

  it('lets an active staff member through and turns a deactivated one away', async () => {
    User.findById.mockResolvedValue({ _id: 'o1', role: 'operator', active: true, name: 'Ops' });
    expect((await call({ id: 'o1', role: 'operator' })).next).toHaveBeenCalledWith();
    User.findById.mockResolvedValue({ _id: 'o1', role: 'operator', active: false });
    const { res, next } = await call({ id: 'o1', role: 'operator' });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
