const mockChain = (rows) => {
  const chain = { select: () => chain, populate: () => chain, sort: () => chain, limit: () => chain, lean: async () => rows };
  return chain;
};
jest.mock('../../src/models/User', () => ({ findById: jest.fn(), findOne: jest.fn() }));
jest.mock('../../src/models/CleanerProfile', () => ({ findOne: jest.fn(), updateOne: jest.fn() }));
jest.mock('../../src/models/CleanerDocument', () => ({ find: jest.fn(), updateMany: jest.fn() }));
jest.mock('../../src/models/DocumentFile', () => ({ deleteMany: jest.fn() }));
jest.mock('../../src/models/Job', () => ({ find: jest.fn(), countDocuments: jest.fn(), updateOne: jest.fn(), updateMany: jest.fn() }));
jest.mock('../../src/models/JobOffer', () => ({ find: jest.fn(), updateMany: jest.fn() }));
jest.mock('../../src/models/JobNote', () => ({ find: jest.fn() }));
jest.mock('../../src/models/JobPhoto', () => ({ find: jest.fn(), deleteMany: jest.fn() }));
jest.mock('../../src/models/Message', () => ({ find: jest.fn(), deleteMany: jest.fn() }));
jest.mock('../../src/models/Review', () => ({ find: jest.fn(), updateMany: jest.fn() }));
jest.mock('../../src/models/Series', () => ({ find: jest.fn(), countDocuments: jest.fn(), updateMany: jest.fn() }));
jest.mock('../../src/models/Subscription', () => ({ exists: jest.fn(), find: jest.fn() }));
jest.mock('../../src/models/SubscriptionPayment', () => ({ find: jest.fn() }));
jest.mock('../../src/models/AuditLog', () => ({ find: jest.fn() }));
jest.mock('../../src/services/stripe.service', () => ({ deleteCustomer: jest.fn() }));
jest.mock('../../src/services/audit.service', () => ({ record: jest.fn() }));

const User = require('../../src/models/User');
const CleanerProfile = require('../../src/models/CleanerProfile');
const CleanerDocument = require('../../src/models/CleanerDocument');
const DocumentFile = require('../../src/models/DocumentFile');
const Job = require('../../src/models/Job');
const JobOffer = require('../../src/models/JobOffer');
const JobNote = require('../../src/models/JobNote');
const JobPhoto = require('../../src/models/JobPhoto');
const Message = require('../../src/models/Message');
const Review = require('../../src/models/Review');
const Series = require('../../src/models/Series');
const Subscription = require('../../src/models/Subscription');
const SubscriptionPayment = require('../../src/models/SubscriptionPayment');
const AuditLog = require('../../src/models/AuditLog');
const stripeService = require('../../src/services/stripe.service');
const audit = require('../../src/services/audit.service');
const svc = require('../../src/services/privacy-request.service');

const req = { user: { id: 'admin1', role: 'admin' }, ip: '1.1.1.1' };
const customer = (extra = {}) => ({
  _id: 'u1', name: 'Pat Customer', email: 'pat@example.com', role: 'customer', phone: '07700900123', passwordHash: 'HASH-SECRET',
  stripeCustomerId: 'cus_1', savedCard: { paymentMethodId: 'pm_1', brand: 'visa', last4: '4242' },
  resetPasswordTokenHash: 'RESET-SECRET', twoFactor: { secretEnc: 'TOTP-SECRET' }, tokenVersion: 1, createdAt: new Date('2026-01-01'),
  save: jest.fn(), ...extra,
});
const cleanerUser = (extra = {}) => customer({ _id: 'u2', name: 'Sam Cleaner', email: 'sam@example.com', role: 'cleaner', stripeCustomerId: undefined, savedCard: undefined, ...extra });
const profile = (extra = {}) => ({
  _id: 'cp1', user: 'u2', name: 'Sam Cleaner', stripeCustomerId: 'cus_2', photo: { file: 'avatarFile' },
  toObject() { const { toObject, ...rest } = this; return rest; }, ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  Job.find.mockReturnValue(mockChain([]));
  Job.countDocuments.mockResolvedValue(0);
  Series.countDocuments.mockResolvedValue(0);
  Series.find.mockReturnValue(mockChain([]));
  Subscription.exists.mockResolvedValue(null);
  JobOffer.find.mockReturnValue(mockChain([]));
  JobNote.find.mockReturnValue(mockChain([]));
  JobPhoto.find.mockReturnValue(mockChain([]));
  Message.find.mockReturnValue(mockChain([]));
  Message.deleteMany.mockResolvedValue({ deletedCount: 3 });
  Review.find.mockReturnValue(mockChain([]));
  Subscription.find.mockReturnValue(mockChain([]));
  SubscriptionPayment.find.mockReturnValue(mockChain([]));
  CleanerDocument.find.mockReturnValue(mockChain([]));
  AuditLog.find.mockReturnValue(mockChain([]));
  CleanerProfile.findOne.mockResolvedValue(null);
});

