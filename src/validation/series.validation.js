const { z } = require('zod');
const { objectId } = require('./common');

const seriesIdParamSchema = z.object({ id: objectId() });
const seriesVisitParamSchema = z.object({ id: objectId(), jobId: objectId() });

module.exports = { seriesIdParamSchema, seriesVisitParamSchema };
