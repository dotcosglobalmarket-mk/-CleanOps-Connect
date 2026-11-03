jest.mock('../../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/CleanerProfile', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/ServiceType', () => ({ findById: jest.fn() }));
jest.mock('../../src/services/email.service', () => ({ send: jest.fn().mockResolvedValue({ id: 'e1' }) }));
jest.mock('../../src/services/sms.service', () => ({ send: jest.fn().mockResolvedValue({ id: 's1' }) }));

const User = require('../../src/models/User');
const CleanerProfile = require('../../src/models/CleanerProfile');
const smsService = require('../../src/services/sms.service');
const emailService = require('../../src/services/email.service');
const notifications = require('../../src/services/notification.service');

const on = (mobile) => ({ email: 'x@example.com', smsAlerts: { enabled: true, mobile } });
const off = { email: 'x@example.com' };
const job = { _id: 'job1', customer: 'cust1', cleaner: 'c1', postcode: 'LS12 1AB', pricePence: 7500, budgetMin: 50, budgetMax: 90, serviceType: { name: 'Deep clean' } };

beforeEach(() => {
  jest.clearAllMocks();
  CleanerProfile.findById.mockImplementation((id) => Promise.resolve({ _id: id, user: `user-${id}` }));
});

describe('text alerts from notifications', () => {
  it('texts only the offered cleaners who turned alerts on', async () => {
    User.findById.mockImplementation((id) => Promise.resolve(id === 'user-c1' ? on('+447111111111') : off));
    await notifications.offersSent(job, [{ cleaner: 'c1' }, { cleaner: 'c2' }]);
    expect(smsService.send).toHaveBeenCalledTimes(1);
    expect(smsService.send).toHaveBeenCalledWith(expect.objectContaining({ to: '+447111111111' }));
  });

  it('texts nobody when alerts are off, even if a number is still stored', async () => {
    User.findById.mockResolvedValue({ email: 'x@example.com', smsAlerts: { enabled: false, mobile: '+447111111111' } });
    await notifications.offersSent(job, [{ cleaner: 'c1' }]);
    await notifications.jobBooked(job);
    await notifications.paymentReceived(job);
    expect(smsService.send).not.toHaveBeenCalled();
  });

  it('texts the customer when a cleaner accepts, and the cleaner when payment is secured', async () => {
    User.findById.mockImplementation((id) => Promise.resolve(id === 'cust1' ? on('+447222222222') : on('+447333333333')));
    await notifications.jobBooked(job);
    await notifications.paymentReceived(job);
    expect(smsService.send.mock.calls.map(([a]) => a.to)).toEqual(['+447222222222', '+447333333333']);
  });

  it('texts invited cleaners for a tender', async () => {
    User.findById.mockResolvedValue(on('+447444444444'));
    await notifications.tenderInvited({ ...job, tender: {} }, [{ cleaner: 'c1' }]);
    expect(smsService.send).toHaveBeenCalledTimes(1);
  });

  it('keeps every text short and free of names, places and prices', async () => {
    User.findById.mockResolvedValue(on('+447555555555'));
    await notifications.offersSent(job, [{ cleaner: 'c1' }]);
    await notifications.tenderInvited({ ...job, tender: {} }, [{ cleaner: 'c1' }]);
    await notifications.jobBooked(job);
    await notifications.paymentReceived(job);
    expect(smsService.send).toHaveBeenCalledTimes(4);
    smsService.send.mock.calls.forEach(([{ body }]) => {
      expect(body.length).toBeLessThanOrEqual(160);
      expect(body).not.toMatch(/LS12|1AB|£|Deep clean|75|50/);
      expect(body).toContain('Turn texts off');
      expect(/^[\x20-\x7E]+$/.test(body)).toBe(true);
    });
  });

  it('still emails when the text cannot be sent', async () => {
    smsService.send.mockRejectedValueOnce(new Error('twilio down'));
    User.findById.mockResolvedValue(on('+447666666666'));
    await notifications.jobBooked(job);
    expect(smsService.send).toHaveBeenCalledTimes(1);
    expect(emailService.send).toHaveBeenCalledTimes(1);
  });

  it('still emails when the lookup for the text fails', async () => {
    User.findById.mockRejectedValueOnce(new Error('db down')).mockResolvedValue({ email: 'x@example.com' });
    await notifications.jobBooked(job);
    expect(smsService.send).not.toHaveBeenCalled();
    expect(emailService.send).toHaveBeenCalledTimes(1);
  });
});
