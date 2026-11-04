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


describe('audit entry retention', () => {
  const DAY = 86400000;
  const base = { req, targetType: 'job', targetId: 'j1', reason: 'because' };

  it('keeps everyday staff activity for 12 months', async () => {
    await auditService.record({ ...base, action: 'chat.view' });
    const { expireAt } = AuditLog.create.mock.calls[0][0];
    expect(Math.round((expireAt - Date.now()) / DAY)).toBe(365);
  });

  it('keeps refund, payout and dispute decisions for 6 years', async () => {
    for (const action of ['dispute.resolve', 'dispute.resolution.requested', 'approval.approve', 'approval.reject', 'payout.manual_retry', 'payout.release_early', 'user.erase', 'user.export', 'user.request_closed']) {
      AuditLog.create.mockClear();
      await auditService.record({ ...base, action });
      const { expireAt } = AuditLog.create.mock.calls[0][0];
      expect(Math.round((expireAt - Date.now()) / DAY)).toBe(6 * 365);
    }
  });

  it('works out the date from when an older entry was written', () => {
    const written = new Date('2026-01-01T00:00:00Z');
    expect(auditService.expiryFor('chat.view', written).getTime() - written.getTime()).toBe(365 * DAY);
    expect(auditService.expiryFor('approval.approve', written).getTime() - written.getTime()).toBe(6 * 365 * DAY);
    expect(auditService.isFinancialAction('job.note')).toBe(false);
  });
});
