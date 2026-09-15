const { z } = require('zod');
const { objectId } = require('./common');

const createCleanerSchema = z.object({
  name: z.string().min(1),
  companyName: z.string().optional(),
  basePostcode: z.string().min(1),
  services: z.array(objectId()).optional(),
  dbsVerified: z.boolean().optional(),
  coshhTrained: z.boolean().optional(),
});

const geoJsonPolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1),
});

const coverageSchema = z.discriminatedUnion('coverageType', [
  z.object({
    cleanerId: objectId(),
    coverageType: z.literal('radius'),
    radiusKm: z.number().positive(),
  }),
  z.object({
    cleanerId: objectId(),
    coverageType: z.literal('polygon'),
    polygon: geoJsonPolygonSchema,
  }),
]);

const cleanerIdParamSchema = z.object({
  id: objectId(),
});

module.exports = {
  createCleanerSchema,
  coverageSchema,
  cleanerIdParamSchema,
};
