jest.mock('../../src/models/CleanerProfile', () => {
  const CleanerProfileMock = jest.fn();
  CleanerProfileMock.findById = jest.fn();
  CleanerProfileMock.findOne = jest.fn();
  return CleanerProfileMock;
});
jest.mock('../../src/services/mapbox.service', () => ({ geocodePostcode: jest.fn() }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const CleanerProfile = require('../../src/models/CleanerProfile');
const mapboxService = require('../../src/services/mapbox.service');

function authHeaderFor(role, id = 'user1') {
  const token = jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

describe('Cleaners routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  describe('POST /cleaners', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).post('/cleaners').send({ name: 'Bob', basePostcode: 'SW1A 1AA' });
      expect(res.status).toBe(401);
    });

    it('returns 403 for a non-cleaner role', async () => {
      const res = await request(app)
        .post('/cleaners')
        .set('Authorization', authHeaderFor('customer'))
        .send({ name: 'Bob', basePostcode: 'SW1A 1AA' });
      expect(res.status).toBe(403);
    });

    it('geocodes the postcode and sets user from the authenticated user', async () => {
      mapboxService.geocodePostcode.mockResolvedValue({ lat: 51.5, lng: -0.1 });
      const saveMock = jest.fn().mockResolvedValue(undefined);
      CleanerProfile.mockImplementation(function (data) {
        Object.assign(this, data);
        this.save = saveMock;
      });

      const res = await request(app)
        .post('/cleaners')
        .set('Authorization', authHeaderFor('cleaner', 'cleanerUser1'))
        .send({ name: 'Bob', basePostcode: 'SW1A 1AA', user: 'someone-else' });

      expect(res.status).toBe(201);
      expect(res.body.user).toBe('cleanerUser1');
      expect(res.body.lat).toBe(51.5);
      expect(saveMock).toHaveBeenCalledTimes(1);
    });

    it('ignores self-declared DBS / COSHH status — only an admin can verify compliance', async () => {
      mapboxService.geocodePostcode.mockResolvedValue({ lat: 51.5, lng: -0.1 });
      CleanerProfile.mockImplementation(function (data) {
        Object.assign(this, data);
        this.save = jest.fn().mockResolvedValue(undefined);
      });

      const res = await request(app)
        .post('/cleaners')
        .set('Authorization', authHeaderFor('cleaner', 'cleanerUser1'))
        .send({ name: 'Bob', basePostcode: 'SW1A 1AA', dbsVerified: true, coshhTrained: true });

      expect(res.status).toBe(201);
      expect(res.body.dbsVerified).toBeUndefined();
      expect(res.body.coshhTrained).toBeUndefined();
    });
  });

  describe('POST /cleaners/coverage', () => {
    const cleanerId = '507f1f77bcf86cd799439011';

    it('returns 400 when coverageType is radius but radiusKm is missing', async () => {
      const res = await request(app)
        .post('/cleaners/coverage')
        .set('Authorization', authHeaderFor('cleaner'))
        .send({ cleanerId, coverageType: 'radius' });
      expect(res.status).toBe(400);
    });

    it('returns 403 when the requester does not own the cleaner profile', async () => {
      CleanerProfile.findById.mockResolvedValue({ user: { toString: () => 'owner1' } });
      const res = await request(app)
        .post('/cleaners/coverage')
        .set('Authorization', authHeaderFor('cleaner', 'someone-else'))
        .send({ cleanerId, coverageType: 'radius', radiusKm: 15 });
      expect(res.status).toBe(403);
    });

    it('updates coverage for the owning cleaner', async () => {
      const saveMock = jest.fn().mockResolvedValue(undefined);
      CleanerProfile.findById.mockResolvedValue({
        user: { toString: () => 'owner1' },
        save: saveMock,
      });

      const res = await request(app)
        .post('/cleaners/coverage')
        .set('Authorization', authHeaderFor('cleaner', 'owner1'))
        .send({ cleanerId, coverageType: 'radius', radiusKm: 15 });

      expect(res.status).toBe(200);
      expect(res.body.coverageType).toBe('radius');
      expect(res.body.coverageRadiusKm).toBe(15);
      expect(saveMock).toHaveBeenCalledTimes(1);
    });

    it('allows an admin to update coverage for a cleaner they do not own', async () => {
      const saveMock = jest.fn().mockResolvedValue(undefined);
      CleanerProfile.findById.mockResolvedValue({
        user: { toString: () => 'owner1' },
        save: saveMock,
      });

      const res = await request(app)
        .post('/cleaners/coverage')
        .set('Authorization', authHeaderFor('admin', 'admin1'))
        .send({ cleanerId, coverageType: 'radius', radiusKm: 15 });

      expect(res.status).toBe(200);
    });
  });

  describe('GET /cleaners/me', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/cleaners/me');
      expect(res.status).toBe(401);
    });

    it('returns 403 for a non-cleaner role', async () => {
      const res = await request(app).get('/cleaners/me').set('Authorization', authHeaderFor('customer'));
      expect(res.status).toBe(403);
    });

    it('returns 404 when the cleaner has not registered a profile', async () => {
      CleanerProfile.findOne.mockResolvedValue(null);
      const res = await request(app).get('/cleaners/me').set('Authorization', authHeaderFor('cleaner', 'user1'));
      expect(res.status).toBe(404);
    });

    it("returns the authenticated cleaner's own profile", async () => {
      CleanerProfile.findOne.mockResolvedValue({ user: 'user1', name: 'Bob', bio: 'Experienced cleaner' });
      const res = await request(app).get('/cleaners/me').set('Authorization', authHeaderFor('cleaner', 'user1'));
      expect(res.status).toBe(200);
      expect(CleanerProfile.findOne).toHaveBeenCalledWith({ user: 'user1' });
      expect(res.body.bio).toBe('Experienced cleaner');
    });
  });

  describe('PATCH /cleaners/me', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).patch('/cleaners/me').send({ bio: 'Hello' });
      expect(res.status).toBe(401);
    });

    it('returns 400 for an invalid body', async () => {
      const res = await request(app)
        .patch('/cleaners/me')
        .set('Authorization', authHeaderFor('cleaner', 'user1'))
        .send({ startTime: 'not-a-time' });
      expect(res.status).toBe(400);
    });

    it('returns 404 when the cleaner has not registered a profile', async () => {
      CleanerProfile.findOne.mockResolvedValue(null);
      const res = await request(app)
        .patch('/cleaners/me')
        .set('Authorization', authHeaderFor('cleaner', 'user1'))
        .send({ bio: 'Hello' });
      expect(res.status).toBe(404);
    });

    it("updates the authenticated cleaner's own profile", async () => {
      const saveMock = jest.fn().mockResolvedValue(undefined);
      const cleaner = { user: 'user1', bio: 'Old bio', save: saveMock };
      CleanerProfile.findOne.mockResolvedValue(cleaner);

      const res = await request(app)
        .patch('/cleaners/me')
        .set('Authorization', authHeaderFor('cleaner', 'user1'))
        .send({ bio: 'New bio', hourlyRate: 25, workingDays: ['mon', 'tue'] });

      expect(res.status).toBe(200);
      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(res.body.bio).toBe('New bio');
      expect(res.body.hourlyRate).toBe(25);
      expect(res.body.workingDays).toEqual(['mon', 'tue']);
    });
  });

  describe('GET /cleaners/:id', () => {
    it('returns 400 for a malformed id', async () => {
      const res = await request(app).get('/cleaners/not-an-object-id');
      expect(res.status).toBe(400);
    });

    it('returns 404 when the cleaner does not exist', async () => {
      CleanerProfile.findById.mockResolvedValue(null);
      const res = await request(app).get('/cleaners/507f1f77bcf86cd799439011');
      expect(res.status).toBe(404);
    });

    it('returns only the public profile — no contact details, address, coordinates or Stripe data', async () => {
      CleanerProfile.findById.mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        name: 'Bob',
        basePostcode: 'LS12 1AB',
        lat: 53.79,
        lng: -1.59,
        dbsVerified: true,
        ratingAverage: 4.8,
        phoneNumber: '07700 900000',
        contactEmail: 'bob@example.com',
        stripeConnectedAccountId: 'acct_123',
        commissionTierRate: 0.15,
        deactivationStatus: 'active',
      });

      const res = await request(app).get('/cleaners/507f1f77bcf86cd799439011');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'Bob', dbsVerified: true, ratingAverage: 4.8, area: 'LS12' });
      ['basePostcode', 'lat', 'lng', 'phoneNumber', 'contactEmail', 'stripeConnectedAccountId', 'commissionTierRate'].forEach(
        (field) => expect(res.body[field]).toBeUndefined()
      );
    });

    it('returns 404 for a suspended cleaner', async () => {
      CleanerProfile.findById.mockResolvedValue({ _id: '507f1f77bcf86cd799439011', name: 'Bob', deactivationStatus: 'suspended' });
      const res = await request(app).get('/cleaners/507f1f77bcf86cd799439011');
      expect(res.status).toBe(404);
    });
  });
});
