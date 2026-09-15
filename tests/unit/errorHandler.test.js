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
});

describe('notFoundHandler', () => {
  it('returns a 404 naming the method and path', () => {
    const res = mockRes();
    notFoundHandler({ method: 'GET', originalUrl: '/nope' }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Route not found: GET /nope' });
  });
});
