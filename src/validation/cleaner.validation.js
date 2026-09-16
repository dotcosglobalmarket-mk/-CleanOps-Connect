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

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const updateMyProfileSchema = z.object({
  name: z.string().min(1).optional(),
  companyName: z.string().optional(),
  basePostcode: z.string().min(1).optional(),
  services: z.array(objectId()).optional(),
  available: z.boolean().optional(),
  bio: z.string().max(2000).optional(),
  hourlyRate: z.number().nonnegative().optional(),
  responseTime: z.string().max(200).optional(),
  travelDistanceMiles: z.number().nonnegative().optional(),
  phoneNumber: z.string().max(40).optional(),
  contactEmail: z.string().email().optional(),
  website: z.string().url().optional(),
  instagram: z.string().max(60).optional(),
  workingDays: z.array(z.enum(WEEKDAYS)).optional(),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM')
    .optional(),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM')
    .optional(),
  acceptEmergencyBookings: z.boolean().optional(),
  customServices: z.array(z.string().min(1)).optional(),
});

module.exports = {
  createCleanerSchema,
  coverageSchema,
  cleanerIdParamSchema,
  updateMyProfileSchema,
};
