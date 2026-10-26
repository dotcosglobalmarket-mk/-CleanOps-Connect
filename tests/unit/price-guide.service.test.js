const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class APIConnectionError extends APIError {}
  const Anthropic = jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } }));
  Anthropic.APIError = APIError;
  Anthropic.APIConnectionError = APIConnectionError;
  return Anthropic;
});
jest.mock('../../src/models/ServiceType', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/PriceGuide', () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn() }));

const Anthropic = require('@anthropic-ai/sdk');
const ServiceType = require('../../src/models/ServiceType');
const PriceGuide = require('../../src/models/PriceGuide');
const { getGuide, normaliseArea, parseResult, collectSources } = require('../../src/services/price-guide.service');

const serviceType = { _id: 'st1', name: 'Domestic Regular Clean', category: 'domestic', description: 'Recurring home cleaning.' };
const answer = (obj) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }] });
const found = { found: true, hourlyLow: 14.2, hourlyHigh: 18.7, scope: 'local', basis: 'Published hourly rates from cleaners around Leeds', confidence: 'medium' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  ServiceType.findById.mockResolvedValue(serviceType);
  PriceGuide.findOne.mockResolvedValue(null);
  PriceGuide.findOneAndUpdate.mockResolvedValue({});
});
afterAll(() => delete process.env.ANTHROPIC_API_KEY);

describe('normaliseArea', () => {
  it.each([
    ['LS12 1AB', 'LS12'],
    ['ls121ab', 'LS12'],
    ['SW1A 1AA', 'SW1A'],
    ['LS12', 'LS12'],
    ['wf8', 'WF8'],
    ['W', undefined],
    ['hello', undefined],
    ['', undefined],
  ])('%j -> %j', (input, expected) => expect(normaliseArea(input)).toBe(expected));
});

