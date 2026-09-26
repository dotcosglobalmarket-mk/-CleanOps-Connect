const emailService = require('../../src/services/email.service');

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn();
  process.env.RESEND_API_KEY = 're_test';
  process.env.EMAIL_FROM = 'CleanOps Connect <bookings@cleanop-connect.co.uk>';
});

afterAll(() => {
  global.fetch = originalFetch;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

describe('email.service.send', () => {
  it('sends through the Resend API with escaped HTML', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'email_1' }) });

    const result = await emailService.send({
      to: 'rita@example.com',
      subject: 'Your cleaner has checked in',
      paragraphs: ['Hello <script>alert(1)</script>'],
      action: { label: 'View', url: 'https://www.cleanop-connect.co.uk/customer.html?job=1' },
    });

    expect(result).toEqual({ id: 'email_1' });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer re_test');
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(['rita@example.com']);
    expect(body.html).toContain('&lt;script&gt;');
    expect(body.html).not.toContain('<script>');
  });

  it('leaves out the button when its link could not be built', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'email_2' }) });
    await emailService.send({ to: 'a@example.com', subject: 'x', paragraphs: ['p'], action: { label: 'View', url: undefined } });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.text).not.toContain('undefined');
    expect(body.html).not.toContain('href=');
  });

  it('only logs when Resend is not configured', async () => {
    delete process.env.RESEND_API_KEY;
    const result = await emailService.send({ to: 'rita@example.com', subject: 'x', paragraphs: [] });
    expect(result).toEqual({ skipped: 'not configured' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('never throws when Resend fails', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));
    await expect(emailService.send({ to: 'a@example.com', subject: 'x', paragraphs: [] })).resolves.toEqual({
      error: 'network down',
    });
  });
});
