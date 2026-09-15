const { z } = require('zod');
const { validateBody, validateParams } = require('../../src/middleware/validate');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('validate middleware', () => {
  const schema = z.object({ name: z.string().min(1), age: z.number().positive() });

  describe('validateBody', () => {
    it('replaces req.body with parsed data and calls next on success', () => {
      const req = { body: { name: 'Alice', age: 30, extra: 'stripped' } };
      const res = mockRes();
      const next = jest.fn();

      validateBody(schema)(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.body).toEqual({ name: 'Alice', age: 30 });
    });

    it('forwards a 400 error with per-field details on failure', () => {
      const req = { body: { name: '', age: -1 } };
      const res = mockRes();
      const next = jest.fn();

      validateBody(schema)(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0][0];
      expect(err.status).toBe(400);
      expect(err.details.map((d) => d.path)).toEqual(expect.arrayContaining(['name', 'age']));
    });
  });

  describe('validateParams', () => {
    it('replaces req.params with parsed data on success', () => {
      const req = { params: { name: 'Bob', age: 5 } };
      const res = mockRes();
      const next = jest.fn();

      validateParams(schema)(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.params).toEqual({ name: 'Bob', age: 5 });
    });

    it('forwards a 400 error on failure', () => {
      const req = { params: {} };
      const res = mockRes();
      const next = jest.fn();

      validateParams(schema)(req, res, next);

      const err = next.mock.calls[0][0];
      expect(err.status).toBe(400);
    });
  });
});
