const { z } = require('zod');
const { objectId } = require('./common');

const seriesIdParamSchema = z.object({ id: objectId() });
const seriesVisitParamSchema = z.object({ id: objectId(), jobId: objectId() });

const listSeriesQuerySchema = z.object({
  status: z.enum(['awaiting_card', 'active', 'paused', 'cancelled', 'ended']).optional(),
});

module.exports = { seriesIdParamSchema, seriesVisitParamSchema, listSeriesQuerySchema };
