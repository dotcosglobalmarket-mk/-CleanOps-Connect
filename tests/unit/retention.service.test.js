jest.mock('../../src/models/Job', () => ({ updateMany: jest.fn() }));
jest.mock('../../src/models/JobPhoto', () => ({ find: jest.fn(), deleteMany: jest.fn() }));
jest.mock('../../src/models/DocumentFile', () => ({ find: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));

const Job = require('../../src/models/Job');
const Message = require('../../src/models/Message');
const JobNote = require('../../src/models/JobNote');
const JobPhoto = require('../../src/models/JobPhoto');
const DocumentFile = require('../../src/models/DocumentFile');
const AuditLog = require('../../src/models/AuditLog');
const { purgeOldDisputeText, purgeOrphanJobPhotos, migrateAuditRetention } = require('../../src/services/retention.service');

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
  const ttl = (model, key) => model.schema.indexes().find(([fields]) => Object.keys(fields).length === 1 && fields[key] === 1);

  it('delete chat after 6 months and staff notes after 12 months', () => {
    expect(ttl(Message, 'createdAt')[1].expireAfterSeconds).toBe(183 * DAY);
    expect(ttl(JobNote, 'createdAt')[1].expireAfterSeconds).toBe(365 * DAY);
  });

  it('delete audit entries on the date each one carries, not a fixed time after it was written', () => {
    expect(ttl(AuditLog, 'expireAt')[1].expireAfterSeconds).toBe(0);
    expect(ttl(AuditLog, 'createdAt')).toBeUndefined();
  });
});

describe('purgeOrphanJobPhotos', () => {
  const page = (rows) => ({ sort: () => ({ limit: () => ({ select: () => ({ lean: async () => rows }) }) }) });
  const files = (ids) => ({ select: () => ({ lean: async () => ids.map((id) => ({ _id: id })) }) });

  beforeEach(() => JobPhoto.deleteMany.mockClear());

  it('removes photo records whose picture has been deleted, and keeps the rest', async () => {
    JobPhoto.find.mockReturnValueOnce(page([{ _id: 'p1', file: 'f1' }, { _id: 'p2', file: 'f2' }, { _id: 'p3', file: 'f3' }])).mockReturnValueOnce(page([]));
    DocumentFile.find.mockReturnValue(files(['f2']));
    expect(await purgeOrphanJobPhotos()).toBe(2);
    expect(JobPhoto.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['p1', 'p3'] } });
  });

  it('does nothing when every picture is still there', async () => {
    JobPhoto.find.mockReturnValueOnce(page([{ _id: 'p1', file: 'f1' }])).mockReturnValueOnce(page([]));
    DocumentFile.find.mockReturnValue(files(['f1']));
    expect(await purgeOrphanJobPhotos()).toBe(0);
    expect(JobPhoto.deleteMany).not.toHaveBeenCalled();
  });
});

describe('migrateAuditRetention', () => {
  const setup = ({ indexes, batches }) => {
    const collection = {
      indexes: jest.fn(async () => indexes),
      dropIndex: jest.fn(async () => {}),
      find: jest.fn(() => ({ limit: () => ({ toArray: async () => batches.shift() || [] }) })),
      bulkWrite: jest.fn(async () => {}),
    };
    Object.defineProperty(AuditLog, 'collection', { value: collection, configurable: true });
    return collection;
  };

  it('drops the old delete-everything-after-12-months index and dates every older entry by its kind', async () => {
    const written = new Date('2026-01-01T00:00:00Z');
    const collection = setup({
      indexes: [
        { name: '_id_', key: { _id: 1 } },
        { name: 'createdAt_1', key: { createdAt: 1 }, expireAfterSeconds: 31536000 },
        { name: 'expireAt_1', key: { expireAt: 1 }, expireAfterSeconds: 0 },
      ],
      batches: [[{ _id: 'a', action: 'chat.view', createdAt: written }, { _id: 'b', action: 'approval.approve', createdAt: written }]],
    });

    expect(await migrateAuditRetention()).toEqual({ droppedIndexes: 1, datedEntries: 2 });

    expect(collection.dropIndex).toHaveBeenCalledTimes(1);
    expect(collection.dropIndex).toHaveBeenCalledWith('createdAt_1');
    const ops = collection.bulkWrite.mock.calls[0][0];
    expect(ops[0].updateOne.update.$set.expireAt.getTime() - written.getTime()).toBe(365 * DAY * 1000);
    expect(ops[1].updateOne.update.$set.expireAt.getTime() - written.getTime()).toBe(6 * 365 * DAY * 1000);
  });

  it('does nothing the second time', async () => {
    const collection = setup({ indexes: [{ name: 'expireAt_1', key: { expireAt: 1 }, expireAfterSeconds: 0 }], batches: [] });
    expect(await migrateAuditRetention()).toEqual({ droppedIndexes: 0, datedEntries: 0 });
    expect(collection.dropIndex).not.toHaveBeenCalled();
    expect(collection.bulkWrite).not.toHaveBeenCalled();
  });

  it('copes with an audit collection that does not exist yet', async () => {
    const collection = { indexes: jest.fn(async () => { const e = new Error('ns not found'); e.code = 26; throw e; }) };
    Object.defineProperty(AuditLog, 'collection', { value: collection, configurable: true });
    expect(await migrateAuditRetention()).toEqual({ droppedIndexes: 0, datedEntries: 0 });
  });
});
