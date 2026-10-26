jest.mock('../../src/models/User', () => ({ exists: jest.fn(), create: jest.fn(), find: jest.fn() }));
jest.mock('../../src/services/auth.service', () => ({ hashPassword: jest.fn(async (p) => `hashed:${p}`) }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));

const User = require('../../src/models/User');
const authService = require('../../src/services/auth.service');
const logger = require('../../src/utils/logger');
const { ensureSuperAdmin } = require('../../src/services/admin-bootstrap.service');

const PASSWORD = 'a-long-secret-pw-1';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SUPER_ADMIN_EMAIL = 'Ops@CleanOp-Connect.co.uk';
  process.env.SUPER_ADMIN_PASSWORD = PASSWORD;
  delete process.env.SUPER_ADMIN_NAME;
  User.exists.mockResolvedValue(null);
  User.find.mockReturnValue({ select: () => ({ lean: async () => [] }) });
  User.create.mockResolvedValue({});
});
afterAll(() => {
  delete process.env.SUPER_ADMIN_EMAIL;
  delete process.env.SUPER_ADMIN_PASSWORD;
});

const logged = () => JSON.stringify([...logger.info.mock.calls, ...logger.error.mock.calls]);

describe('ensureSuperAdmin', () => {
  it('does nothing when the variables are not set', async () => {
    delete process.env.SUPER_ADMIN_PASSWORD;
    expect((await ensureSuperAdmin()).status).toBe('not_configured');
    delete process.env.SUPER_ADMIN_EMAIL;
    process.env.SUPER_ADMIN_PASSWORD = PASSWORD;
    expect((await ensureSuperAdmin()).status).toBe('not_configured');
    expect(User.create).not.toHaveBeenCalled();
  });

  it('creates an active admin, lower-casing the email and storing only a hash', async () => {
    expect(await ensureSuperAdmin()).toEqual({ status: 'created' });
    expect(authService.hashPassword).toHaveBeenCalledWith(PASSWORD);
    expect(User.create).toHaveBeenCalledWith({
      name: 'Super Admin',
      email: 'ops@cleanop-connect.co.uk',
      passwordHash: `hashed:${PASSWORD}`,
      role: 'admin',
      active: true,
    });
    expect(JSON.stringify(User.create.mock.calls)).not.toContain(`"password":"${PASSWORD}"`);
  });

  it('uses SUPER_ADMIN_NAME when given', async () => {
    process.env.SUPER_ADMIN_NAME = '  Collins  ';
    await ensureSuperAdmin();
    expect(User.create.mock.calls[0][0].name).toBe('Collins');
  });

  it('never writes the password to the logs', async () => {
    await ensureSuperAdmin();
    expect(logged()).not.toContain(PASSWORD);
    process.env.SUPER_ADMIN_PASSWORD = 'short';
    await ensureSuperAdmin();
    expect(logged()).not.toContain('short');
  });

  it('refuses a bad email or a password under 12 characters, and says why', async () => {
    process.env.SUPER_ADMIN_EMAIL = 'not-an-email';
    expect(await ensureSuperAdmin()).toEqual({ status: 'invalid_email' });
    process.env.SUPER_ADMIN_EMAIL = 'ops@cleanop-connect.co.uk';
    process.env.SUPER_ADMIN_PASSWORD = 'elevenchars';
    expect(await ensureSuperAdmin()).toEqual({ status: 'weak_password' });
    expect(User.create).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('does nothing when an admin already exists, so the password is never reset by a restart', async () => {
    User.find.mockReturnValue({ select: () => ({ lean: async () => [{ email: 'boss@example.com', active: true }] }) });
    expect(await ensureSuperAdmin()).toEqual({ status: 'admin_exists' });
    expect(User.find).toHaveBeenCalledWith({ role: 'admin' });
    expect(User.create).not.toHaveBeenCalled();
    const msg = logger.info.mock.calls[0][0];
    expect(msg).toMatch(/b\*+@example\.com/);
    expect(msg).toMatch(/does not match/);
    expect(msg).not.toContain('boss@');
  });

  it('says so when the existing admin is the SUPER_ADMIN_EMAIL account', async () => {
    User.find.mockReturnValue({
      select: () => ({ lean: async () => [{ email: 'ops@cleanop-connect.co.uk', active: false }] }),
    });
    await ensureSuperAdmin();
    const msg = logger.info.mock.calls[0][0];
    expect(msg).toMatch(/\(disabled\)/);
    expect(msg).toMatch(/never overwritten/);
  });

  it('names the missing variable when not configured', async () => {
    delete process.env.SUPER_ADMIN_PASSWORD;
    expect(await ensureSuperAdmin()).toEqual({ status: 'not_configured', missing: ['SUPER_ADMIN_PASSWORD'] });
    expect(logger.info.mock.calls[0][0]).toMatch(/SUPER_ADMIN_PASSWORD not set/);
  });

  it('warns (without echoing it) when the password has leading or trailing spaces', async () => {
    process.env.SUPER_ADMIN_PASSWORD = `${PASSWORD} `;
    await ensureSuperAdmin();
    expect(logger.info.mock.calls.some(([m]) => /starts or ends with a space/.test(m))).toBe(true);
    expect(logged()).not.toContain(PASSWORD);
  });

  it('never promotes an existing non-admin account with that email (pre-registration takeover)', async () => {
    User.exists.mockResolvedValueOnce({ _id: 'customer1' });
    expect(await ensureSuperAdmin()).toEqual({ status: 'email_taken' });
    expect(User.exists).toHaveBeenLastCalledWith({ email: 'ops@cleanop-connect.co.uk' });
    expect(User.create).not.toHaveBeenCalled();
    expect(logger.error.mock.calls[0][0]).toMatch(/left unchanged/);
  });

  it('is safe when two instances start at once', async () => {
    User.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    expect(await ensureSuperAdmin()).toEqual({ status: 'admin_exists' });
  });

  it('logs, and does not throw, on any other database error', async () => {
    User.create.mockRejectedValue(new Error('db down'));
    expect(await ensureSuperAdmin()).toEqual({ status: 'error' });
    expect(logger.error).toHaveBeenCalled();
  });
});