describe('lookup', () => {
  it('finds a person by email, whatever the capitals, and says what stops erasure', async () => {
    User.findOne.mockResolvedValue(customer());
    Job.countDocuments.mockResolvedValue(4);
    Job.find.mockReturnValue(mockChain([{ paymentStatus: 'PAID_HELD' }, { paymentStatus: 'DISPUTED' }]));
    Series.countDocuments.mockResolvedValue(1);

    const out = await svc.lookup('  Pat@Example.com ');

    expect(User.findOne).toHaveBeenCalledWith({ email: 'pat@example.com' });
    expect(out).toMatchObject({ id: 'u1', role: 'customer', jobs: 4, erasedAt: null });
    expect(out.blockers).toHaveLength(2);
    expect(out.blockers[0]).toMatch(/2 bookings still in progress.*PAID_HELD, DISPUTED/);
    expect(out.blockers[1]).toMatch(/regular booking is still running/);
    expect(JSON.stringify(out)).not.toMatch(/HASH-SECRET|TOTP-SECRET|RESET-SECRET/);
  });

  it('reports a cleaner\'s active subscription as a blocker', async () => {
    User.findOne.mockResolvedValue(cleanerUser());
    CleanerProfile.findOne.mockResolvedValue(profile());
    Subscription.exists.mockResolvedValue({ _id: 's1' });
    expect((await svc.lookup('sam@example.com')).blockers.join(' ')).toMatch(/active subscription/);
  });

  it('refuses staff and unknown addresses', async () => {
    User.findOne.mockResolvedValue(null);
    await expect(svc.lookup('nobody@example.com')).rejects.toMatchObject({ status: 404 });
    User.findOne.mockResolvedValue(customer({ role: 'operator' }));
    await expect(svc.lookup('ops@example.com')).rejects.toMatchObject({ status: 400 });
  });

  it('a cleaner with no saved profile owns nothing: the search must not match every unassigned job', async () => {
    User.findOne.mockResolvedValue(cleanerUser());
    await svc.lookup('sam@example.com');
    const filters = [...Job.find.mock.calls, ...Job.countDocuments.mock.calls].map((c) => c[0]);
    filters.forEach((f) => {
      expect(f).not.toHaveProperty('cleaner');
      expect(f._id).toEqual({ $in: [] });
    });
  });
});

describe('exportData', () => {
  it('copies their data without secrets, and keeps other people\'s details out of a cleaner\'s copy', async () => {
    User.findById.mockResolvedValue(cleanerUser());
    CleanerProfile.findOne.mockResolvedValue(profile({ bio: 'I clean', phoneNumber: '07700900999' }));
    Job.find.mockReturnValue(mockChain([{ _id: 'j1', postcode: 'LS12 1AB', pricePence: 5000 }]));
    Message.find.mockReturnValue(mockChain([{ job: 'j1', body: 'See you at 9' }]));
    JobNote.find.mockReturnValue(mockChain([{ job: 'j1', body: 'Rang to check' }]));

    const copy = await svc.exportData('u2');
    const text = JSON.stringify(copy);

    expect(copy.account).toMatchObject({ name: 'Sam Cleaner', email: 'sam@example.com', role: 'cleaner' });
    expect(copy.cleanerProfile).toMatchObject({ bio: 'I clean', phoneNumber: '07700900999', hasProfilePicture: true });
    expect(copy.jobs[0].postcode).toBe('LS12');
    expect(copy.messagesSent).toHaveLength(1);
    expect(copy.staffNotesOnYourBookings.notes).toHaveLength(1);
    expect(copy.staffNotesOnYourBookings.reviewBeforeSending).toBeTruthy();
    expect(text).not.toMatch(/HASH-SECRET|TOTP-SECRET|RESET-SECRET|avatarFile/);
  });

  it('gives a customer their own full job details and saved card summary, still without secrets', async () => {
    User.findById.mockResolvedValue(customer());
    Job.find.mockReturnValue(mockChain([{ _id: 'j1', postcode: 'LS12 1AB', description: 'Two bed flat' }]));
    const copy = await svc.exportData('u1');
    expect(copy.jobs[0]).toMatchObject({ postcode: 'LS12 1AB', description: 'Two bed flat' });
    expect(copy.account.savedCard).toEqual({ brand: 'visa', last4: '4242', expMonth: undefined, expYear: undefined, consentAt: undefined, consentVersion: undefined });
    expect(JSON.stringify(copy)).not.toMatch(/HASH-SECRET|TOTP-SECRET|RESET-SECRET|pm_1|cus_1/);
  });

  it('includes the person\'s own text alert number and agreement, and omits the section when they never used it', async () => {
    User.findById.mockResolvedValue(customer({ smsAlerts: { enabled: true, mobile: '+447123456789', consentAt: new Date('2026-11-03'), consentVersion: 'sms-2026-11' } }));
    const copy = await svc.exportData('u1');
    expect(copy.account.textAlerts).toMatchObject({ enabled: true, mobile: '+447123456789', consentVersion: 'sms-2026-11' });

    User.findById.mockResolvedValue(customer());
    expect((await svc.exportData('u1')).account.textAlerts).toBeUndefined();
  });

  it('refuses staff', async () => {
    User.findById.mockResolvedValue(customer({ role: 'admin' }));
    await expect(svc.exportData('u1')).rejects.toMatchObject({ status: 400 });
  });
});

