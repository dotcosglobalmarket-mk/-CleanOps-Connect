jest.mock('../../src/models/User', () => ({
  findById: jest.fn((id) => Promise.resolve({ _id: id, name: 'Staff', role: 'operator', active: true })),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../src/services/chat.service', () => ({
  listMessages: jest.fn(),
  sendMessage: jest.fn(),
  unreadSummary: jest.fn(),
  listMessagesForStaff: jest.fn(),
  requireParticipant: jest.fn(),
  subscribe: jest.fn(() => () => {}),
}));
jest.mock('../../src/services/audit.service', () => ({
  record: jest.fn(),
  listForTarget: jest.fn(),
  list: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const chat = require('../../src/services/chat.service');
const audit = require('../../src/services/audit.service');

const JOB = '507f1f77bcf86cd799439011';
const auth = (role, id = 'user1') =>
  `Bearer ${jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;

describe('chat routes', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  it('requires a signed-in customer or cleaner', async () => {
    expect((await request(app).get(`/chat/jobs/${JOB}/messages`)).status).toBe(401);
    const res = await request(app).get(`/chat/jobs/${JOB}/messages`).set('Authorization', auth('operator'));
    expect(res.status).toBe(403);
    expect(chat.listMessages).not.toHaveBeenCalled();
  });

  it('lists messages for a participant, passing the polling cursor', async () => {
    chat.listMessages.mockResolvedValue({ open: true, writable: true, role: 'customer', messages: [] });
    const after = '507f1f77bcf86cd799439022';
    const res = await request(app).get(`/chat/jobs/${JOB}/messages?after=${after}`).set('Authorization', auth('customer'));
    expect(res.status).toBe(200);
    expect(chat.listMessages).toHaveBeenCalledWith(JOB, { id: 'user1', role: 'customer' }, { after });
  });

  it('passes service errors (not a participant) through', async () => {
    const err = new Error('You do not have access to this conversation');
    err.status = 403;
    chat.listMessages.mockRejectedValue(err);
    const res = await request(app).get(`/chat/jobs/${JOB}/messages`).set('Authorization', auth('cleaner'));
    expect(res.status).toBe(403);
  });

  it('sends a message and returns the masking notice', async () => {
    chat.sendMessage.mockResolvedValue({ message: { body: 'x' }, masked: true, notice: 'hidden' });
    const res = await request(app)
      .post(`/chat/jobs/${JOB}/messages`)
      .set('Authorization', auth('cleaner'))
      .send({ body: 'call 07700 900123' });
    expect(res.status).toBe(201);
    expect(res.body.masked).toBe(true);
    expect(chat.sendMessage).toHaveBeenCalledWith(JOB, { id: 'user1', role: 'cleaner' }, 'call 07700 900123');
  });

  it('validates the message and the job id', async () => {
    const empty = await request(app).post(`/chat/jobs/${JOB}/messages`).set('Authorization', auth('customer')).send({ body: '  ' });
    expect(empty.status).toBe(400);
    const long = await request(app).post(`/chat/jobs/${JOB}/messages`).set('Authorization', auth('customer')).send({ body: 'x'.repeat(1001) });
    expect(long.status).toBe(400);
    const badId = await request(app).post('/chat/jobs/nope/messages').set('Authorization', auth('customer')).send({ body: 'hi' });
    expect(badId.status).toBe(400);
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  it('refuses the live stream to anyone who is not a participant', async () => {
    const err = new Error('You do not have access to this conversation');
    err.status = 403;
    chat.requireParticipant.mockRejectedValue(err);
    const res = await request(app).get(`/chat/jobs/${JOB}/stream`).set('Authorization', auth('customer'));
    expect(res.status).toBe(403);
    expect(chat.subscribe).not.toHaveBeenCalled();
  });

  it('returns unread counts', async () => {
    chat.unreadSummary.mockResolvedValue({ total: 3, byJob: { [JOB]: 3 } });
    const res = await request(app).get('/chat/unread').set('Authorization', auth('cleaner'));
    expect(res.body).toEqual({ total: 3, byJob: { [JOB]: 3 } });
  });
});

describe('POST /ops/jobs/:id/messages/view', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  it('needs a reason, writes an audit entry, then returns the conversation', async () => {
    chat.listMessagesForStaff.mockResolvedValue([{ body: 'hi' }]);

    const noReason = await request(app).post(`/ops/jobs/${JOB}/messages/view`).set('Authorization', auth('operator')).send({});
    expect(noReason.status).toBe(400);
    expect(audit.record).not.toHaveBeenCalled();

    const res = await request(app)
      .post(`/ops/jobs/${JOB}/messages/view`)
      .set('Authorization', auth('operator'))
      .send({ reason: 'Dispute about no-show' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ body: 'hi' }]);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'chat.view', targetType: 'job', targetId: JOB, reason: 'Dispute about no-show' })
    );
  });

  it('is closed to customers and cleaners', async () => {
    const res = await request(app).post(`/ops/jobs/${JOB}/messages/view`).set('Authorization', auth('customer')).send({ reason: 'nosy' });
    expect(res.status).toBe(403);
    expect(chat.listMessagesForStaff).not.toHaveBeenCalled();
  });
});
