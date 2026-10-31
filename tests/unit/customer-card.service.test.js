jest.mock('../../src/models/User', () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../../src/services/stripe.service');

const User = require('../../src/models/User');
const stripeService = require('../../src/services/stripe.service');
const cards = require('../../src/services/customer-card.service');

const user = (o = {}) => ({
  _id: 'u1',
  email: 'sam@example.com',
  save: jest.fn().mockResolvedValue(undefined),
  ...o,
});
const visa = { id: 'pm_new', customer: 'cus_1', type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2030 } };

beforeEach(() => {
  jest.clearAllMocks();
  stripeService.detachPaymentMethod.mockResolvedValue({});
});

describe('starting to save a card', () => {
  it('creates the Stripe customer once, then an off-session setup intent', async () => {
    User.findById.mockResolvedValue(user());
    stripeService.createCustomer.mockResolvedValue({ id: 'cus_1' });
    User.findOneAndUpdate.mockResolvedValue({ stripeCustomerId: 'cus_1' });
    stripeService.createSetupIntent.mockResolvedValue({ client_secret: 'seti_secret' });

    const result = await cards.createSetupIntent('u1');

    expect(result).toEqual({ clientSecret: 'seti_secret' });
    expect(stripeService.createCustomer).toHaveBeenCalledWith({ email: 'sam@example.com', metadata: { userId: 'u1' } });
    expect(stripeService.createSetupIntent).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_1', paymentMethodTypes: ['card'] }));
  });

  it('reuses an existing Stripe customer', async () => {
    User.findById.mockResolvedValue(user({ stripeCustomerId: 'cus_1' }));
    stripeService.retrieveCustomer.mockResolvedValue({ id: 'cus_1' });
    stripeService.createSetupIntent.mockResolvedValue({ client_secret: 's' });
    await cards.createSetupIntent('u1');
    expect(stripeService.createCustomer).not.toHaveBeenCalled();
  });

  it('starts again with a new customer when the stored one does not exist for this key', async () => {
    User.findById.mockResolvedValue(user({ stripeCustomerId: 'cus_from_test_mode' }));
    stripeService.isMissingResource.mockImplementation((e) => e && e.code === 'resource_missing');
    stripeService.retrieveCustomer.mockRejectedValue(Object.assign(new Error('No such customer'), { code: 'resource_missing' }));
    stripeService.createCustomer.mockResolvedValue({ id: 'cus_live' });
    User.updateOne = jest.fn().mockResolvedValue({});
    stripeService.createSetupIntent.mockResolvedValue({ client_secret: 's' });

    await cards.createSetupIntent('u1');

    expect(User.updateOne).toHaveBeenCalledWith({ _id: 'u1' }, expect.objectContaining({ $set: { stripeCustomerId: 'cus_live' } }));
    expect(stripeService.createSetupIntent).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_live' }));
  });

  it('does not replace the customer for other Stripe failures', async () => {
    User.findById.mockResolvedValue(user({ stripeCustomerId: 'cus_1' }));
    stripeService.isMissingResource.mockImplementation((e) => e && e.code === 'resource_missing');
    stripeService.retrieveCustomer.mockRejectedValue(new Error('timeout'));
    await expect(cards.createSetupIntent('u1')).rejects.toThrow('timeout');
    expect(stripeService.createCustomer).not.toHaveBeenCalled();
  });
});

describe('saving the card', () => {
  it('stores only the safe summary, the consent time and wording, and makes it the default', async () => {
    const u = user({ stripeCustomerId: 'cus_1' });
    User.findById.mockResolvedValue(u);
    stripeService.retrievePaymentMethod.mockResolvedValue(visa);

    const view = await cards.saveCard('u1', 'pm_new', true);

    expect(stripeService.setDefaultPaymentMethod).toHaveBeenCalledWith({ customerId: 'cus_1', paymentMethodId: 'pm_new' });
    expect(u.savedCard).toMatchObject({
      paymentMethodId: 'pm_new',
      brand: 'visa',
      last4: '4242',
      expMonth: 4,
      expYear: 2030,
      consentVersion: cards.CARD_CONSENT_VERSION,
    });
    expect(u.savedCard.consentAt).toBeInstanceOf(Date);
    expect(view).toMatchObject({ saved: true, brand: 'visa', last4: '4242' });
    expect(view.paymentMethodId).toBeUndefined();
  });

  it('refuses without the customer agreeing', async () => {
    await expect(cards.saveCard('u1', 'pm_new', false)).rejects.toMatchObject({ status: 400 });
    expect(stripeService.retrievePaymentMethod).not.toHaveBeenCalled();
  });

  it('refuses a card that belongs to someone else', async () => {
    User.findById.mockResolvedValue(user({ stripeCustomerId: 'cus_1' }));
    stripeService.retrievePaymentMethod.mockResolvedValue({ ...visa, customer: 'cus_other' });
    await expect(cards.saveCard('u1', 'pm_new', true)).rejects.toMatchObject({ status: 403 });
    expect(stripeService.setDefaultPaymentMethod).not.toHaveBeenCalled();
  });

  it('refuses a method that is not a card', async () => {
    User.findById.mockResolvedValue(user({ stripeCustomerId: 'cus_1' }));
    stripeService.retrievePaymentMethod.mockResolvedValue({ id: 'pm_x', customer: 'cus_1', type: 'sepa_debit' });
    await expect(cards.saveCard('u1', 'pm_x', true)).rejects.toMatchObject({ status: 400 });
  });

  it('refuses when saving was never started', async () => {
    User.findById.mockResolvedValue(user());
    await expect(cards.saveCard('u1', 'pm_new', true)).rejects.toMatchObject({ status: 400 });
  });

  it('replacing a card detaches the old one from Stripe', async () => {
    const u = user({ stripeCustomerId: 'cus_1', savedCard: { paymentMethodId: 'pm_old' } });
    User.findById.mockResolvedValue(u);
    stripeService.retrievePaymentMethod.mockResolvedValue(visa);
    await cards.saveCard('u1', 'pm_new', true);
    expect(stripeService.detachPaymentMethod).toHaveBeenCalledWith('pm_old');
  });
});

describe('viewing and removing the card', () => {
  it('says there is no card when none is saved', async () => {
    User.findById.mockResolvedValue(user());
    expect(await cards.getCard('u1')).toEqual({ saved: false });
  });

  it('removing detaches it at Stripe and forgets it', async () => {
    const u = user({ savedCard: { paymentMethodId: 'pm_old', last4: '4242' } });
    User.findById.mockResolvedValue(u);
    await cards.removeCard('u1');
    expect(stripeService.detachPaymentMethod).toHaveBeenCalledWith('pm_old');
    expect(u.savedCard).toBeUndefined();
    expect(u.save).toHaveBeenCalled();
  });

  it('cannot remove a card that is not there', async () => {
    User.findById.mockResolvedValue(user());
    await expect(cards.removeCard('u1')).rejects.toMatchObject({ status: 400 });
  });
});