describe('erase', () => {
  const ask = (over = {}) => ({ confirmEmail: 'pat@example.com', reason: 'Asked by email on 2 Nov', ...over });

  it('does nothing at all when it is refused', async () => {
    User.findById.mockResolvedValue(customer());
    await expect(svc.erase('u1', ask({ confirmEmail: 'someone@else.com' }), req)).rejects.toMatchObject({ status: 400 });
    await expect(svc.erase('u1', ask({ reason: ' ' }), req)).rejects.toMatchObject({ status: 400 });
    Job.find.mockReturnValue(mockChain([{ paymentStatus: 'AWAITING_CONFIRMATION' }]));
    await expect(svc.erase('u1', ask(), req)).rejects.toMatchObject({ status: 409 });
    User.findById.mockResolvedValue(customer({ erasedAt: new Date() }));
    await expect(svc.erase('u1', ask(), req)).rejects.toMatchObject({ status: 409 });
    User.findById.mockResolvedValue(customer({ role: 'operator' }));
    await expect(svc.erase('u1', ask(), req)).rejects.toMatchObject({ status: 400 });

    [stripeService.deleteCustomer, DocumentFile.deleteMany, Message.deleteMany, Job.updateOne, Job.updateMany, audit.record].forEach((fn) =>
      expect(fn).not.toHaveBeenCalled()
    );
  });

  it('erases a customer: Stripe first, address detail and words removed, account anonymised and signed out', async () => {
    const user = customer();
    User.findById.mockResolvedValue(user);
    Job.find
      .mockReturnValueOnce(mockChain([])) // blockers: nothing in flight
      .mockReturnValueOnce(mockChain([{ _id: 'j1', postcode: 'LS12 1AB' }, { _id: 'j2', postcode: 'M1 1AA' }])) // their jobs
      .mockReturnValueOnce(mockChain([{ _id: 'j2' }])); // not yet booked
    JobPhoto.find.mockReturnValue(mockChain([{ file: 'pf1' }, { file: 'pf2' }]));

    const out = await svc.erase('u1', ask(), req);

    expect(stripeService.deleteCustomer).toHaveBeenCalledWith('cus_1');
    expect(stripeService.deleteCustomer.mock.invocationCallOrder[0]).toBeLessThan(Job.updateOne.mock.invocationCallOrder[0]);
    expect(DocumentFile.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['pf1', 'pf2'] } });
    expect(JobPhoto.deleteMany).toHaveBeenCalledWith({ uploadedBy: 'u1' });
    expect(Message.deleteMany).toHaveBeenCalledWith({ sender: 'u1' });
    expect(Job.updateOne).toHaveBeenCalledWith(
      { _id: 'j1' },
      expect.objectContaining({ $set: expect.objectContaining({ postcode: 'LS12' }), $unset: expect.objectContaining({ lat: 1, lng: 1, disputeDetail: 1 }) })
    );
    expect(Job.updateMany).toHaveBeenCalledWith({ _id: { $in: ['j2'] } }, { $set: { status: 'cancelled' } });
    expect(JobOffer.updateMany).toHaveBeenCalledWith({ job: { $in: ['j2'] }, status: { $in: ['sent', 'quoted'] } }, { $set: { status: 'expired' } });
    expect(Review.updateMany).toHaveBeenCalledWith({ customer: 'u1' }, { $unset: { comment: 1 } });

    expect(user.name).toBe('Deleted user');
    expect(user.email).toBe('erased-u1@erased.invalid');
    expect(user.phone).toBeUndefined();
    expect(user.savedCard).toBeUndefined();
    expect(user.stripeCustomerId).toBeUndefined();
    expect(user.passwordHash).not.toBe('HASH-SECRET');
    expect(user.active).toBe(false);
    expect(user.tokenVersion).toBe(2);
    expect(user.erasedAt).toBeInstanceOf(Date);
    expect(user.save).toHaveBeenCalled();
    expect(out).toMatchObject({ erased: true, counts: { stripeCustomers: 1, messages: 3, files: 2, jobs: 2 } });
  });

  it('shows when the email address was confirmed in the export, and erasure clears the confirmation record', async () => {
    const when = new Date('2026-11-03');
    User.findById.mockResolvedValue(customer({ emailVerification: { required: true, verifiedAt: when, tokenHash: 'SECRET-HASH' } }));
    const copy = await svc.exportData('u1');
    expect(copy.account.emailConfirmedAt).toEqual(when);
    expect(JSON.stringify(copy)).not.toContain('SECRET-HASH');

    const user = customer({ emailVerification: { required: true, tokenHash: 'SECRET-HASH' } });
    User.findById.mockResolvedValue(user);
    await svc.erase('u1', ask(), req);
    expect(user.emailVerification).toBeUndefined();
  });

  it('erasing an account also deletes the stored text alert number', async () => {
    const user = customer({ smsAlerts: { enabled: true, mobile: '+447123456789', consentAt: new Date(), consentVersion: 'sms-2026-11' } });
    User.findById.mockResolvedValue(user);
    await svc.erase('u1', ask(), req);
    expect(user.smsAlerts).toBeUndefined();
  });

  it('erases a cleaner: pictures and certificate files deleted, profile blanked and taken off the marketplace', async () => {
    const user = cleanerUser();
    User.findById.mockResolvedValue(user);
    CleanerProfile.findOne.mockResolvedValue(profile());
    CleanerDocument.find.mockReturnValue(mockChain([{ file: 'docFile1' }, { file: 'docFile2' }]));

    await svc.erase('u2', { confirmEmail: 'sam@example.com', reason: 'Asked by post' }, req);

    expect(stripeService.deleteCustomer).toHaveBeenCalledWith('cus_2');
    expect(DocumentFile.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['avatarFile', 'docFile1', 'docFile2'] } });
    expect(CleanerDocument.updateMany).toHaveBeenCalledWith(
      { cleaner: 'cp1' },
      expect.objectContaining({ $unset: expect.objectContaining({ file: 1, rejectionReason: 1 }) })
    );
    const [, update] = CleanerProfile.updateOne.mock.calls[0];
    expect(update.$set).toMatchObject({ name: 'Deleted user', available: false, deactivationStatus: 'suspended', dbsVerified: false, payoutsEnabled: false });
    ['bio', 'phoneNumber', 'contactEmail', 'website', 'instagram', 'lat', 'lng', 'photo', 'companyName'].forEach((k) => expect(update.$unset).toHaveProperty(k));
    expect(JobOffer.updateMany).toHaveBeenCalledWith({ cleaner: 'cp1', status: { $in: ['sent', 'quoted'] } }, { $set: { status: 'expired' } });
    expect(Job.updateOne).not.toHaveBeenCalled(); // a cleaner's jobs belong to their customers
    expect(user.erasedAt).toBeInstanceOf(Date);
  });

  it('stops before changing anything if Stripe refuses, so the request can be tried again', async () => {
    const user = customer();
    User.findById.mockResolvedValue(user);
    stripeService.deleteCustomer.mockRejectedValueOnce(new Error('stripe down'));
    await expect(svc.erase('u1', ask(), req)).rejects.toThrow('stripe down');
    expect(user.save).not.toHaveBeenCalled();
    expect(Job.updateOne).not.toHaveBeenCalled();
    expect(Message.deleteMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('records the erasure without the person\'s email, name or the typed reason in full detail of their data', async () => {
    User.findById.mockResolvedValue(customer());
    await svc.erase('u1', ask(), req);
    const entry = audit.record.mock.calls[0][0];
    expect(entry).toMatchObject({ action: 'user.erase', targetType: 'user', targetId: 'u1' });
    expect(entry.reason).toMatch(/identity checked/);
    expect(JSON.stringify(entry)).not.toMatch(/pat@example.com|Pat Customer|07700900123/);
  });
});

describe('outwardCode', () => {
  it('keeps the area, not the address', () => {
    expect(svc.outwardCode('LS12 1AB')).toBe('LS12');
    expect(svc.outwardCode('m11aa')).toBe('M1');
    expect(svc.outwardCode(undefined)).toBeUndefined();
  });
});
