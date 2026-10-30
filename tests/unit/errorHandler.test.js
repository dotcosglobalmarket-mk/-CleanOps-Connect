const { errorHandler, notFoundHandler } = require('../../src/middleware/errorHandler');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('errorHandler', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('maps a Mongoose ValidationError to 400', () => {
    const res = mockRes();
    const err = new Error('email is required');
    err.name = 'ValidationError';

    errorHandler(err, {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'email is required' });
  });

  it('maps a Mongoose CastError to 400 with the field name', () => {
    const res = mockRes();
    const err = new Error('Cast failed');
    err.name = 'CastError';
    err.path = '_id';

    errorHandler(err, {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid value for field "_id"' });
  });

  it('maps a duplicate key error to 409', () => {
    const res = mockRes();
    const err = new Error('duplicate');
    err.code = 11000;

    errorHandler(err, {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('includes err.details when present', () => {
    const res = mockRes();
    const err = new Error('Validation failed');
    err.status = 400;
    err.details = [{ path: 'email', message: 'Invalid email' }];

    errorHandler(err, {}, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      details: err.details,
    });
  });

  it('defaults to 500 for an unrecognized error', () => {
    const res = mockRes();
    errorHandler(new Error('boom'), {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'boom' });
  });

  describe('payment provider errors', () => {
    const leaky =
      "The provided key 'rk_live_********************ijCbUs' does not have access to account 'acct_1UUvpO0XdUxZqQ9F' (or that account does not exist).";

    it('never sends a Stripe error message to the browser', () => {
      const res = mockRes();
      const err = new Error(leaky);
      err.type = 'StripePermissionError';

      errorHandler(err, {}, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(502);
      const { message } = res.json.mock.calls[0][0];
      expect(message).toMatch(/payment provider/);
      expect(message).not.toMatch(/rk_live|acct_|ijCbUs/);
    });

    it('still writes the full Stripe error to the server log', () => {
      const res = mockRes();
      const err = new Error(leaky);
      err.type = 'StripeInvalidRequestError';

      errorHandler(err, {}, res, jest.fn());

      expect(consoleErrorSpy.mock.calls.flat().join(' ')).toContain('acct_1UUvpO0XdUxZqQ9F');
    });

    it('keeps the message of a declined card, which is written for the customer', () => {
      const res = mockRes();
      const err = new Error('Your card was declined.');
      err.type = 'StripeCardError';
      err.status = 402;

      errorHandler(err, {}, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith({ message: 'Your card was declined.' });
    });

    it('hides keys, webhook secrets and account ids if one reaches an ordinary error', () => {
      const res = mockRes();
      const err = new Error('failed with sk_live_abc123 and whsec_XyZ789 for acct_1ABC');

      errorHandler(err, {}, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith({ message: 'failed with [hidden] and [hidden] for [hidden]' });
    });
  });
});

describe('notFoundHandler', () => {
  it('returns a 404 naming the method and path', () => {
    const res = mockRes();
    notFoundHandler({ method: 'GET', originalUrl: '/nope' }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Route not found: GET /nope' });
  });
});
