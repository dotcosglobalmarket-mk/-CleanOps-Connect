const { maskContactDetails, REPLACEMENT } = require('../../src/services/contact-filter.service');

const masked = (text) => maskContactDetails(text);

describe('contact-filter.service', () => {
  describe('phone numbers', () => {
    it.each([
      ['Call me on 07700 900123 please', 'Call me on [contact details hidden] please'],
      ['my number is 07700900123', 'my number is [contact details hidden]'],
      ['+44 7700 900123', '[contact details hidden]'],
      ['(01977) 123456', '[contact details hidden]'],
      ['07700-900-123', '[contact details hidden]'],
      ['0 7 7 0 0 9 0 0 1 2 3', '[contact details hidden]'],
      ['oh seven seven double oh nine double oh one two three', '[contact details hidden]'],
      ['zero seven seven zero zero nine zero zero one two three', '[contact details hidden]'],
      ['07700 nine zero zero one two three', '[contact details hidden]'],
      ['ring 07700 900123 or 07700 900124', 'ring [contact details hidden] or [contact details hidden]'],
    ])('hides %j', (input, expected) => {
      const result = masked(input);
      expect(result.text).toBe(expected);
      expect(result.masked).toBe(true);
      expect(result.kinds).toContain('phone');
    });
  });

  describe('emails', () => {
    it.each([
      ['email me at bob@gmail.com', 'email me at [contact details hidden]'],
      ['bob (at) gmail (dot) com', '[contact details hidden]'],
      ['bob at gmail dot com', '[contact details hidden]'],
    ])('hides %j', (input, expected) => {
      const result = masked(input);
      expect(result.text).toBe(expected);
      expect(result.kinds).toContain('email');
    });
  });

  describe('postcodes', () => {
    it.each([
      ['I live at WF8 2YJ thanks', 'I live at [contact details hidden] thanks'],
      ['ls12 3ab', '[contact details hidden]'],
      ['SW1A1AA', '[contact details hidden]'],
    ])('hides full postcode %j', (input, expected) => {
      const result = masked(input);
      expect(result.text).toBe(expected);
      expect(result.kinds).toContain('postcode');
    });

    it('leaves the public outward code alone', () => {
      expect(masked('near LS12 is fine')).toEqual({ text: 'near LS12 is fine', masked: false, kinds: [] });
    });
  });

  describe('links and handles', () => {
    it.each([
      ['see www.mysite.co.uk/book', 'see [contact details hidden]', 'link'],
      ['visit mysite.com', 'visit [contact details hidden]', 'link'],
      ['wa.me/447700900123', '[contact details hidden]', 'link'],
      ['add me @bob_cleans', 'add me [contact details hidden]', 'handle'],
    ])('hides %j', (input, expected, kind) => {
      const result = masked(input);
      expect(result.text).toBe(expected);
      expect(result.kinds).toContain(kind);
    });
  });

  describe('ordinary messages are untouched', () => {
    it.each([
      'See you on 26/10/2026 at 14:30, 2 bedrooms, 1 bathroom, 3 hours, £150',
      'The invoice is for 12 03 2026',
      'one or two hours is fine, maybe three',
      'I will arrive at 9 and finish at 12, price £120.50',
      'Please bring 2 mops, 3 cloths and 1 bucket',
      'Is the key under the mat? Thanks!',
      // "double"/"triple" with nothing after them are not digits — don't
      // let repeating the word alone add up to a false phone-number match.
      'triple triple triple triple triple check the windows please',
      'we did a double, a double and a triple shift this week',
    ])('%j', (input) => {
      expect(masked(input)).toEqual({ text: input, masked: false, kinds: [] });
    });
  });

  it('reports every kind that was hidden', () => {
    const result = masked('07700 900123, bob@gmail.com, WF8 2YJ');
    expect(result.kinds).toEqual(['email', 'phone', 'postcode']);
    expect(result.text).not.toMatch(/\d{3}/);
    expect(result.text.startsWith(REPLACEMENT)).toBe(true);
  });
});
