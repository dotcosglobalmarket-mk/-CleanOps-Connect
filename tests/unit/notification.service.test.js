jest.mock('../../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/CleanerProfile', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/ServiceType', () => ({ findById: jest.fn() }));
jest.mock('../../src/services/email.service', () => ({ send: jest.fn().mockResolvedValue({ id: 'e1' }) }));

const User = require('../../src/models/User');
const CleanerProfile = require('../../src/models/CleanerProfile');
const emailService = require('../../src/services/email.service');
const notifications = require('../../src/services/notification.service');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FRONTEND_URL = 'https://www.cleanop-connect.co.uk';
});

describe('notification.service', () => {
  it('tells the customer to pay once a cleaner accepts, with a link to the job', async () => {
    User.findById.mockResolvedValue({ email: 'rita@example.com' });

    await notifications.jobBooked({ _id: 'job1', customer: 'cust1', pricePence: 7500, serviceType: { name: 'Deep clean' } });

    expect(emailService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'rita@example.com',
        subject: 'A cleaner has accepted your job — pay to confirm',
        action: { label: 'Pay and confirm', url: 'https://www.cleanop-connect.co.uk/customer.html?job=job1' },
      })
    );
    expect(emailService.send.mock.calls[0][0].paragraphs[0]).toContain('£75.00');
  });

  it('emails each offered cleaner with the outward postcode only', async () => {
    CleanerProfile.findById.mockImplementation((id) => Promise.resolve({ _id: id, user: `user-${id}` }));
    User.findById.mockImplementation((id) => Promise.resolve({ email: `${id}@example.com` }));

    await notifications.offersSent(
      { _id: 'job1', postcode: 'LS12 1AB', budgetMin: 50, budgetMax: 90, serviceType: { name: 'Deep clean' } },
      [{ cleaner: 'c1' }, { cleaner: 'c2' }]
    );

    expect(emailService.send).toHaveBeenCalledTimes(2);
    const sent = emailService.send.mock.calls.map(([args]) => args);
    expect(sent.map((e) => e.to).sort()).toEqual(['user-c1@example.com', 'user-c2@example.com']);
    sent.forEach((e) => {
      expect(e.subject).toContain('LS12');
      expect(JSON.stringify(e)).not.toContain('1AB');
    });
  });

  it('never rejects, even when a lookup fails', async () => {
    User.findById.mockRejectedValue(new Error('db down'));
    await expect(notifications.jobCompleted({ _id: 'job1', customer: 'cust1' })).resolves.toBeUndefined();
  });
});
