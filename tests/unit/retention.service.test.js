jest.mock('../../src/models/Job', () => ({ updateMany: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));

const Job = require('../../src/models/Job');
const Message = require('../../src/models/Message');
const AuditLog = require('../../src/models/AuditLog');
const { purgeOldDisputeText } = require('../../src/services/retention.service');

const DAY = 86400;

describe('purgeOldDisputeText', () => {
  it('removes only the written description, from disputes raised more than 12 months ago', async () => {
    Job.updateMany.mockResolvedValue({ modifiedCount: 2 });
    const now = new Date('2027-10-27T00:00:00Z');
    expect(await purgeOldDisputeText(now)).toBe(2);
    const [filter, update] = Job.updateMany.mock.calls[0];
    expect(update).toEqual({ $unset: { disputeDetail: 1 } });
    expect(now - filter.disputedAt.$lt).toBe(365 * DAY * 1000);
    expect(filter.disputeDetail).toEqual({ $exists: true });
  });

  it('does nothing when nothing is old enough', async () => {
    Job.updateMany.mockResolvedValue({ modifiedCount: 0 });
    expect(await purgeOldDisputeText()).toBe(0);
  });
});

describe('TTL indexes', () => {
  const ttl = (model) => model.schema.indexes().find(([fields]) => Object.keys(fields).length === 1 && fields.createdAt === 1);

  it('delete chat messages after 6 months and audit entries after 12 months', () => {
    expect(ttl(Message)[1].expireAfterSeconds).toBe(183 * DAY);
    expect(ttl(AuditLog)[1].expireAfterSeconds).toBe(365 * DAY);
  });
});
