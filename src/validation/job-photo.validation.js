const { z } = require('zod');
const { objectId } = require('./common');

const photoParamSchema = z.object({ id: objectId(), photoId: objectId() });
const jobParamSchema = z.object({ id: objectId() });
const uploadQuerySchema = z.object({
  kind: z.enum(['before', 'after', 'problem']),
  filename: z.string().max(200).optional(),
});

module.exports = { photoParamSchema, jobParamSchema, uploadQuerySchema };
