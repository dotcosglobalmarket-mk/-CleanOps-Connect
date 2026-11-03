jest.mock('../../src/models/User', () => ({ findById: jest.fn(), findByIdAndUpdate: jest.fn() }));

const User = require('../../src/models/User');
const alerts = require('../../src/services/sms-alerts.service');

beforeEach(() => jest.clearAllMocks());

const agree = (extra = {}) => ({ mobile: '07123 456789', consent: true, consentVersion: alerts.CONSENT.version, ...extra });

describe('sms-alerts.service', () => {
  it('shows alerts as off for someone who never turned them on, with the wording to agree to', async () => {
    User.findById.mockResolvedValue({ _id: 'u1' });
    const view = await alerts.getSettings('u1');
    expect(view.enabled).toBe(false);
    expect(view.mobile).toBeUndefined();
    expect(view.consent).toEqual({ version: alerts.CONSENT.version, text: alerts.CONSENT.text });
  });

  it('turns alerts on with the number in international form, recording when and to which wording', async () => {
    User.findByIdAndUpdate.mockImplementation((id, update) =>
      Promise.resolve({ _id: id, smsAlerts: { enabled: update.$set['smsAlerts.enabled'], mobile: update.$set['smsAlerts.mobile'] } })
    );
    const view = await alerts.enable('u1', agree());
    const [, update] = User.findByIdAndUpdate.mock.calls[0];
    expect(update.$set['smsAlerts.mobile']).toBe('+447123456789');
    expect(update.$set['smsAlerts.consentVersion']).toBe(alerts.CONSENT.version);
    expect(update.$set['smsAlerts.consentAt']).toBeInstanceOf(Date);
    expect(view).toMatchObject({ enabled: true, mobile: '+447123456789' });
  });

  it.each([
    [{ consent: false }, 400],
    [{ mobile: '0113 496 0000' }, 400],
    [{ consentVersion: 'sms-old' }, 409],
  ])('refuses %p without changing anything', async (bad, status) => {
    await expect(alerts.enable('u1', agree(bad))).rejects.toMatchObject({ status });
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('turning off deletes the number', async () => {
    User.findByIdAndUpdate.mockResolvedValue({ _id: 'u1', smsAlerts: { enabled: false } });
    const view = await alerts.disable('u1');
    const [, update] = User.findByIdAndUpdate.mock.calls[0];
    expect(update.$set['smsAlerts.enabled']).toBe(false);
    expect(update.$unset['smsAlerts.mobile']).toBe(1);
    expect(view.enabled).toBe(false);
    expect(view.mobile).toBeUndefined();
  });

  it('does not show a stored number once alerts are off', async () => {
    User.findById.mockResolvedValue({ smsAlerts: { enabled: false, mobile: '+447123456789' } });
    expect((await alerts.getSettings('u1')).mobile).toBeUndefined();
  });
});
