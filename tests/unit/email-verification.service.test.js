jest.mock('../../src/models/User', () => ({ findOne: jest.fn(), findById: jest.fn() }));
jest.mock('../../src/services/notification.service', () => ({ emailVerification: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../src/services/email.service', () => ({ isConfigured: jest.fn() }));

const crypto = require('crypto');
const User = require('../../src/models/User');
const notifications = require('../../src/services/notification.service');
const emailService = require('../../src/services/email.service');
const svc = require('../../src/services/email-verification.service');

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const person = (extra = {}) => ({ _id: 'u1', role: 'customer', email: 'a@example.com', save: jest.fn().mockResolvedValue(undefined), ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  emailService.isConfigured.mockReturnValue(true);
});

describe('isBlocked', () => {
  it('blocks a new customer or cleaner who has not confirmed', () => {
    expect(svc.isBlocked(person({ emailVerification: { required: true } }))).toBe(true);
    expect(svc.isBlocked(person({ role: 'cleaner', emailVerification: { required: true } }))).toBe(true);
  });

  it.each([
    ['has confirmed', { emailVerification: { required: true, verifiedAt: new Date() } }],
    ['is an older account (never required)', {}],
    ['is an older account that has not confirmed', { emailVerification: {} }],
    ['is staff', { role: 'admin', emailVerification: { required: true } }],
  ])('does not block someone who %s', (_name, extra) => {
    expect(svc.isBlocked(person(extra))).toBe(false);
  });

  it('blocks nobody when the server cannot send email, because nobody could receive the link', () => {
    emailService.isConfigured.mockReturnValue(false);
    expect(svc.isBlocked(person({ emailVerification: { required: true } }))).toBe(false);
  });

  it('copes with no user', () => {
    expect(svc.isBlocked(null)).toBe(false);
    expect(svc.isBlocked(undefined)).toBe(false);
  });
});

describe('startFor', () => {
  it('marks a new customer as needing to confirm, keeps only a hash of the link, and emails the link', async () => {
    const user = person();
    await svc.startFor(user);
    expect(user.emailVerification.required).toBe(true);
    expect(user.emailVerification.expiresAt.getTime()).toBeGreaterThan(Date.now() + 47 * 3600 * 1000);
    const [, token] = notifications.emailVerification.mock.calls[0];
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(user.emailVerification.tokenHash).toBe(sha(token));
    expect(JSON.stringify(user.emailVerification)).not.toContain(token);
    expect(user.save).toHaveBeenCalled();
  });

  it('does nothing for staff', async () => {
    const user = person({ role: 'admin' });
    await svc.startFor(user);
    expect(user.emailVerification).toBeUndefined();
    expect(notifications.emailVerification).not.toHaveBeenCalled();
  });
});

describe('verify', () => {
  it('confirms the address once, and forgets the link', async () => {
    const user = person({ emailVerification: { required: true, tokenHash: sha('tok'), expiresAt: new Date(Date.now() + 1000) } });
    User.findOne.mockResolvedValue(user);
    await expect(svc.verify('tok')).resolves.toEqual({ verified: true });
    expect(User.findOne).toHaveBeenCalledWith({
      'emailVerification.tokenHash': sha('tok'),
      'emailVerification.expiresAt': { $gt: expect.any(Date) },
    });
    expect(user.emailVerification.verifiedAt).toBeInstanceOf(Date);
    expect(user.emailVerification.tokenHash).toBeUndefined();
    expect(user.emailVerification.expiresAt).toBeUndefined();
    expect(user.save).toHaveBeenCalled();
  });

  it('rejects an unknown or expired link', async () => {
    User.findOne.mockResolvedValue(null);
    await expect(svc.verify('nope')).rejects.toMatchObject({ status: 400 });
  });
});

describe('resend', () => {
  it('sends a new link and replaces the old one', async () => {
    const user = person({ emailVerification: { required: true, tokenHash: 'old', sentAt: new Date(Date.now() - 5 * 60 * 1000) } });
    User.findById.mockResolvedValue(user);
    await expect(svc.resend('u1')).resolves.toEqual({ sent: true });
    expect(user.emailVerification.tokenHash).not.toBe('old');
    expect(user.emailVerification.required).toBe(true);
    expect(notifications.emailVerification).toHaveBeenCalledTimes(1);
  });

  it('makes them wait a minute between links', async () => {
    User.findById.mockResolvedValue(person({ emailVerification: { required: true, sentAt: new Date() } }));
    await expect(svc.resend('u1')).rejects.toMatchObject({ status: 429 });
    expect(notifications.emailVerification).not.toHaveBeenCalled();
  });

  it('sends nothing to someone who has already confirmed, and refuses staff', async () => {
    User.findById.mockResolvedValue(person({ emailVerification: { verifiedAt: new Date() } }));
    await expect(svc.resend('u1')).resolves.toEqual({ sent: false, verified: true });
    User.findById.mockResolvedValue(person({ role: 'admin' }));
    await expect(svc.resend('u1')).rejects.toMatchObject({ status: 404 });
    expect(notifications.emailVerification).not.toHaveBeenCalled();
  });
});

describe('status and password reset', () => {
  it('reports whether they have confirmed, whether they are blocked, and whether email can be sent', async () => {
    User.findById.mockResolvedValue(person({ emailVerification: { required: true } }));
    await expect(svc.status('u1')).resolves.toEqual({ verified: false, blocked: true, canSend: true });
    emailService.isConfigured.mockReturnValue(false);
    await expect(svc.status('u1')).resolves.toEqual({ verified: false, blocked: false, canSend: false });
  });

  it('a password reset link reaching the inbox confirms the address, without losing other fields', () => {
    const user = person({ emailVerification: { required: true, sentAt: new Date('2026-11-01') } });
    svc.markVerifiedByEmailProof(user);
    expect(user.emailVerification.verifiedAt).toBeInstanceOf(Date);
    expect(user.emailVerification.required).toBe(true);
    const staff = person({ role: 'admin' });
    svc.markVerifiedByEmailProof(staff);
    expect(staff.emailVerification).toBeUndefined();
  });
});
