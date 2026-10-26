const jwt = require('jsonwebtoken');
const { requireAuth, requireRole } = require('../../src/middleware/auth');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('auth middleware', () => {
  describe('requireAuth', () => {
    it('rejects a request with no Authorization header', () => {
      const res = mockRes();
      const next = jest.fn();
      requireAuth({ headers: {} }, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Authentication required' });
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects an invalid token', () => {
      const res = mockRes();
      const next = jest.fn();
      requireAuth({ headers: { authorization: 'Bearer not-a-real-token' } }, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or expired token' });
      expect(next).not.toHaveBeenCalled();
    });

    it('attaches req.user and calls next for a valid token', () => {
      const token = jwt.sign({ sub: 'user123', role: 'customer' }, process.env.JWT_SECRET, {
        expiresIn: '1h',
      });
      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = mockRes();
      const next = jest.fn();

      requireAuth(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toEqual({ id: 'user123', role: 'customer' });
    });

    it('allows a GET request with an impersonation token and marks req.user.impersonatedBy', () => {
      const token = jwt.sign({ sub: 'cleaner1', role: 'cleaner', imp: 'admin1' }, process.env.JWT_SECRET, {
        expiresIn: '30m',
      });
      const req = { headers: { authorization: `Bearer ${token}` }, method: 'GET' };
      const res = mockRes();
      const next = jest.fn();

      requireAuth(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toEqual({ id: 'cleaner1', role: 'cleaner', impersonatedBy: 'admin1' });
    });

    it('rejects a write request made with an impersonation token', () => {
      const token = jwt.sign({ sub: 'cleaner1', role: 'cleaner', imp: 'admin1' }, process.env.JWT_SECRET, {
        expiresIn: '30m',
      });
      const req = { headers: { authorization: `Bearer ${token}` }, method: 'POST' };
      const res = mockRes();
      const next = jest.fn();

      requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        message: 'This is a read-only support view and cannot make changes',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('requireRole', () => {
    it('calls next when the role matches', () => {
      const req = { user: { id: 'u1', role: 'customer' } };
      const res = mockRes();
      const next = jest.fn();

      requireRole('customer')(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 403 when the role does not match', () => {
      const req = { user: { id: 'u1', role: 'customer' } };
      const res = mockRes();
      const next = jest.fn();

      requireRole('cleaner')(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: 'Insufficient permissions' });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 when req.user is missing', () => {
      const res = mockRes();
      const next = jest.fn();

      requireRole('customer')({}, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
