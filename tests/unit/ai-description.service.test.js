const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class APIConnectionError extends APIError {}
  const Anthropic = jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } }));
  Anthropic.APIError = APIError;
  Anthropic.APIConnectionError = APIConnectionError;
  return Anthropic;
});
jest.mock('../../src/models/ServiceType', () => ({
  findById: jest.fn(() => ({ select: jest.fn().mockResolvedValue({ name: 'Regular home clean' }) })),
}));

const Anthropic = require('@anthropic-ai/sdk');
const { suggestDescription, buildUserMessage } = require('../../src/services/ai-description.service');

beforeEach(() => {
  mockCreate.mockReset();
  process.env.ANTHROPIC_API_KEY = 'sk-test';
});
afterAll(() => delete process.env.ANTHROPIC_API_KEY);

describe('ai-description.service', () => {
  it('returns 503 when no API key is configured', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(suggestDescription({ category: 'domestic' })).rejects.toMatchObject({ status: 503 });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('sends job details and the draft, never a postcode, and returns the text block', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: ' Two-bed flat. ' }] });
    const result = await suggestDescription({
      category: 'domestic',
      serviceType: '507f1f77bcf86cd799439011',
      frequency: 'weekly',
      estimatedHours: 3,
      draft: 'need flat cleaned',
    });
    expect(result).toEqual({ suggestion: 'Two-bed flat.' });
    const args = mockCreate.mock.calls[0][0];
    expect(args.messages[0].content).toContain('Regular home clean');
    expect(args.messages[0].content).toContain('<customer_draft>\nneed flat cleaned\n</customer_draft>');
    expect(args.messages[0].content).not.toMatch(/postcode/i);
    expect(args.max_tokens).toBeLessThanOrEqual(1000);
  });

  it('asks for a starting description when there is no draft', () => {
    expect(buildUserMessage({ category: 'industrial' })).toContain('has not written anything yet');
  });

  it('maps Anthropic API failures to 503', async () => {
    mockCreate.mockRejectedValue(new Anthropic.APIError('boom'));
    await expect(suggestDescription({ category: 'domestic' })).rejects.toMatchObject({ status: 503 });
  });

  it('503s when the model returns no text', async () => {
    mockCreate.mockResolvedValue({ content: [] });
    await expect(suggestDescription({ category: 'domestic' })).rejects.toMatchObject({ status: 503 });
  });
});

describe('model selection', () => {
  it('defaults to Sonnet 5.5 and honours ANTHROPIC_MODEL', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    await suggestDescription({ category: 'domestic' });
    expect(mockCreate.mock.calls[0][0].model).toBe('claude-sonnet-5-5');

    process.env.ANTHROPIC_MODEL = 'claude-haiku-5-5';
    await suggestDescription({ category: 'domestic' });
    expect(mockCreate.mock.calls[1][0].model).toBe('claude-haiku-5-5');
    delete process.env.ANTHROPIC_MODEL;
  });
});
