jest.mock('../../src/models/Job', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/JobPhoto', () => ({
  find: jest.fn(), findOne: jest.fn(), create: jest.fn(), countDocuments: jest.fn(), deleteOne: jest.fn(), deleteMany: jest.fn(),
}));
jest.mock('../../src/models/DocumentFile', () => ({
  find: jest.fn(), findById: jest.fn(), create: jest.fn(), deleteMany: jest.fn(), updateMany: jest.fn(),
}));
jest.mock('../../src/models/CleanerProfile', () => ({ findOne: jest.fn() }));
jest.mock('../../src/services/audit.service', () => ({ record: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));

const Job = require('../../src/models/Job');
const JobPhoto = require('../../src/models/JobPhoto');
const DocumentFile = require('../../src/models/DocumentFile');
const CleanerProfile = require('../../src/models/CleanerProfile');
const audit = require('../../src/services/audit.service');
const svc = require('../../src/services/job-photo.service');

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const DAY = 86400000;
const customer = { id: 'cust1', role: 'customer' };
const cleaner = { id: 'cleanerUser', role: 'cleaner' };
const admin = { id: 'admin1', role: 'admin' };

const job = (paymentStatus) => ({ _id: 'job1', customer: 'cust1', cleaner: 'cp1', paymentStatus });

beforeEach(() => {
  jest.clearAllMocks();
  CleanerProfile.findOne.mockResolvedValue({ _id: 'cp1' });
  JobPhoto.countDocuments.mockResolvedValue(0);
  DocumentFile.create.mockImplementation(async (d) => ({ _id: 'file1', ...d }));
  JobPhoto.create.mockImplementation(async (d) => ({ _id: 'photo1', uploadedAt: new Date(), ...d }));
});

describe('detectMimeType', () => {
  it('accepts JPG and PNG by their first bytes only', () => {
    expect(svc.detectMimeType(JPG)).toBe('image/jpeg');
    expect(svc.detectMimeType(PNG)).toBe('image/png');
    expect(svc.detectMimeType(Buffer.from('%PDF-1.7 hello'))).toBeNull();
    expect(svc.detectMimeType(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
  });
});

describe('upload', () => {
  it('lets the booked cleaner add a before photo while the job is under way, with a 12-month safety deletion date', async () => {
    Job.findById.mockResolvedValue(job('IN_PROGRESS'));
    const photo = await svc.upload({ user: cleaner, jobId: 'job1', kind: 'before', filename: 'a.jpg', buffer: JPG });
    expect(photo).toMatchObject({ kind: 'before', uploaderRole: 'cleaner' });
    const { expireAt } = DocumentFile.create.mock.calls[0][0];
    expect(Math.round((expireAt - Date.now()) / DAY)).toBe(365);
  });

  it('lets the customer add problem photos once the job is awaiting confirmation or disputed', async () => {
    for (const status of ['AWAITING_CONFIRMATION', 'DISPUTED']) {
      Job.findById.mockResolvedValue(job(status));
      await expect(svc.upload({ user: customer, jobId: 'job1', kind: 'problem', buffer: PNG })).resolves.toMatchObject({ kind: 'problem' });
    }
  });

  it('refuses the wrong kind for the role', async () => {
    Job.findById.mockResolvedValue(job('AWAITING_CONFIRMATION'));
    await expect(svc.upload({ user: customer, jobId: 'job1', kind: 'before', buffer: JPG })).rejects.toMatchObject({ status: 403 });
    Job.findById.mockResolvedValue(job('IN_PROGRESS'));
    await expect(svc.upload({ user: cleaner, jobId: 'job1', kind: 'problem', buffer: JPG })).rejects.toMatchObject({ status: 403 });
  });

  it('refuses once the job is closed or has not started', async () => {
    for (const status of ['PAID_HELD', 'PAID_OUT', 'REFUNDED']) {
      Job.findById.mockResolvedValue(job(status));
      await expect(svc.upload({ user: cleaner, jobId: 'job1', kind: 'after', buffer: JPG })).rejects.toMatchObject({ status: 409 });
    }
  });

  it('refuses people who are not on the job, including staff', async () => {
    Job.findById.mockResolvedValue(job('IN_PROGRESS'));
    await expect(svc.upload({ user: { id: 'other', role: 'customer' }, jobId: 'job1', kind: 'problem', buffer: JPG })).rejects.toMatchObject({ status: 403 });
    CleanerProfile.findOne.mockResolvedValue({ _id: 'someoneElse' });
    await expect(svc.upload({ user: cleaner, jobId: 'job1', kind: 'before', buffer: JPG })).rejects.toMatchObject({ status: 403 });
    await expect(svc.upload({ user: admin, jobId: 'job1', kind: 'before', buffer: JPG })).rejects.toMatchObject({ status: 403 });
  });

  it('rejects empty, oversize and non-image files', async () => {
    Job.findById.mockResolvedValue(job('IN_PROGRESS'));
    await expect(svc.upload({ user: cleaner, jobId: 'job1', kind: 'after', buffer: Buffer.alloc(0) })).rejects.toMatchObject({ status: 400 });
    await expect(svc.upload({ user: cleaner, jobId: 'job1', kind: 'after', buffer: Buffer.alloc(svc.MAX_BYTES + 1, 0xff) })).rejects.toMatchObject({ status: 413 });
    await expect(svc.upload({ user: cleaner, jobId: 'job1', kind: 'after', buffer: Buffer.from('%PDF-1.7 hello') })).rejects.toMatchObject({ status: 400 });
    expect(DocumentFile.create).not.toHaveBeenCalled();
  });

  it('caps the number of photos each person can add to a job', async () => {
    Job.findById.mockResolvedValue(job('IN_PROGRESS'));
    JobPhoto.countDocuments.mockResolvedValue(6);
    await expect(svc.upload({ user: cleaner, jobId: 'job1', kind: 'after', buffer: JPG })).rejects.toMatchObject({ status: 409 });
    Job.findById.mockResolvedValue(job('DISPUTED'));
    JobPhoto.countDocuments.mockResolvedValue(4);
    await expect(svc.upload({ user: customer, jobId: 'job1', kind: 'problem', buffer: JPG })).rejects.toMatchObject({ status: 409 });
  });
});

describe('list', () => {
  it('tidies away records whose picture has already been deleted', async () => {
    Job.findById.mockResolvedValue(job('PAID_OUT'));
    JobPhoto.find.mockReturnValue({ sort: () => ({ lean: async () => [
      { _id: 'p1', file: 'f1', kind: 'before', uploaderRole: 'cleaner' },
      { _id: 'p2', file: 'f2', kind: 'after', uploaderRole: 'cleaner' },
    ] }) });
    DocumentFile.find.mockReturnValue({ select: () => ({ lean: async () => [{ _id: 'f1' }] }) });
    const photos = await svc.list({ user: customer, jobId: 'job1' });
    expect(photos.map((p) => p._id)).toEqual(['p1']);
    expect(JobPhoto.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['p2'] } });
  });
});

describe('getFile', () => {
  const photo = { _id: 'p1', file: 'f1', kind: 'after', uploaderRole: 'cleaner' };
  beforeEach(() => {
    Job.findById.mockResolvedValue(job('DISPUTED'));
    JobPhoto.findOne.mockResolvedValue(photo);
    DocumentFile.findById.mockResolvedValue({ data: JPG, mimeType: 'image/jpeg' });
  });

  it('records staff opening a photo, but not the two people on the job', async () => {
    await svc.getFile({ user: admin, jobId: 'job1', photoId: 'p1', req: { user: admin } });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'job_photo.view', targetType: 'job', targetId: 'job1' }));
    audit.record.mockClear();
    await svc.getFile({ user: customer, jobId: 'job1', photoId: 'p1', req: {} });
    await svc.getFile({ user: cleaner, jobId: 'job1', photoId: 'p1', req: {} });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('says so when retention has already deleted the picture', async () => {
    DocumentFile.findById.mockResolvedValue(null);
    await expect(svc.getFile({ user: customer, jobId: 'job1', photoId: 'p1', req: {} })).rejects.toMatchObject({ status: 410 });
    expect(JobPhoto.deleteOne).toHaveBeenCalled();
  });
});

