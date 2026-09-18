jest.mock('../../src/models/ServiceType', () => ({
  find: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const ServiceType = require('../../src/models/ServiceType');

function authHeaderFor(role, id = 'user1') {
  const token = jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

describe('Service types routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  describe('GET /service-types', () => {
    it('returns the list of service types with no auth required', async () => {
      const sort = jest.fn().mockResolvedValue([
        { _id: '507f1f77bcf86cd799439011', name: 'Domestic Deep Clean', category: 'domestic' },
      ]);
      ServiceType.find.mockReturnValue({ sort });

      const res = await request(app).get('/service-types');

      expect(res.status).toBe(200);
      expect(ServiceType.find).toHaveBeenCalledWith({});
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('Domestic Deep Clean');
    });

    it('filters by category when provided', async () => {
      const sort = jest.fn().mockResolvedValue([]);
      ServiceType.find.mockReturnValue({ sort });

      const res = await request(app).get('/service-types').query({ category: 'industrial' });

      expect(res.status).toBe(200);
      expect(ServiceType.find).toHaveBeenCalledWith({ category: 'industrial' });
    });

    it('returns 400 for an invalid category', async () => {
      const res = await request(app).get('/service-types').query({ category: 'not-a-category' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /service-types', () => {
    function validBody(overrides = {}) {
      return {
        name: 'Domestic Deep Clean',
        category: 'domestic',
        ...overrides,
      };
    }

    it('returns 401 without auth', async () => {
      const res = await request(app).post('/service-types').send(validBody());
      expect(res.status).toBe(401);
    });

    it('returns 403 for a non-admin role', async () => {
      const res = await request(app)
        .post('/service-types')
        .set('Authorization', authHeaderFor('customer'))
        .send(validBody());
      expect(res.status).toBe(403);
    });

    it('returns 400 for an invalid body', async () => {
      const res = await request(app)
        .post('/service-types')
        .set('Authorization', authHeaderFor('admin'))
        .send({});
      expect(res.status).toBe(400);
    });

    it('creates a service type for an admin', async () => {
      ServiceType.create.mockResolvedValue({ _id: '507f1f77bcf86cd799439011', ...validBody() });

      const res = await request(app)
        .post('/service-types')
        .set('Authorization', authHeaderFor('admin'))
        .send(validBody());

      expect(res.status).toBe(201);
      expect(ServiceType.create).toHaveBeenCalledWith(validBody());
      expect(res.body.name).toBe('Domestic Deep Clean');
    });
  });

  describe('PATCH /service-types/:id', () => {
    const id = '507f1f77bcf86cd799439011';

    it('returns 401 without auth', async () => {
      const res = await request(app).patch(`/service-types/${id}`).send({ name: 'New name' });
      expect(res.status).toBe(401);
    });

    it('returns 403 for a non-admin role', async () => {
      const res = await request(app)
        .patch(`/service-types/${id}`)
        .set('Authorization', authHeaderFor('customer'))
        .send({ name: 'New name' });
      expect(res.status).toBe(403);
    });

    it('returns 400 for an empty body', async () => {
      const res = await request(app)
        .patch(`/service-types/${id}`)
        .set('Authorization', authHeaderFor('admin'))
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 404 when the service type does not exist', async () => {
      ServiceType.findById.mockResolvedValue(null);
      const res = await request(app)
        .patch(`/service-types/${id}`)
        .set('Authorization', authHeaderFor('admin'))
        .send({ name: 'New name' });
      expect(res.status).toBe(404);
    });

    it('updates a service type for an admin', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      const serviceType = { _id: id, name: 'Old name', category: 'domestic', save };
      ServiceType.findById.mockResolvedValue(serviceType);

      const res = await request(app)
        .patch(`/service-types/${id}`)
        .set('Authorization', authHeaderFor('admin'))
        .send({ name: 'New name', requiresCoshh: true });

      expect(res.status).toBe(200);
      expect(serviceType.name).toBe('New name');
      expect(serviceType.requiresCoshh).toBe(true);
      expect(save).toHaveBeenCalledTimes(1);
    });
  });
});
