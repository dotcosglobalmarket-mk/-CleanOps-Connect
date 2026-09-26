const { z } = require('zod');
const { reason } = require('./ops.validation');

const createReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

const latestReviewsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

const moderationQuerySchema = z.object({
  status: z.enum(['published', 'hidden']).optional(),
});

const setReviewVisibilitySchema = z.object({
  hidden: z.boolean(),
  reason,
});

module.exports = {
  createReviewSchema,
  latestReviewsQuerySchema,
  moderationQuerySchema,
  setReviewVisibilitySchema,
};
