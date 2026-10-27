jest.mock('../../src/models/CleanerProfile', () => ({ findOne: jest.fn(), findById: jest.fn() }));
jest.mock('../../src/models/DocumentFile', () => ({ create: jest.fn(), findById: jest.fn(), deleteMany: jest.fn() }));
jest.mock('../../src/models/Job', () => ({ exists: jest.fn(), find: jest.fn() }));
jest.mock('../../src/models/JobOffer', () => ({ exists: jest.fn() }));

const CleanerProfile = require('../../src/models/CleanerProfile');
const DocumentFile = require('../../src/models/DocumentFile');
const Job = require('../../src/models/Job');
const JobOffer = require('../../src/models/JobOffer');
const svc = require('../../src/services/cleaner-photo.service');

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

const profile = (extra = {}) => ({ _id: 'cp1', user: { toString: () => 'cleanerUser' }, save: jest.fn(), ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  DocumentFile.create.mockResolvedValue({ _id: 'newFile' });
  Job.exists.mockResolvedValue(null);
  Job.find.mockReturnValue({ distinct: async () => [] });
  JobOffer.exists.mockResolvedValue(null);
});

describe('setPhoto', () => {
  it('stores a JPG or PNG on the profile and deletes the picture it replaces', async () => {
    const p = profile({ photo: { file: 'oldFile' } });
    CleanerProfile.findOne.mockResolvedValue(p);
    const result = await svc.setPhoto({ userId: 'cleanerUser', buffer: PNG });
    expect(result.hasPhoto).toBe(true);
    expect(DocumentFile.create).toHaveBeenCalledWith({ data: PNG, mimeType: 'image/png' });
    expect(p.photo.file).toBe('newFile');
    expect(p.save).toHaveBeenCalled();
    expect(DocumentFile.deleteMany).toHaveBeenCalledWith({ _id: 'oldFile' });
  });

  it('never sets a deletion date, so the picture stays while it is on the profile', async () => {
    CleanerProfile.findOne.mockResolvedValue(profile());
    await svc.setPhoto({ userId: 'cleanerUser', buffer: JPG });
    expect(DocumentFile.create.mock.calls[0][0].expireAt).toBeUndefined();
  });

  it('rejects empty, oversize and non-image files, and a cleaner with no profile', async () => {
    CleanerProfile.findOne.mockResolvedValue(profile());
    await expect(svc.setPhoto({ userId: 'u', buffer: Buffer.alloc(0) })).rejects.toMatchObject({ status: 400 });
    await expect(svc.setPhoto({ userId: 'u', buffer: Buffer.alloc(svc.MAX_BYTES + 1, 0xff) })).rejects.toMatchObject({ status: 413 });
    await expect(svc.setPhoto({ userId: 'u', buffer: Buffer.from('<svg onload=alert(1)>') })).rejects.toMatchObject({ status: 400 });
    expect(DocumentFile.create).not.toHaveBeenCalled();
    CleanerProfile.findOne.mockResolvedValue(null);
    await expect(svc.setPhoto({ userId: 'u', buffer: JPG })).rejects.toMatchObject({ status: 404 });
  });
});

describe('removePhoto', () => {
  it('clears the profile and deletes the stored picture', async () => {
    const p = profile({ photo: { file: 'oldFile' } });
    CleanerProfile.findOne.mockResolvedValue(p);
    await svc.removePhoto({ userId: 'cleanerUser' });
    expect(p.photo).toBeUndefined();
    expect(DocumentFile.deleteMany).toHaveBeenCalledWith({ _id: 'oldFile' });
  });
});

describe('getPhoto access', () => {
  const stored = { data: JPG, mimeType: 'image/jpeg' };
  beforeEach(() => {
    CleanerProfile.findById.mockResolvedValue(profile({ photo: { file: 'f1', updatedAt: new Date() } }));
    DocumentFile.findById.mockResolvedValue(stored);
  });

  it('lets the cleaner themselves and staff see it', async () => {
    await expect(svc.getPhoto({ user: { id: 'cleanerUser', role: 'cleaner' }, cleanerId: 'cp1' })).resolves.toMatchObject({ file: stored });
    await expect(svc.getPhoto({ user: { id: 'a', role: 'admin' }, cleanerId: 'cp1' })).resolves.toMatchObject({ file: stored });
    await expect(svc.getPhoto({ user: { id: 'o', role: 'operator' }, cleanerId: 'cp1' })).resolves.toMatchObject({ file: stored });
  });

  it('lets a customer see it only once the cleaner has been offered or booked on one of their jobs', async () => {
    const customer = { id: 'cust1', role: 'customer' };
    await expect(svc.getPhoto({ user: customer, cleanerId: 'cp1' })).rejects.toMatchObject({ status: 404 });

    Job.exists.mockResolvedValue({ _id: 'j1' });
    await expect(svc.getPhoto({ user: customer, cleanerId: 'cp1' })).resolves.toMatchObject({ file: stored });

    Job.exists.mockResolvedValue(null);
    Job.find.mockReturnValue({ distinct: async () => ['j2'] });
    JobOffer.exists.mockResolvedValue({ _id: 'o1' });
    await expect(svc.getPhoto({ user: customer, cleanerId: 'cp1' })).resolves.toMatchObject({ file: stored });
    expect(JobOffer.exists).toHaveBeenCalledWith({ cleaner: 'cp1', job: { $in: ['j2'] } });
  });

  it('hides it from other cleaners and from customers once the cleaner is suspended', async () => {
    await expect(svc.getPhoto({ user: { id: 'otherCleaner', role: 'cleaner' }, cleanerId: 'cp1' })).rejects.toMatchObject({ status: 404 });
    CleanerProfile.findById.mockResolvedValue(profile({ deactivationStatus: 'suspended', photo: { file: 'f1' } }));
    Job.exists.mockResolvedValue({ _id: 'j1' });
    await expect(svc.getPhoto({ user: { id: 'cust1', role: 'customer' }, cleanerId: 'cp1' })).rejects.toMatchObject({ status: 404 });
  });

  it('says there is no picture when the cleaner has not added one', async () => {
    CleanerProfile.findById.mockResolvedValue(profile());
    await expect(svc.getPhoto({ user: { id: 'a', role: 'admin' }, cleanerId: 'cp1' })).rejects.toMatchObject({ status: 404 });
  });
});
