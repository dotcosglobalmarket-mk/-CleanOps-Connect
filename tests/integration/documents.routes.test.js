jest.mock('../../src/models/Job', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/CleanerProfile', () => ({ findOne: jest.fn(), findById: jest.fn() }));
jest.mock('../../src/models/ServiceType', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/User', () => ({
  findById: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const Job = require('../../src/models/Job');
const CleanerProfile = require('../../src/models/CleanerProfile');
const ServiceType = require('../../src/models/ServiceType');
const User = require('../../src/models/User');
const { renderServiceRecord, renderCompliancePack, esc } = require('../../src/services/document.service');

const jobId = '507f1f77bcf86cd799439011';
const auth = (role, id = 'owner1') =>
  `Bearer ${jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;

const baseJob = (overrides = {}) => ({
  _id: jobId,
  customer: { toString: () => 'owner1' },
  cleaner: { toString: () => 'profile1' },
  serviceType: 'st1',
  category: 'industrial',
  frequency: 'weekly',
  postcode: 'LS12 1AB',
  description: 'Warehouse clean',
  pricePence: 125050,
  paymentStatus: 'PAID_OUT',
  createdAt: new Date('2026-10-20T09:00:00Z'),
  bookedAt: new Date('2026-10-21T09:00:00Z'),
  checkedInAt: new Date('2026-10-25T08:00:00Z'),
  awaitingConfirmationAt: new Date('2026-10-25T16:00:00Z'),
  confirmedAt: new Date('2026-10-27T16:00:00Z'),
  confirmationMethod: 'automatic',
  tender: { requirements: 'Out of hours access' },
  ...overrides,
});

const cleanerProfile = (overrides = {}) => ({
  _id: { toString: () => 'profile1' },
  name: 'Sam Cleaner',
  companyName: 'Sam Ltd',
  dbsVerified: true,
  coshhTrained: false,
  insuranceStatus: 'own',
  ...overrides,
});

describe('GET /jobs/:id/documents/:kind', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
    Job.findById.mockResolvedValue(baseJob());
    User.findById.mockResolvedValue({ name: 'Collins Test' });
    CleanerProfile.findById.mockResolvedValue(cleanerProfile());
    CleanerProfile.findOne.mockResolvedValue(cleanerProfile());
    ServiceType.findById.mockResolvedValue({ name: 'Industrial Deep Clean', requiresCoshh: true });
  });

  const get = (kind, role = 'customer', id = 'owner1') =>
    request(app).get(`/jobs/${jobId}/documents/${kind}`).set('Authorization', auth(role, id));

  it('requires authentication and a known document kind', async () => {
    expect((await request(app).get(`/jobs/${jobId}/documents/service-record`)).status).toBe(401);
    expect((await get('invoice')).status).toBe(400);
  });

  it('gives the customer an uncached HTML service record', async () => {
    const res = await get('service-record');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain('Service record');
    expect(res.text).toContain('Collins Test');
    expect(res.text).toContain('Sam Cleaner');
    expect(res.text).toContain('£1250.50');
    expect(res.text).toContain('automatically, after 48 hours');
    expect(res.text).toContain('not an invoice');
  });

  it('lets the booked cleaner and an admin read it, and nobody else', async () => {
    expect((await get('service-record', 'cleaner', 'cleanUser')).status).toBe(200);
    expect((await get('service-record', 'admin', 'admin1')).status).toBe(200);
    expect((await get('service-record', 'customer', 'someone-else')).status).toBe(403);
    CleanerProfile.findOne.mockResolvedValue(cleanerProfile({ _id: { toString: () => 'otherProfile' } }));
    expect((await get('service-record', 'cleaner', 'otherCleaner')).status).toBe(403);
  });

  it('has nothing to show until a cleaner is booked, and 404s for an unknown job', async () => {
    Job.findById.mockResolvedValue(baseJob({ cleaner: undefined }));
    expect((await get('service-record')).status).toBe(409);
    Job.findById.mockResolvedValue(null);
    expect((await get('service-record')).status).toBe(404);
  });

  it('gives an industrial job a compliance pack with blank COSHH and risk sections', async () => {
    const res = await get('compliance-pack');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Pre-start compliance pack');
    expect(res.text).toContain('A. COSHH assessment');
    expect(res.text).toContain('B. Risk assessment and method statement');
    expect(res.text).toContain('Out of hours access');
    expect(res.text).toContain('is not a statement that any work or person');
  });

  it('refuses a compliance pack for a domestic job', async () => {
    Job.findById.mockResolvedValue(baseJob({ category: 'domestic' }));
    ServiceType.findById.mockResolvedValue({ name: 'Domestic Deep Clean', requiresCoshh: false });
    const res = await get('compliance-pack');
    expect(res.status).toBe(400);
    expect((await get('service-record')).status).toBe(200);
  });
});

describe('document content', () => {
  const data = (over = {}) => ({
    job: baseJob(over.job),
    customer: { name: 'Collins Test' },
    cleaner: cleanerProfile(over.cleaner),
    serviceType: { name: 'Industrial Deep Clean', requiresCoshh: true },
  });
  const when = new Date('2026-10-26T12:00:00Z');

  it('escapes everything that comes from users', () => {
    const evil = '<script>alert(1)</script>"\'&';
    const html = renderServiceRecord(
      data({ job: { description: evil, postcode: evil }, cleaner: { name: evil, companyName: evil } }),
      when
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(esc(null)).toBe('');
  });

  it('says "Not recorded" for older jobs without timestamps instead of guessing', () => {
    const html = renderServiceRecord(data({ job: { checkedInAt: undefined, confirmedAt: undefined, confirmationMethod: undefined } }), when);
    expect(html).toMatch(/Cleaner checked in<\/th><td>Not recorded/);
    expect(html).toMatch(/Confirmed complete<\/th><td>Not recorded/);
  });

  it('reports the cleaner status as recorded now, and does not overclaim', () => {
    const html = renderServiceRecord(data({ cleaner: { dbsVerified: false, coshhTrained: true, insuranceStatus: 'none' } }), when);
    expect(html).toMatch(/DBS check<\/th><td>Not verified/);
    expect(html).toMatch(/COSHH training<\/th><td>Marked as verified/);
    expect(html).toContain('No insurance recorded');
    expect(html).toContain('not necessarily on the day of the job');
    expect(html).toContain('not a guarantee');
  });

  it('leaves the COSHH table empty: nothing is invented', () => {
    const html = renderCompliancePack(data(), when);
    expect((html.match(/<tr class="blank"><td><\/td><td><\/td><td><\/td><td><\/td><td><\/td><td><\/td><\/tr>/g) || []).length).toBe(6);
    expect(html).not.toMatch(/compliant with|certified|approved/i);
  });

  it('shows company details in the footer', () => {
    expect(renderServiceRecord(data(), when)).toContain('company number 12674639');
  });
});
