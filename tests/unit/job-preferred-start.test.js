const { createJobSchema } = require('../../src/validation/job.validation');

const base = {
  serviceType: '507f1f77bcf86cd799439011',
  category: 'domestic',
  postcode: 'LS12 1AB',
  budgetMin: 40,
  budgetMax: 60,
};
const inDays = (n) => new Date(Date.now() + n * 24 * 3600 * 1000).toISOString();

describe('preferred visit date and time', () => {
  it('is optional', () => {
    expect(createJobSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a date in the next year and keeps it as a Date', () => {
    const result = createJobSchema.safeParse({ ...base, preferredStartAt: inDays(5) });
    expect(result.success).toBe(true);
    expect(result.data.preferredStartAt).toBeInstanceOf(Date);
  });

  it('rejects the past', () => {
    expect(createJobSchema.safeParse({ ...base, preferredStartAt: inDays(-1) }).success).toBe(false);
  });

  it('rejects more than a year ahead', () => {
    expect(createJobSchema.safeParse({ ...base, preferredStartAt: inDays(400) }).success).toBe(false);
  });

  it('rejects something that is not a date', () => {
    expect(createJobSchema.safeParse({ ...base, preferredStartAt: 'next tuesday' }).success).toBe(false);
  });
});
