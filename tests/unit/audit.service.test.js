jest.mock('../../src/models/AuditLog', () => ({ create: jest.fn((doc) => Promise.resolve(doc)), find: jest.fn() }));

const AuditLog = require('../../src/models/AuditLog');
const auditService = require('../../src/services/audit.service');

const req = { user: { id: 'staff1', role: 'operator' }, ip: '203.0.113.5' };

beforeEach(() => jest.clearAllMocks());

describe('audit.service.record', () => {
  it('records the actor, role, IP and trimmed reason', async () => {
    await auditService.record({
      req,
      action: 'cleaner.verification.update',
      targetType: 'cleaner',
      targetId: 'c1',
      before: { dbsVerified: false },
      after: { dbsVerified: true },
      reason: '  DBS cert 001234567890 issued 2026-08-01  ',
    });

    expect(AuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'staff1',
        actorRole: 'operator',
        ip: '203.0.113.5',
        reason: 'DBS cert 001234567890 issued 2026-08-01',
      })
    );
  });

  it('refuses to record an action without a reason', async () => {
    await expect(
      auditService.record({ req, action: 'dispute.resolve', targetType: 'job', targetId: 'j1', reason: '   ' })
    ).rejects.toMatchObject({ status: 400 });
    expect(AuditLog.create).not.toHaveBeenCalled();
  });
});

describe('AuditLog model is append-only', () => {
  const RealAuditLog = jest.requireActual('../../src/models/AuditLog');

  it('refuses updates and deletes', async () => {
    await expect(RealAuditLog.updateOne({}, { reason: 'changed' }).exec()).rejects.toThrow(
      'Audit log entries cannot be changed or deleted'
    );
    await expect(RealAuditLog.deleteMany({}).exec()).rejects.toThrow('Audit log entries cannot be changed or deleted');
  });
});