describe('remove', () => {
  it('lets the uploader take a photo back, but not during a dispute or someone else\'s photo', async () => {
    Job.findById.mockResolvedValue(job('IN_PROGRESS'));
    JobPhoto.findOne.mockResolvedValue({ _id: 'p1', file: 'f1', uploadedBy: { toString: () => 'cleanerUser' } });
    await svc.remove({ user: cleaner, jobId: 'job1', photoId: 'p1' });
    expect(DocumentFile.deleteMany).toHaveBeenCalledWith({ _id: 'f1' });
    expect(JobPhoto.deleteOne).toHaveBeenCalled();

    await expect(svc.remove({ user: customer, jobId: 'job1', photoId: 'p1' })).rejects.toMatchObject({ status: 403 });
    Job.findById.mockResolvedValue(job('DISPUTED'));
    await expect(svc.remove({ user: cleaner, jobId: 'job1', photoId: 'p1' })).rejects.toMatchObject({ status: 409 });
  });
});

describe('scheduleExpiry', () => {
  it('sets every picture on the job to be deleted 90 days after the job closed', async () => {
    JobPhoto.find.mockReturnValue({ select: () => ({ lean: async () => [{ file: 'f1' }, { file: 'f2' }] }) });
    const closed = new Date('2026-10-01T00:00:00Z');
    await svc.scheduleExpiry('job1', closed);
    const [filter, update] = DocumentFile.updateMany.mock.calls[0];
    expect(filter).toEqual({ _id: { $in: ['f1', 'f2'] } });
    expect(update.$set.expireAt.getTime() - closed.getTime()).toBe(90 * DAY);
  });

  it('does nothing when there are no photos, and never throws', async () => {
    JobPhoto.find.mockReturnValue({ select: () => ({ lean: async () => [] }) });
    await svc.scheduleExpiry('job1');
    expect(DocumentFile.updateMany).not.toHaveBeenCalled();
    JobPhoto.find.mockImplementation(() => { throw new Error('db down'); });
    await expect(svc.scheduleExpiry('job1')).resolves.toBeUndefined();
  });
});
