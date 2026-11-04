jest.mock('../../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/DataRequest', () => ({ find: jest.fn(), findOne: jest.fn(), create: jest.fn(), findById: jest.fn(), updateMany: jest.fn() }));
jest.mock('../../src/services/audit.service', () => ({ record: jest.fn() }));
jest.mock('../../src/services/notification.service', () => ({
  passwordChanged: jest.fn(),
  dataRequestReceived: jest.fn(),
  dataRequestClosed: jest.fn(),
}));

const bcrypt = require('bcryptjs');
const User = require('../../src/models/User');
const DataRequest = require('../../src/models/DataRequest');
const audit = require('../../src/services/audit.service');
const notify = require('../../src/services/notification.service');
const account = require('../../src/services/account.service');
const dataRequestService = require('../../src/services/data-request.service');

const person = (extra = {}) => ({
  _id: 'u1', name: 'Pat', email: 'pat@example.com', role: 'customer', tokenVersion: 1,
  passwordHash: bcrypt.hashSync('old-password', 4), save: jest.fn(), ...extra,
});

beforeEach(() => jest.clearAllMocks());

describe('changePassword', () => {
  it('a wrong current password is a 400 (a 401 would sign the person out) and changes nothing', async () => {
    const user = person();
    User.findById.mockResolvedValue(user);
    await expect(account.changePassword('u1', { currentPassword: 'nope', newPassword: 'brand-new-pass' })).rejects.toMatchObject({ status: 400 });
    expect(user.save).not.toHaveBeenCalled();
    expect(notify.passwordChanged).not.toHaveBeenCalled();
  });

  it('refuses the same password again', async () => {
    User.findById.mockResolvedValue(person());
    await expect(account.changePassword('u1', { currentPassword: 'old-password', newPassword: 'old-password' })).rejects.toMatchObject({ status: 400 });
  });

  it('saves a new hash, signs other devices out, tells the person and returns a fresh session', async () => {
    const user = person();
    User.findById.mockResolvedValue(user);
    const out = await account.changePassword('u1', { currentPassword: 'old-password', newPassword: 'brand-new-pass' });
    expect(await bcrypt.compare('brand-new-pass', user.passwordHash)).toBe(true);
    expect(user.tokenVersion).toBe(2);
    expect(user.save).toHaveBeenCalled();
    expect(notify.passwordChanged).toHaveBeenCalledWith(user);
    expect(typeof out.token).toBe('string');
    expect(JSON.stringify(out)).not.toMatch(/passwordHash|HASH/i);
  });

  it('is for customers and cleaners that are not erased', async () => {
    User.findById.mockResolvedValue(person({ role: 'admin' }));
    await expect(account.changePassword('u1', { currentPassword: 'old-password', newPassword: 'brand-new-pass' })).rejects.toMatchObject({ status: 404 });
    User.findById.mockResolvedValue(person({ erasedAt: new Date() }));
    await expect(account.changePassword('u1', { currentPassword: 'old-password', newPassword: 'brand-new-pass' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('createDataRequest', () => {
  it('records a copy request due in a month and tells the person and us', async () => {
    User.findById.mockResolvedValue(person());
    DataRequest.findOne.mockResolvedValue(null);
    DataRequest.create.mockImplementation(async (d) => ({ _id: 'r1', status: 'pending', createdAt: new Date(), ...d }));
    const out = await account.createDataRequest('u1', { type: 'export', note: 'for my records' });
    expect(out).toMatchObject({ type: 'export', status: 'pending', alreadyOpen: false });
    const due = DataRequest.create.mock.calls[0][0].dueAt;
    expect(due.getTime()).toBeGreaterThan(Date.now() + 27 * 86400000);
    expect(notify.dataRequestReceived).toHaveBeenCalled();
  });

  it('deleting needs the password, and nothing is recorded without it', async () => {
    User.findById.mockResolvedValue(person());
    await expect(account.createDataRequest('u1', { type: 'erase' })).rejects.toMatchObject({ status: 400 });
    await expect(account.createDataRequest('u1', { type: 'erase', currentPassword: 'wrong' })).rejects.toMatchObject({ status: 400 });
    expect(DataRequest.create).not.toHaveBeenCalled();
  });

  it('does not make a second open request of the same kind', async () => {
    User.findById.mockResolvedValue(person());
    DataRequest.findOne.mockResolvedValue({ _id: 'r0', type: 'export', status: 'pending' });
    const out = await account.createDataRequest('u1', { type: 'export' });
    expect(out.alreadyOpen).toBe(true);
    expect(DataRequest.create).not.toHaveBeenCalled();
    expect(notify.dataRequestReceived).not.toHaveBeenCalled();
  });

  it('records an erase request once the password is right', async () => {
    User.findById.mockResolvedValue(person());
    DataRequest.findOne.mockResolvedValue(null);
    DataRequest.create.mockImplementation(async (d) => ({ _id: 'r2', status: 'pending', ...d }));
    const out = await account.createDataRequest('u1', { type: 'erase', currentPassword: 'old-password' });
    expect(out.type).toBe('erase');
    expect(JSON.stringify(DataRequest.create.mock.calls[0][0])).not.toContain('old-password');
  });
});

describe('admin side', () => {
  const pending = (extra = {}) => ({ _id: 'r1', user: 'u1', type: 'export', status: 'pending', save: jest.fn(), ...extra });

  it('declining needs a reason, closing twice is refused', async () => {
    DataRequest.findById.mockResolvedValue(pending());
    await expect(dataRequestService.close('r1', { outcome: 'declined' }, { user: { id: 'a' } })).rejects.toMatchObject({ status: 400 });
    DataRequest.findById.mockResolvedValue(pending({ status: 'done' }));
    await expect(dataRequestService.close('r1', { outcome: 'done' }, { user: { id: 'a' } })).rejects.toMatchObject({ status: 409 });
    DataRequest.findById.mockResolvedValue(null);
    await expect(dataRequestService.close('r1', { outcome: 'done' }, { user: { id: 'a' } })).rejects.toMatchObject({ status: 404 });
  });

  it('closing is recorded in the audit log, kept 6 years, and the person is told', async () => {
    const r = pending();
    DataRequest.findById.mockResolvedValue(r);
    User.findById.mockResolvedValue(person());
    await dataRequestService.close('r1', { outcome: 'declined', reason: 'Could not confirm identity' }, { user: { id: 'a' } });
    expect(r.status).toBe('declined');
    expect(r.save).toHaveBeenCalled();
    expect(r.expireAt.getFullYear()).toBe(new Date().getFullYear() + 6);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.request_closed' }));
    expect(notify.dataRequestClosed).toHaveBeenCalled();
  });

  it('does not email someone whose account has been erased', async () => {
    DataRequest.findById.mockResolvedValue(pending());
    User.findById.mockResolvedValue(person({ erasedAt: new Date() }));
    await dataRequestService.close('r1', { outcome: 'done' }, { user: { id: 'a' } });
    expect(notify.dataRequestClosed).not.toHaveBeenCalled();
  });

  it('erasure completes open erase requests and removes the free text people wrote', async () => {
    await dataRequestService.afterErasure('u1', { user: { id: 'a' } });
    const [first, second] = DataRequest.updateMany.mock.calls;
    expect(first[0]).toEqual({ user: 'u1', type: 'erase', status: 'pending' });
    expect(first[1].$set.status).toBe('done');
    expect(second[0]).toEqual({ user: 'u1' });
    expect(second[1]).toEqual({ $unset: { note: 1 } });
  });
});
