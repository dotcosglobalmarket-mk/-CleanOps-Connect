jest.mock('../../src/services/subscription.service', () => ({ requireActiveSubscription: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../src/services/notification.service');
jest.mock('../../src/models/Job', () => {
  const JobMock = jest.fn();
  JobMock.findById = jest.fn();
  JobMock.findOneAndUpdate = jest.fn();
  JobMock.updateOne = jest.fn();
  return JobMock;
});
jest.mock('../../src/models/JobOffer', () => ({
  insertMany: jest.fn(),
  find: jest.fn(),
  findById: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
  updateMany: jest.fn(),
  exists: jest.fn(),
}));
jest.mock('../../src/models/CleanerProfile', () => ({ find: jest.fn(), findOne: jest.fn(), findById: jest.fn() }));
jest.mock('../../src/services/mapbox.service', () => ({ geocodePostcode: jest.fn() }));
jest.mock('../../src/services/payment.service', () => ({ bookJob: jest.fn() }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const Job = require('../../src/models/Job');
const JobOffer = require('../../src/models/JobOffer');
const CleanerProfile = require('../../src/models/CleanerProfile');
const mapboxService = require('../../src/services/mapbox.service');
const paymentService = require('../../src/services/payment.service');
const notifications = require('../../src/services/notification.service');

const jobId = '507f1f77bcf86cd799439011';
const offerId = '507f1f77bcf86cd799439022';
const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const auth = (role, id = 'user1') =>
  `Bearer ${jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;

const industrialBody = (overrides = {}) => ({
  serviceType: '507f1f77bcf86cd799439033',
  category: 'industrial',
  postcode: 'LS12 1AB',
  budgetMin: 500,
  budgetMax: 2000,
  tender: { closesAt: inHours(72), requirements: 'Warehouse, 2 floors, out of hours' },
  ...overrides,
});

const openTender = (overrides = {}) => ({
  _id: jobId,
  customer: { toString: () => 'owner1' },
  serviceType: '507f1f77bcf86cd799439033',
  category: 'industrial',
  procurement: 'tender',
  tender: { closesAt: new Date(Date.now() + 48 * 3600 * 1000) },
  lat: 53.8,
  lng: -1.55,
  budgetMax: 2000,
  status: 'open',
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('Tender (industrial) routes', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  describe('POST /jobs with a tender', () => {
    it('creates the job as a tender', async () => {
      mapboxService.geocodePostcode.mockResolvedValue({ lat: 53.8, lng: -1.55 });
      Job.mockImplementation(function (data) {
        Object.assign(this, data);
        this.save = jest.fn().mockResolvedValue(undefined);
      });
      const res = await request(app).post('/jobs').set('Authorization', auth('customer')).send(industrialBody());
      expect(res.status).toBe(201);
      expect(res.body.procurement).toBe('tender');
      expect(res.body.tender.requirements).toBe('Warehouse, 2 floors, out of hours');
    });

    it('rejects a tender on a domestic job, a closing time that is too soon, and one too far away', async () => {
      const domestic = await request(app).post('/jobs').set('Authorization', auth('customer')).send(industrialBody({ category: 'domestic' }));
      expect(domestic.status).toBe(400);
      const soon = await request(app).post('/jobs').set('Authorization', auth('customer')).send(industrialBody({ tender: { closesAt: inHours(0.1) } }));
      expect(soon.status).toBe(400);
      const far = await request(app).post('/jobs').set('Authorization', auth('customer')).send(industrialBody({ tender: { closesAt: inHours(24 * 40) } }));
      expect(far.status).toBe(400);
    });

    it('leaves an industrial job without a tender as a standard job', async () => {
      mapboxService.geocodePostcode.mockResolvedValue({ lat: 53.8, lng: -1.55 });
      Job.mockImplementation(function (data) {
        Object.assign(this, data);
        this.save = jest.fn().mockResolvedValue(undefined);
      });
      const res = await request(app).post('/jobs').set('Authorization', auth('customer')).send(industrialBody({ tender: undefined }));
      expect(res.body.procurement).toBe('standard');
    });
  });

  describe('POST /jobs/:id/allocate for a tender', () => {
    const cleaner = (id) => ({
      _id: id,
      lat: 53.8,
      lng: -1.55,
      coverageType: 'radius',
      coverageRadiusKm: 20,
      experienceYears: 3,
      ratingAverage: 4,
      insuranceStatus: 'own',
      dbsVerified: true,
    });

    it('invites each matching cleaner once and sends tender invitations, not first-to-accept offers', async () => {
      const job = openTender();
      Job.findById.mockResolvedValue(job);
      CleanerProfile.find.mockResolvedValue([cleaner('c1'), cleaner('c2'), cleaner('c3')]);
      JobOffer.find.mockResolvedValue([{ cleaner: { toString: () => 'c2' } }]); // c2 already invited
      JobOffer.insertMany.mockImplementation(async (docs) => docs);

      const res = await request(app).post(`/jobs/${jobId}/allocate`).set('Authorization', auth('customer', 'owner1'));

      expect(res.status).toBe(200);
      const invited = JobOffer.insertMany.mock.calls[0][0].map((o) => o.cleaner).sort();
      expect(invited).toEqual(['c1', 'c3']);
      expect(notifications.tenderInvited).toHaveBeenCalled();
      expect(notifications.offersSent).not.toHaveBeenCalled();
    });

    it('refuses once the tender has closed or been awarded', async () => {
      Job.findById.mockResolvedValue(openTender({ tender: { closesAt: new Date(Date.now() - 1000) } }));
      const closed = await request(app).post(`/jobs/${jobId}/allocate`).set('Authorization', auth('customer', 'owner1'));
      expect(closed.status).toBe(400);

      Job.findById.mockResolvedValue(openTender({ cleaner: 'someone' }));
      const awarded = await request(app).post(`/jobs/${jobId}/allocate`).set('Authorization', auth('customer', 'owner1'));
      expect(awarded.status).toBe(400);
    });
  });

  describe('POST /jobs/:id/offers/:offerId/quote', () => {
    const offer = (overrides = {}) => ({
      _id: offerId,
      job: { toString: () => jobId },
      cleaner: { toString: () => 'my-profile' },
      status: 'sent',
      ...overrides,
    });
    const send = (body, role = 'cleaner') =>
      request(app).post(`/jobs/${jobId}/offers/${offerId}/quote`).set('Authorization', auth(role, 'user2')).send(body);

    beforeEach(() => {
      Job.findById.mockResolvedValue(openTender());
      JobOffer.findById.mockResolvedValue(offer());
      CleanerProfile.findOne.mockResolvedValue({ _id: 'my-profile', name: 'Sam' });
      JobOffer.findOneAndUpdate.mockImplementation(async (filter, update) => ({ _id: offerId, ...update.$set }));
    });

    it('stores the cleaner\'s own price and hides contact details in the note', async () => {
      const res = await send({ pricePence: 125000, message: 'Happy to start Monday, call 07700 900123 or bob@gmail.com' });
      expect(res.status).toBe(200);
      expect(JobOffer.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: offerId, status: { $in: ['sent', 'quoted'] } },
        { $set: expect.objectContaining({ status: 'quoted', quotePricePence: 125000, quoteMessage: 'Happy to start Monday, call [contact details hidden] or [contact details hidden]' }) },
        { new: true }
      );
      expect(notifications.quoteReceived).toHaveBeenCalled();
    });

    it('lets a cleaner revise a quote while the tender is open', async () => {
      JobOffer.findById.mockResolvedValue(offer({ status: 'quoted' }));
      expect((await send({ pricePence: 120000 })).status).toBe(200);
    });

    it('is cleaner-only, validates the price, and only for your own invitation', async () => {
      expect((await send({ pricePence: 1000 }, 'customer')).status).toBe(403);
      expect((await send({ pricePence: -5 })).status).toBe(400);
      expect((await send({ pricePence: 12.5 })).status).toBe(400);
      CleanerProfile.findOne.mockResolvedValue({ _id: 'someone-else' });
      expect((await send({ pricePence: 1000 })).status).toBe(403);
    });

    it('refuses after the tender closes, on a standard job, or once awarded', async () => {
      Job.findById.mockResolvedValue(openTender({ tender: { closesAt: new Date(Date.now() - 1000) } }));
      expect((await send({ pricePence: 1000 })).status).toBe(400);
      Job.findById.mockResolvedValue(openTender({ procurement: 'standard' }));
      expect((await send({ pricePence: 1000 })).status).toBe(400);
      Job.findById.mockResolvedValue(openTender({ cleaner: 'x' }));
      expect((await send({ pricePence: 1000 })).status).toBe(400);
    });
  });

  describe('POST /jobs/:id/offers/:offerId/award', () => {
    const award = (role = 'customer', id = 'owner1') =>
      request(app).post(`/jobs/${jobId}/offers/${offerId}/award`).set('Authorization', auth(role, id));
    const quoted = (overrides = {}) => ({
      _id: offerId,
      job: { toString: () => jobId },
      cleaner: 'winner-profile',
      status: 'quoted',
      quotePricePence: 125000,
      ...overrides,
    });

    beforeEach(() => {
      Job.findById.mockResolvedValue(openTender());
      JobOffer.findById.mockResolvedValue(quoted());
      CleanerProfile.findById.mockResolvedValue({ _id: 'winner-profile', name: 'Sam' });
      JobOffer.findOneAndUpdate.mockResolvedValue({ _id: offerId, status: 'accepted' });
      Job.findOneAndUpdate.mockResolvedValue({ _id: jobId, cleaner: 'winner-profile' });
      JobOffer.find.mockResolvedValue([
        { cleaner: 'loser-1', status: 'quoted' },
        { cleaner: 'loser-2', status: 'sent' },
      ]);
      JobOffer.updateMany.mockResolvedValue({ modifiedCount: 2 });
      paymentService.bookJob.mockResolvedValue({ _id: jobId, paymentStatus: 'BOOKED', pricePence: 125000 });
    });

    it('books at the cleaner\'s quote, declines the others and tells the unsuccessful bidders', async () => {
      const res = await award();
      expect(res.status).toBe(200);
      expect(paymentService.bookJob).toHaveBeenCalledWith({ jobId, cleanerId: 'winner-profile', pricePence: 125000 });
      expect(JobOffer.findOneAndUpdate).toHaveBeenCalledWith({ _id: offerId, status: 'quoted' }, { $set: { status: 'accepted' } }, { new: true });
      expect(JobOffer.updateMany).toHaveBeenCalledWith(
        { job: jobId, _id: { $ne: offerId }, status: { $in: ['sent', 'quoted'] } },
        { $set: { status: 'declined' } }
      );
      expect(notifications.tenderAwarded).toHaveBeenCalled();
      // Only the cleaner who actually sent a quote is told they lost.
      expect(notifications.tenderNotAwarded.mock.calls[0][1]).toEqual([{ cleaner: 'loser-1', status: 'quoted' }]);
    });

    it('only the job\'s customer can award', async () => {
      expect((await award('customer', 'someone-else')).status).toBe(403);
      expect((await award('cleaner')).status).toBe(403);
      expect(paymentService.bookJob).not.toHaveBeenCalled();
    });

    it('cannot award a cleaner who has not quoted, a suspended cleaner, or an already-awarded tender', async () => {
      JobOffer.findById.mockResolvedValue(quoted({ status: 'sent', quotePricePence: undefined }));
      expect((await award()).status).toBe(400);

      JobOffer.findById.mockResolvedValue(quoted());
      CleanerProfile.findById.mockResolvedValue({ _id: 'winner-profile', deactivationStatus: 'suspended' });
      expect((await award()).status).toBe(400);

      Job.findById.mockResolvedValue(openTender({ cleaner: 'x' }));
      expect((await award()).status).toBe(400);
      expect(paymentService.bookJob).not.toHaveBeenCalled();
    });

    it('is safe against a second award at the same moment', async () => {
      Job.findOneAndUpdate.mockResolvedValue(null); // lost the race
      const res = await award();
      expect(res.status).toBe(409);
      expect(paymentService.bookJob).not.toHaveBeenCalled();
    });
  });

  describe('withdrawing a quote', () => {
    it('lets a cleaner who has quoted decline, so they drop out of the tender', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      JobOffer.findById.mockResolvedValue({
        _id: offerId,
        job: { toString: () => jobId },
        cleaner: { toString: () => 'my-profile' },
        status: 'quoted',
        save,
      });
      CleanerProfile.findOne.mockResolvedValue({ _id: 'my-profile' });
      const res = await request(app)
        .post(`/jobs/${jobId}/offers/${offerId}/decline`)
        .set('Authorization', auth('cleaner', 'user2'));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('declined');
      expect(save).toHaveBeenCalled();
    });
  });

  describe('standard accept on a tender job', () => {
    it('is refused: cleaners must send a quote', async () => {
      Job.findById.mockResolvedValue(openTender());
      const res = await request(app)
        .post(`/jobs/${jobId}/offers/${offerId}/accept`)
        .set('Authorization', auth('cleaner', 'user2'))
        .send({ pricePence: 5000 });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/quote/i);
      expect(paymentService.bookJob).not.toHaveBeenCalled();
    });
  });
});
