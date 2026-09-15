const mapboxService = require('../../src/services/mapbox.service');

describe('mapbox.service.geocodePostcode', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.MAPBOX_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.MAPBOX_API_KEY = originalApiKey;
  });

  it('throws when postcode is missing', async () => {
    await expect(mapboxService.geocodePostcode()).rejects.toThrow('postcode is required');
  });

  it('throws when MAPBOX_API_KEY is not set', async () => {
    delete process.env.MAPBOX_API_KEY;
    await expect(mapboxService.geocodePostcode('SW1A 1AA')).rejects.toThrow(
      'MAPBOX_API_KEY is not set in the environment'
    );
  });

  it('returns lat/lng from a successful Mapbox response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [{ center: [-0.1278, 51.5074] }] }),
    });

    const result = await mapboxService.geocodePostcode('SW1A 1AA');
    expect(result).toEqual({ lat: 51.5074, lng: -0.1278 });
  });

  it('throws when the Mapbox request fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(mapboxService.geocodePostcode('SW1A 1AA')).rejects.toThrow(
      'Mapbox geocoding request failed with status 500'
    );
  });

  it('throws when no match is found', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [] }) });
    await expect(mapboxService.geocodePostcode('ZZ99 9ZZ')).rejects.toThrow('Unable to geocode postcode');
  });
});
