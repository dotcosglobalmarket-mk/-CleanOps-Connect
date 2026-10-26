jest.mock('../../src/models/CleanerDocument', () => ({
  find: jest.fn(), findById: jest.fn(), create: jest.fn(), deleteMany: jest.fn(), updateMany: jest.fn(),
}));
jest.mock('../../src/models/DocumentFile', () => ({
  find: jest.fn(), findById: jest.fn(), create: jest.fn(), deleteMany: jest.fn(), updateOne: jest.fn(),
}));
jest.mock('../../src/models/CleanerProfile', () => ({ findOne: jest.fn(), findById: jest.fn() }));
jest.mock('../../src/services/audit.service', () => ({ record: jest.fn() }));
jest.mock('../../src/services/notification.service', () => ({
  complianceDocumentReviewed: jest.fn(), complianceDocumentExpired: jest.fn(),
}));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));

const CleanerDocument = require('../../src/models/CleanerDocument');
const DocumentFile = require('../../src/models/DocumentFile');
const CleanerProfile = require('../../src/models/CleanerProfile');
const audit = require('../../src/services/audit.service');
const notifications = require('../../src/services/notification.service');
const svc = require('../../src/services/compliance-document.service');

const PDF = Buffer.from('%PDF-1.7 hello');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0]);
const DAY = 86400000;
const req = { user: { id: 'admin1', role: 'admin' }, ip: '1.1.1.1' };

beforeEach(() => {
  jest.clearAllMocks();
  CleanerProfile.findOne.mockResolvedValue({ _id: 'cp1' });
  CleanerDocument.find.mockResolvedValue([]);
  DocumentFile.create.mockImplementation(async (d) => ({ _id: 'file1', ...d }));
  CleanerDocument.create.mockImplementation(async (d) => ({ _id: 'doc1', status: 'pending', uploadedAt: new Date(), ...d }));
});

describe('detectMimeType', () => {
  it('trusts the first bytes, not the name', () => {
    expect(svc.detectMimeType(PDF)).toBe('application/pdf');
    expect(svc.detectMimeType(PNG)).toBe('image/png');
    expect(svc.detectMimeType(JPG)).toBe('image/jpeg');
    expect(svc.detectMimeType(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(svc.detectMimeType(Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04'))).toBeNull();
    expect(svc.detectMimeType(Buffer.alloc(0))).toBeNull();
  });
});

describe('upload', () => {
  const user = { id: 'u1' };

  it('stores a valid file and sets a deletion date on DBS copies only', async () => {
    const dbs = await svc.upload({ user, type: 'dbs', filename: 'a.pdf', buffer: PDF });
    expect(dbs).toMatchObject({ type: 'dbs', status: 'pending', mimeType: 'application/pdf', fileAvailable: true });
    const stored = DocumentFile.create.mock.calls[0][0];
    const days = (stored.expireAt - Date.now()) / DAY;
    expect(days).toBeGreaterThan(182);
    expect(days).toBeLessThan(184);

    await svc.upload({ user, type: 'insurance', filename: 'b.png', buffer: PNG });
    expect(DocumentFile.create.mock.calls[1][0].expireAt).toBeUndefined();
  });

  it('refuses a disguised file, an empty one, an oversize one and an unknown type', async () => {
    await expect(svc.upload({ user, type: 'dbs', buffer: Buffer.from('<html>not a pdf at all</html>') })).rejects.toMatchObject({ status: 400 });
    await expect(svc.upload({ user, type: 'dbs', buffer: Buffer.alloc(0) })).rejects.toMatchObject({ status: 400 });
    await expect(svc.upload({ user, type: 'dbs', buffer: {} })).rejects.toMatchObject({ status: 400 });
    await expect(svc.upload({ user, type: 'dbs', buffer: Buffer.concat([PDF, Buffer.alloc(svc.MAX_BYTES)]) })).rejects.toMatchObject({ status: 413 });
    await expect(svc.upload({ user, type: 'passport', buffer: PDF })).rejects.toMatchObject({ status: 400 });
    expect(DocumentFile.create).not.toHaveBeenCalled();
  });

  it('needs a registered profile', async () => {
    CleanerProfile.findOne.mockResolvedValue(null);
    await expect(svc.upload({ user, type: 'dbs', buffer: PDF })).rejects.toMatchObject({ status: 400 });
  });

  it('replaces a document still waiting for review, deleting its file', async () => {
    CleanerDocument.find.mockResolvedValue([{ _id: 'old', file: 'oldfile' }]);
    await svc.upload({ user, type: 'coshh', buffer: PDF });
    expect(DocumentFile.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['oldfile'] } });
    expect(CleanerDocument.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['old'] } });
  });

  it('cleans a hostile filename', async () => {
    await svc.upload({ user, type: 'dbs', filename: '..\\..\\etc/"pass<wd>".pdf', buffer: PDF });
    expect(CleanerDocument.create.mock.calls[0][0].originalName).toBe('passwd.pdf');
  });
});

