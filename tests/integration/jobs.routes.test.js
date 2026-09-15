jest.mock('../../src/models/Job', () => {
  const JobMock = jest.fn();
  JobMock.findById = jest.fn();
  return JobMock;
});
jest.mock('../../src/models/JobOffer', () => ({ insertMany: jest.fn() }));
jest.mock('../../src/models/CleanerProfile', () => ({ find: jest.fn() }));
jest.mock('../../src/services/mapbox.service', () => ({ geocodePostcode: jest.fn() }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const Job = require('../../src/models/Job');
const JobOffer = require('../../src/models/JobOffer');
const CleanerProfile = require('../../src/models/CleanerProfile');
const mapboxService = require('../../src/services/mapbox.service');

function authHeaderFor(role, id = 'user1') {
  const token = jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

function validJobBody(overrides = {}) {
  return {
    serviceType: '507f1f77bcf86cd799439011',
    category: 'domestic',
    postcode: 'SW1A 1AA',
    budgetMin: 50,
    budgetMax: 100,
    ...overrides,
  };
}

describe('Jobs routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  describe('POST /jobs', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).post('/jobs').send(validJobBody());
      expect(res.status).toBe(401);
    });

    it('returns 403 for a non-customer role', async () => {
      const res = await request(app)
        .post('/jobs')
        .set('Authorization', authHeaderFor('cleaner'))
        .send(validJobBody());
      expect(res.status).toBe(403);
    });

    it('returns 400 for an invalid body', async () => {
      const res = await request(app)
        .post('/jobs')
        .set('Authorization', authHeaderFor('customer'))
        .send({});
      expect(res.status).toBe(400);
    });

    it('geocodes the postcode and sets customer from the authenticated user, ignoring any client-supplied customer', async () => {
      mapboxService.geocodePostcode.mockResolvedValue({ lat: 51.5, lng: -0.1 });
      const saveMock = jest.fn().mockResolvedValue(undefined);
      Job.mockImplementation(function (data) {
        Object.assign(this, data);
        this.save = saveMock;
      });

      const res = await request(app)
        .post('/jobs')
        .set('Authorization', authHeaderFor('customer', 'user1'))
        .send(validJobBody({ customer: 'someone-else' }));

      expect(res.status).toBe(201);
      expect(mapboxService.geocodePostcode).toHaveBeenCalledWith('SW1A 1AA');
      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(res.body.customer).toBe('user1');
      expect(res.body.lat).toBe(51.5);
      expect(res.body.lng).toBe(-0.1);
    });
  });

  describe('GET /jobs/:id', () => {
    it('returns 400 for a malformed id', async () => {
      const res = await request(app).get('/jobs/not-an-object-id');
      expect(res.status).toBe(400);
    });

    it('returns 404 when the job does not exist', async () => {
      Job.findById.mockResolvedValue(null);
      const res = await request(app).get('/jobs/507f1f77bcf86cd799439011');
      expect(res.status).toBe(404);
    });

    it('returns the job when found', async () => {
      Job.findById.mockResolvedValue({ _id: '507f1f77bcf86cd799439011', status: 'open' });
      const res = await request(app).get('/jobs/507f1f77bcf86cd799439011');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('open');
    });
  });

  describe('POST /jobs/:id/allocate', () => {
    const jobId = '507f1f77bcf86cd799439011';

    it('returns 401 without auth', async () => {
      const res = await request(app).post(`/jobs/${jobId}/allocate`);
      expect(res.status).toBe(401);
    });

    it('returns 404 when the job does not exist', async () => {
      Job.findById.mockResolvedValue(null);
      const res = await request(app)
        .post(`/jobs/${jobId}/allocate`)
        .set('Authorization', authHeaderFor('customer', 'owner1'));
      expect(res.status).toBe(404);
    });

    it("returns 403 when the requester does not own the job", async () => {
      Job.findById.mockResolvedValue({ _id: jobId, customer: { toString: () => 'owner1' } });
      const res = await request(app)
        .post(`/jobs/${jobId}/allocate`)
        .set('Authorization', authHeaderFor('customer', 'someone-else'));
      expect(res.status).toBe(403);
    });

    it('allocates the job to the highest-scoring eligible cleaner', async () => {
      const job = {
        _id: jobId,
        customer: { toString: () => 'owner1' },
        serviceType: '507f1f77bcf86cd799439011',
        category: 'domestic',
        lat: 51.5074,
        lng: -0.1278,
        budgetMax: 100,
        status: 'open',
        save: jest.fn().mockResolvedValue(undefined),
      };
      Job.findById.mockResolvedValue(job);

      const strongCleaner = {
        _id: 'cleaner-strong',
        lat: 51.51,
        lng: -0.13,
        coverageType: 'radius',
        coverageRadiusKm: 10,
        experienceYears: 8,
        ratingAverage: 4.8,
        insuranceStatus: 'own',
        dbsVerified: true,
      };
      const weakCleaner = {
        _id: 'cleaner-weak',
        lat: 51.52,
        lng: -0.12,
        coverageType: 'radius',
        coverageRadiusKm: 10,
        experienceYears: 0,
        ratingAverage: 1,
        insuranceStatus: 'none',
        dbsVerified: false,
      };
      CleanerProfile.find.mockResolvedValue([weakCleaner, strongCleaner]);
      JobOffer.insertMany.mockResolvedValue([
        { cleaner: 'cleaner-strong', score: 90, status: 'sent' },
        { cleaner: 'cleaner-weak', score: 20, status: 'sent' },
      ]);

      const res = await request(app)
        .post(`/jobs/${jobId}/allocate`)
        .set('Authorization', authHeaderFor('customer', 'owner1'));

      expect(res.status).toBe(200);
      expect(job.status).toBe('allocated');
      expect(job.save).toHaveBeenCalledTimes(1);

      const insertedOffers = JobOffer.insertMany.mock.calls[0][0];
      expect(insertedOffers).toHaveLength(2);
      expect(insertedOffers[0].cleaner).toBe('cleaner-strong');
      expect(insertedOffers[0].score).toBeGreaterThan(insertedOffers[1].score);
    });
  });
});
