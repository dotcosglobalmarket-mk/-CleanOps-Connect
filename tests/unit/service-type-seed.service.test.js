jest.mock('../../src/models/ServiceType', () => ({
  findOneAndUpdate: jest.fn(),
}));

const ServiceType = require('../../src/models/ServiceType');
const {
  DEFAULT_SERVICE_TYPES,
  seedDefaultServiceTypes,
} = require('../../src/services/service-type-seed.service');

describe('service-type-seed.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ServiceType.findOneAndUpdate.mockResolvedValue({});
  });

  it('upserts every default service type by name', async () => {
    await seedDefaultServiceTypes();

    expect(ServiceType.findOneAndUpdate).toHaveBeenCalledTimes(DEFAULT_SERVICE_TYPES.length);
    DEFAULT_SERVICE_TYPES.forEach((serviceType) => {
      expect(ServiceType.findOneAndUpdate).toHaveBeenCalledWith(
        { name: serviceType.name },
        { $setOnInsert: serviceType },
        { upsert: true }
      );
    });
  });

  it('covers both domestic and industrial categories', () => {
    const categories = new Set(DEFAULT_SERVICE_TYPES.map((s) => s.category));
    expect(categories).toEqual(new Set(['domestic', 'industrial']));
  });
});
