const { z } = require('zod');
const { objectId } = require('./common');

const listServiceTypesQuerySchema = z.object({
  category: z.enum(['domestic', 'industrial']).optional(),
});

const createServiceTypeSchema = z.object({
  name: z.string().min(1),
  category: z.enum(['domestic', 'industrial']),
  description: z.string().optional(),
  requiresCoshh: z.boolean().optional(),
});

const serviceTypeIdParamSchema = z.object({
  id: objectId(),
});

const updateServiceTypeSchema = z
  .object({
    name: z.string().min(1).optional(),
    category: z.enum(['domestic', 'industrial']).optional(),
    description: z.string().optional(),
    requiresCoshh: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

module.exports = {
  listServiceTypesQuerySchema,
  createServiceTypeSchema,
  serviceTypeIdParamSchema,
  updateServiceTypeSchema,
};