describe('getFileForReview', () => {
  it('records that an admin opened the document', async () => {
    CleanerDocument.findById.mockResolvedValue({ _id: 'd1', cleaner: 'cp1', type: 'dbs', file: 'f1' });
    DocumentFile.findById.mockResolvedValue({ mimeType: 'application/pdf', data: PDF });
    await svc.getFileForReview('d1', req);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'compliance_document.view', targetId: 'cp1' }));
  });

  it('says so when the retention period has already removed the file, and records nothing', async () => {
    CleanerDocument.findById.mockResolvedValue({ _id: 'd1', cleaner: 'cp1', type: 'dbs', file: 'f1' });
    DocumentFile.findById.mockResolvedValue(null);
    await expect(svc.getFileForReview('d1', req)).rejects.toMatchObject({ status: 410 });
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('review', () => {
  const pendingDoc = (type) => ({ _id: 'd1', cleaner: 'cp1', type, status: 'pending', file: 'f1', save: jest.fn().mockResolvedValue(undefined) });
  const profile = (extra = {}) => ({ _id: 'cp1', dbsVerified: false, coshhTrained: false, insuranceStatus: 'none', save: jest.fn().mockResolvedValue(undefined), ...extra });
  const future = new Date(Date.now() + 365 * DAY).toISOString();

  it('approving a DBS certificate verifies the cleaner, audits it and starts the 6-month clock', async () => {
    const doc = pendingDoc('dbs');
    const cleaner = profile();
    CleanerDocument.findById.mockResolvedValue(doc);
    CleanerProfile.findById.mockResolvedValue(cleaner);
    CleanerDocument.find.mockResolvedValue([]);

    await svc.review('d1', { decision: 'approve' }, req);

    expect(doc.status).toBe('approved');
    expect(doc.reviewedBy).toBe('admin1');
    expect(cleaner.dbsVerified).toBe(true);
    const update = DocumentFile.updateOne.mock.calls[0][1].$set.expireAt;
    expect((update - Date.now()) / DAY).toBeGreaterThan(182);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'compliance_document.approve', before: { dbsVerified: false } }));
    expect(notifications.complianceDocumentReviewed).toHaveBeenCalled();
  });

  it('insurance needs an expiry date, which must be in the future', async () => {
    CleanerDocument.findById.mockResolvedValue(pendingDoc('insurance'));
    CleanerProfile.findById.mockResolvedValue(profile());
    await expect(svc.review('d1', { decision: 'approve' }, req)).rejects.toMatchObject({ status: 400 });
    await expect(svc.review('d1', { decision: 'approve', expiresAt: '2020-01-01' }, req)).rejects.toMatchObject({ status: 400 });
    await expect(svc.review('d1', { decision: 'approve', expiresAt: 'soon' }, req)).rejects.toMatchObject({ status: 400 });
  });

  it('approving insurance sets "own", but never downgrades insurance the platform provides', async () => {
    const own = profile();
    CleanerDocument.findById.mockResolvedValue(pendingDoc('insurance'));
    CleanerProfile.findById.mockResolvedValue(own);
    await svc.review('d1', { decision: 'approve', expiresAt: future }, req);
    expect(own.insuranceStatus).toBe('own');

    const platform = profile({ insuranceStatus: 'platform' });
    CleanerDocument.findById.mockResolvedValue(pendingDoc('insurance'));
    CleanerProfile.findById.mockResolvedValue(platform);
    await svc.review('d1', { decision: 'approve', expiresAt: future }, req);
    expect(platform.insuranceStatus).toBe('platform');
  });

  it('replaces the previously approved document and deletes its file', async () => {
    CleanerDocument.findById.mockResolvedValue(pendingDoc('coshh'));
    CleanerProfile.findById.mockResolvedValue(profile());
    CleanerDocument.find.mockResolvedValue([{ _id: 'prev', file: 'prevfile' }]);
    await svc.review('d1', { decision: 'approve' }, req);
    expect(CleanerDocument.updateMany).toHaveBeenCalledWith({ _id: { $in: ['prev'] } }, { $set: { status: 'superseded' } });
    expect(DocumentFile.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['prevfile'] } });
  });

  it('rejecting needs a reason, leaves the badge alone and sets a 30-day deletion', async () => {
    const doc = pendingDoc('dbs');
    CleanerDocument.findById.mockResolvedValue(doc);
    await expect(svc.review('d1', { decision: 'reject' }, req)).rejects.toMatchObject({ status: 400 });
    expect(doc.status).toBe('pending');

    await svc.review('d1', { decision: 'reject', reason: 'Name does not match' }, req);
    expect(doc.status).toBe('rejected');
    expect(doc.rejectionReason).toBe('Name does not match');
    expect(CleanerProfile.findById).not.toHaveBeenCalled();
    expect((DocumentFile.updateOne.mock.calls[0][1].$set.expireAt - Date.now()) / DAY).toBeGreaterThan(29);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'compliance_document.reject', reason: 'Name does not match' }));
  });

  it('cannot review a document twice', async () => {
    CleanerDocument.findById.mockResolvedValue({ ...pendingDoc('dbs'), status: 'approved' });
    await expect(svc.review('d1', { decision: 'approve' }, req)).rejects.toMatchObject({ status: 409 });
  });
});