describe('getGuide', () => {
  it('is unavailable without an API key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(getGuide({ serviceTypeId: 'st1', area: 'LS12' })).rejects.toMatchObject({ status: 503 });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects an invalid postcode and an unknown service', async () => {
    await expect(getGuide({ serviceTypeId: 'st1', area: 'nonsense' })).rejects.toMatchObject({ status: 400 });
    ServiceType.findById.mockResolvedValue(null);
    await expect(getGuide({ serviceTypeId: 'nope', area: 'LS12' })).rejects.toMatchObject({ status: 404 });
  });

  it('searches the web for the district only, never sending a full postcode', async () => {
    mockCreate.mockResolvedValue(answer(found));
    await getGuide({ serviceTypeId: 'st1', area: 'LS12 1AB' });

    const [params, options] = mockCreate.mock.calls[0];
    expect(params.tools).toEqual([expect.objectContaining({ type: 'web_search_20260209', name: 'web_search', user_location: { type: 'approximate', country: 'GB' } })]);
    expect(params.messages[0].content).toContain('LS12');
    expect(params.messages[0].content).not.toMatch(/1AB/);
    expect(params.model).toBe('claude-sonnet-5-5');
    expect(options.timeout).toBeGreaterThan(20000);
  });

  it('returns a rounded hourly range, a total for the estimated hours, and the sources', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        { type: 'web_search_tool_result', content: [{ type: 'web_search_result', title: 'Other page', url: 'https://other.example/p' }] },
        { type: 'text', text: JSON.stringify(found), citations: [{ type: 'web_search_result_location', title: 'Cleaning prices', url: 'https://guide.example/leeds' }] },
      ],
    });
    const guide = await getGuide({ serviceTypeId: 'st1', area: 'LS12', estimatedHours: 3 });

    expect(guide.hourlyLowPence).toBe(1400); // £14.20 -> nearest 50p
    expect(guide.hourlyHighPence).toBe(1850); // £18.70 -> £18.50
    // 3 hours, to the nearest pound: £42.00 and £55.50 (-> £56)
    expect(guide.job).toEqual({ hours: 3, lowPence: 4200, highPence: 5600 });
    expect(guide.scope).toBe('local');
    expect(guide.sources.map((s) => s.url)).toEqual(['https://guide.example/leeds', 'https://other.example/p']);
    expect(PriceGuide.findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'LS12|st1' },
      { $set: expect.objectContaining({ found: true, hourlyLowPence: 1400, expiresAt: expect.any(Date) }) },
      { upsert: true }
    );
  });

  it('serves a cached guide without calling the AI again', async () => {
    PriceGuide.findOne.mockResolvedValue({ area: 'LS12', found: true, hourlyLowPence: 1500, hourlyHighPence: 2000, scope: 'regional', basis: 'x', confidence: 'low', sources: [], generatedAt: new Date() });
    const guide = await getGuide({ serviceTypeId: 'st1', area: 'LS12' });
    expect(guide.hourlyLowPence).toBe(1500);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('shares one lookup between identical simultaneous requests', async () => {
    mockCreate.mockResolvedValue(answer(found));
    await Promise.all([getGuide({ serviceTypeId: 'st1', area: 'LS12' }), getGuide({ serviceTypeId: 'st1', area: 'LS12' })]);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('carries on when the server pauses a long search', async () => {
    const paused = { stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 't1', name: 'web_search', input: {} }] };
    mockCreate.mockResolvedValueOnce(paused).mockResolvedValueOnce(answer(found));
    const guide = await getGuide({ serviceTypeId: 'st1', area: 'LS12' });
    expect(guide.hourlyLowPence).toBe(1400);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1][0].messages[1]).toEqual({ role: 'assistant', content: paused.content });
  });

  it('says there is no guide, and remembers that for a day, when nothing usable is found', async () => {
    mockCreate.mockResolvedValue(answer({ found: false }));
    await expect(getGuide({ serviceTypeId: 'st1', area: 'LS12' })).rejects.toMatchObject({ status: 404 });
    const saved = PriceGuide.findOneAndUpdate.mock.calls[0][1].$set;
    expect(saved.found).toBe(false);
    expect(saved.expiresAt.getTime() - saved.generatedAt.getTime()).toBe(24 * 3600 * 1000);
  });

  it.each([
    ['backwards range', { ...found, hourlyLow: 20, hourlyHigh: 10 }],
    ['implausibly wide range', { ...found, hourlyLow: 10, hourlyHigh: 80 }],
    ['absurd rate', { ...found, hourlyLow: 500, hourlyHigh: 600 }],
    ['not JSON at all', null],
  ])('does not show a %s', async (_name, payload) => {
    mockCreate.mockResolvedValue(payload ? answer(payload) : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sorry, I could not find that.' }] });
    await expect(getGuide({ serviceTypeId: 'st1', area: 'LS12' })).rejects.toMatchObject({ status: 404 });
  });

  it('hides contact details in the model\'s explanation', async () => {
    mockCreate.mockResolvedValue(answer({ ...found, basis: 'Rates from cleaners, call 07700 900123 or visit cheapclean.com' }));
    const guide = await getGuide({ serviceTypeId: 'st1', area: 'LS12' });
    expect(guide.basis).not.toMatch(/07700|cheapclean/);
    expect(guide.basis).toContain('[contact details hidden]');
  });

  it('is unavailable (503) when the AI service fails', async () => {
    mockCreate.mockRejectedValue(new Anthropic.APIError('boom'));
    await expect(getGuide({ serviceTypeId: 'st1', area: 'LS12' })).rejects.toMatchObject({ status: 503 });
  });
});

describe('parseResult and collectSources', () => {
  it('finds the JSON even with surrounding text', () => {
    expect(parseResult(`Here you go: ${JSON.stringify(found)} Thanks`)).toMatchObject({ found: true, hourlyLow: 14.2 });
    expect(parseResult('no json')).toBeNull();
  });

  it('keeps only https links, no duplicates, at most five', () => {
    const results = [
      { type: 'web_search_result', title: 'http', url: 'http://insecure.example/a' },
      { type: 'web_search_result', title: 'js', url: 'javascript:alert(1)' },
      ...Array.from({ length: 8 }, (_, i) => ({ type: 'web_search_result', title: `p${i}`, url: `https://ok.example/${i % 6}` })),
    ];
    const sources = collectSources([{ type: 'web_search_tool_result', content: results }]);
    expect(sources).toHaveLength(5);
    expect(sources.every((s) => s.url.startsWith('https://'))).toBe(true);
    expect(new Set(sources.map((s) => s.url)).size).toBe(5);
  });
});
