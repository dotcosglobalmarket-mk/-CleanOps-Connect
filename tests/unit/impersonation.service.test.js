jest.mock('../../src/models/CleanerProfile', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/AuditLog', () => ({ create: jest.fn((doc) => Promise.resolve({ _id: 'audit1', ...doc })) }));

const jwt = require('jsonwebtoken');
const CleanerProfile = require('../../src/models/CleanerProfile');
const AuditLog = require('../../src/models/AuditLog');
const impersonationService = require('../../src/services/impersonation.service');

function chainable(finalValue) {
  const obj = {};
  obj.populate = jest.fn().mockReturnValue(obj);
  obj.then = (resolve) => Promise.resolve(finalValue).then(resolve);
  return obj;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('impersonation.service.start', () => {
  const req = { user: { id: 'admin1', role: 'admin' }, ip: '127.0.0.1' };

  it('throws 404 when the cleaner does not exist', async () => {
    CleanerProfile.findById.mockReturnValue(chainable(null));
    await expect(impersonationService.start('cleaner1', 'Support ticket #42', req)).rejects.toThrow(
      'Cleaner not found'
    );
  });

  it('issues a short-lived, read-only token scoped to the cleaner and logs it', async () => {
    const cleanerUser = { _id: 'user1', name: 'Sarah K.', email: 'sarah@example.com', role: 'cleaner', phone: null };
    CleanerProfile.findById.mockReturnValue(chainable({ _id: 'cleaner1', user: cleanerUser }));

    const result = await impersonationService.start('cleaner1', 'Support ticket #42', req);

    const payload = jwt.verify(result.token, process.env.JWT_SECRET);
    expect(payload.sub).toBe('user1');
    expect(payload.role).toBe('cleaner');
    expect(payload.imp).toBe('admin1');
    expect(result.expiresInSeconds).toBe(30 * 60);
    expect(result.cleaner).toEqual({
      id: 'user1',
      name: 'Sarah K.',
      email: 'sarah@example.com',
      role: 'cleaner',
      phone: null,
    });

    expect(AuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'admin1',
        actorRole: 'admin',
        action: 'cleaner.impersonation.start',
        targetType: 'cleaner',
        targetId: 'cleaner1',
        reason: 'Support ticket #42',
      })
    );
  });
});
