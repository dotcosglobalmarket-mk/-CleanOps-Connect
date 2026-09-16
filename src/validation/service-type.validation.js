const { z } = require('zod');

const listServiceTypesQuerySchema = z.object({
  category: z.enum(['domestic', 'industrial']).optional(),
});

const createServiceTypeSchema = z.object({
  name: z.string().min(1),
  category: z.enum(['domestic', 'industrial']),
  description: z.string().optional(),
  requiresCoshh: z.boolean().optional(),
});

module.exports = {
  listServiceTypesQuerySchema,
  createServiceTypeSchema,
};
