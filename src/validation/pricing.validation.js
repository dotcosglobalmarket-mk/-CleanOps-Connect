const { z } = require('zod');
const { objectId } = require('./common');

// `postcode` is a full UK postcode (customers) or just the district, e.g.
// "LS12" (cleaners only ever see the district). Only the district is used.
const priceGuideSchema = z.object({
  serviceType: objectId(),
  postcode: z.string().trim().min(2).max(10),
  estimatedHours: z.number().positive().max(1000).optional(),
});

module.exports = { priceGuideSchema };
