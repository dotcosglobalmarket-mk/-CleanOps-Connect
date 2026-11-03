const logger = require('../../src/utils/logger');
const smsService = require('../../src/services/sms.service');

const ENV_KEYS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'TWILIO_MESSAGING_SERVICE_SID'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  ENV_KEYS.forEach((k) => delete process.env[k]);
  global.fetch = jest.fn();
  jest.spyOn(logger, 'info').mockImplementation(() => {});
  jest.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  ENV_KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  jest.restoreAllMocks();
});

describe('normaliseUkMobile', () => {
  it.each([
    ['07123 456789', '+447123456789'],
    ['07123456789', '+447123456789'],
    ['+44 7123 456789', '+447123456789'],
    ['+44 (0)7123 456789', '+447123456789'],
    ['0044 7123 456789', '+447123456789'],
    ['07123-456-789', '+447123456789'],
    ['07912 345678', '+447912345678'],
  ])('accepts %s', (input, expected) => {
    expect(smsService.normaliseUkMobile(input)).toBe(expected);
  });

  it.each([
    '', 'hello', '0113 496 0000', '020 7946 0000', '07012 345678', '07612 345678', '071234 5678',
    '07123 4567890', '+1 415 555 0100', '+44 113 496 0000', null, undefined, 7123456789,
  ])('rejects %p', (input) => {
    expect(smsService.normaliseUkMobile(input)).toBeNull();
  });
});

describe('mask', () => {
  it('keeps only the start and the last three digits', () => {
    expect(smsService.mask('+447123456789')).toBe('+44•••••••789');
    expect(smsService.mask('')).toBe('•••');
  });
});

describe('send', () => {
  it('only logs when Twilio is not set up, and never calls Twilio', async () => {
    const result = await smsService.send({ to: '+447123456789', body: 'hello' });
    expect(result).toEqual({ skipped: 'not configured' });
    expect(global.fetch).not.toHaveBeenCalled();
    const logged = logger.info.mock.calls[0][0];
    expect(logged).toContain('+44•••••••789');
    expect(logged).not.toContain('447123456789');
  });

  it('does nothing without a number or a message', async () => {
    expect(await smsService.send({ to: '', body: 'x' })).toEqual({ skipped: 'nothing to send' });
    expect(await smsService.send({ to: '+447123456789', body: '' })).toEqual({ skipped: 'nothing to send' });
  });

  it('is configured only with all three settings', () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC1';
    expect(smsService.isConfigured()).toBe(false);
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    expect(smsService.isConfigured()).toBe(false);
    process.env.TWILIO_FROM = 'CleanOps';
    expect(smsService.isConfigured()).toBe(true);
  });

  it('posts to Twilio with the account login and a sender name', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'secret';
    process.env.TWILIO_FROM = 'CleanOps';
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ sid: 'SM1' }) });

    const result = await smsService.send({ to: '+447123456789', body: 'Hi there' });

    expect(result).toEqual({ id: 'SM1' });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('AC123:secret').toString('base64')}`);
    const form = new URLSearchParams(init.body);
    expect(form.get('To')).toBe('+447123456789');
    expect(form.get('Body')).toBe('Hi there');
    expect(form.get('From')).toBe('CleanOps');
    expect(form.get('MessagingServiceSid')).toBeNull();
  });

  it('uses a messaging service instead of a sender when one is set', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'secret';
    process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG1';
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ sid: 'SM2' }) });
    await smsService.send({ to: '+447123456789', body: 'Hi' });
    const form = new URLSearchParams(global.fetch.mock.calls[0][1].body);
    expect(form.get('MessagingServiceSid')).toBe('MG1');
    expect(form.get('From')).toBeNull();
  });

  it('never throws when Twilio refuses or the network fails, and never logs the full number', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'secret';
    process.env.TWILIO_FROM = 'CleanOps';

    global.fetch.mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'bad number' });
    await expect(smsService.send({ to: '+447123456789', body: 'Hi' })).resolves.toEqual({ error: 400 });

    global.fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(smsService.send({ to: '+447123456789', body: 'Hi' })).resolves.toEqual({ error: 'offline' });

    logger.error.mock.calls.forEach(([line]) => expect(line).not.toContain('447123456789'));
  });
});