describe('expireLapsedDocuments', () => {
  it('removes the badge an expired insurance or COSHH certificate backed, and tells the cleaner', async () => {
    const ins = { _id: 'a', cleaner: 'cp1', type: 'insurance', status: 'approved', save: jest.fn() };
    const cos = { _id: 'b', cleaner: 'cp2', type: 'coshh', status: 'approved', save: jest.fn() };
    CleanerDocument.find.mockResolvedValue([ins, cos]);
    const p1 = { insuranceStatus: 'own', save: jest.fn() };
    const p2 = { coshhTrained: true, save: jest.fn() };
    CleanerProfile.findById.mockImplementation(async (id) => (id === 'cp1' ? p1 : p2));

    expect(await svc.expireLapsedDocuments(new Date())).toBe(2);

    expect(ins.status).toBe('expired');
    expect(p1.insuranceStatus).toBe('none');
    expect(p2.coshhTrained).toBe(false);
    expect(notifications.complianceDocumentExpired).toHaveBeenCalledTimes(2);
  });

  it('leaves insurance the platform provides alone', async () => {
    CleanerDocument.find.mockResolvedValue([{ _id: 'a', cleaner: 'cp1', type: 'insurance', status: 'approved', save: jest.fn() }]);
    const p = { insuranceStatus: 'platform', save: jest.fn() };
    CleanerProfile.findById.mockResolvedValue(p);
    await svc.expireLapsedDocuments(new Date());
    expect(p.insuranceStatus).toBe('platform');
  });
});
