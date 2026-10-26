const { z } = require('zod');
const { objectId } = require('./common');

const uploadQuerySchema = z.object({
  type: z.enum(['dbs', 'coshh', 'insurance']),
  filename: z.string().max(200).optional(),
});

const listReviewQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'superseded', 'expired', 'withdrawn', 'all']).optional(),
});

const reviewSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().max(500).optional(),
  expiresAt: z.string().max(40).optional(),
});

const deleteFileSchema = z.object({ reason: z.string().trim().min(3).max(500) });

const documentIdParamSchema = z.object({ id: objectId() });

module.exports = { uploadQuerySchema, listReviewQuerySchema, reviewSchema, deleteFileSchema, documentIdParamSchema };
