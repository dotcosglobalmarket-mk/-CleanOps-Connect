jest.mock('../../src/models/Job', () => ({ findById: jest.fn(), find: jest.fn() }));
jest.mock('../../src/models/CleanerProfile', () => ({ findOne: jest.fn() }));
jest.mock('../../src/models/Message', () => ({
  create: jest.fn(),
  find: jest.fn(),
  exists: jest.fn(),
  updateMany: jest.fn(),
  aggregate: jest.fn(),
}));
jest.mock('../../src/services/notification.service', () => ({ newMessage: jest.fn() }));

const Job = require('../../src/models/Job');
const CleanerProfile = require('../../src/models/CleanerProfile');
const Message = require('../../src/models/Message');
const notifications = require('../../src/services/notification.service');
const chat = require('../../src/services/chat.service');

const customer = { id: 'cust1', role: 'customer' };
const cleaner = { id: 'cleanUser1', role: 'cleaner' };

const bookedJob = (overrides = {}) => ({
  _id: 'job1',
  customer: 'cust1',
  cleaner: 'profile1',
  paymentStatus: 'PAID_HELD',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  Job.findById.mockResolvedValue(bookedJob());
  CleanerProfile.findOne.mockResolvedValue({ _id: 'profile1' });
  Message.exists.mockResolvedValue(null);
  Message.create.mockImplementation(async (doc) => ({ _id: 'm1', createdAt: new Date(), ...doc }));
});

describe('access', () => {
  it('lets the job customer and the booked cleaner in', async () => {
    Message.find.mockReturnValue({ sort: () => ({ limit: async () => [] }) });
    expect((await chat.listMessages('job1', customer)).role).toBe('customer');
    expect((await chat.listMessages('job1', cleaner)).role).toBe('cleaner');
  });

  it("refuses another customer, a different cleaner, and jobs with no cleaner", async () => {
    await expect(chat.listMessages('job1', { id: 'other', role: 'customer' })).rejects.toMatchObject({ status: 403 });

    CleanerProfile.findOne.mockResolvedValue({ _id: 'someoneElse' });
    await expect(chat.listMessages('job1', cleaner)).rejects.toMatchObject({ status: 403 });

    Job.findById.mockResolvedValue(bookedJob({ cleaner: undefined }));
    await expect(chat.listMessages('job1', cleaner)).rejects.toMatchObject({ status: 403 });
  });

  it('404s for an unknown job', async () => {
    Job.findById.mockResolvedValue(null);
    await expect(chat.listMessages('nope', customer)).rejects.toMatchObject({ status: 404 });
  });
});

describe('sendMessage', () => {
  it('masks contact details, stores only the masked text and tells the sender', async () => {
    const result = await chat.sendMessage('job1', customer, 'Ring me on 07700 900123, I am at WF8 2YJ');

    const stored = Message.create.mock.calls[0][0];
    expect(stored.body).toBe('Ring me on [contact details hidden], I am at [contact details hidden]');
    expect(stored.body).not.toMatch(/07700|WF8/);
    expect(stored).toMatchObject({ contactMasked: true, maskedKinds: ['phone', 'postcode'], senderRole: 'customer' });
    expect(result.masked).toBe(true);
    expect(result.notice).toBe(chat.MASKED_NOTICE);
    expect(JSON.stringify(result)).not.toMatch(/07700|WF8/);
  });

  it('sends a clean message as is, with no notice', async () => {
    const result = await chat.sendMessage('job1', cleaner, 'I will arrive at 9am');
    expect(result.masked).toBe(false);
    expect(result.notice).toBeUndefined();
    expect(Message.create.mock.calls[0][0].senderRole).toBe('cleaner');
  });

  it('rejects empty and over-long messages', async () => {
    await expect(chat.sendMessage('job1', customer, '   ')).rejects.toMatchObject({ status: 400 });
    await expect(chat.sendMessage('job1', customer, 'x'.repeat(chat.MAX_BODY + 1))).rejects.toMatchObject({ status: 400 });
    expect(Message.create).not.toHaveBeenCalled();
  });

  it('is read-only once the job is no longer active, and closed before a cleaner accepts', async () => {
    Job.findById.mockResolvedValue(bookedJob({ paymentStatus: 'PAID_OUT' }));
    await expect(chat.sendMessage('job1', customer, 'hi')).rejects.toMatchObject({ status: 409 });

    Job.findById.mockResolvedValue(bookedJob({ paymentStatus: 'DISPUTED' }));
    await expect(chat.sendMessage('job1', customer, 'hi')).rejects.toMatchObject({ status: 409 });

    Job.findById.mockResolvedValue(bookedJob({ cleaner: undefined, paymentStatus: undefined }));
    await expect(chat.sendMessage('job1', customer, 'hi')).rejects.toMatchObject({
      status: 409,
      message: 'Chat opens when a cleaner accepts your job.',
    });
    expect(Message.create).not.toHaveBeenCalled();
  });

  it('emails the other person once per quiet period, never with the message text', async () => {
    await chat.sendMessage('job1', customer, 'first message');
    expect(notifications.newMessage).toHaveBeenCalledWith(expect.objectContaining({ _id: 'job1' }), 'cleaner');

    notifications.newMessage.mockClear();
    Message.exists.mockResolvedValue({ _id: 'earlier' });
    await chat.sendMessage('job1', customer, 'second message');
    expect(notifications.newMessage).not.toHaveBeenCalled();
  });

  it('delivers live to the other party', async () => {
    const received = [];
    const unsubscribe = chat.subscribe('job1', (m) => received.push(m));
    await chat.sendMessage('job1', customer, 'hello there');
    unsubscribe();
    await chat.sendMessage('job1', customer, 'after unsubscribe');
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ body: 'hello there', senderRole: 'customer' });
  });
});

describe('listMessages', () => {
  it("marks the other person's messages read and reports writability", async () => {
    Message.find.mockReturnValue({ sort: () => ({ limit: async () => [{ _id: 'm1', job: 'job1', senderRole: 'cleaner', body: 'hi', createdAt: new Date() }] }) });
    const result = await chat.listMessages('job1', customer);
    expect(Message.updateMany).toHaveBeenCalledWith(
      { job: 'job1', senderRole: 'cleaner', readAt: { $exists: false } },
      { $set: { readAt: expect.any(Date) } }
    );
    expect(result.writable).toBe(true);
    expect(result.messages[0].body).toBe('hi');
  });
});

describe('unreadSummary', () => {
  it('counts unread messages from the other party per job', async () => {
    Job.find.mockReturnValue({ select: async () => [{ _id: 'job1' }, { _id: 'job2' }] });
    Message.aggregate.mockResolvedValue([{ _id: 'job1', count: 2 }]);
    const result = await chat.unreadSummary(customer);
    expect(result).toEqual({ total: 2, byJob: { job1: 2 } });
    expect(Message.aggregate.mock.calls[0][0][0].$match.senderRole).toBe('cleaner');
  });

  it('is empty for a cleaner without a profile', async () => {
    CleanerProfile.findOne.mockResolvedValue(null);
    expect(await chat.unreadSummary(cleaner)).toEqual({ total: 0, byJob: {} });
  });
});
