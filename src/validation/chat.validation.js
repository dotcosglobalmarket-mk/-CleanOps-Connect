const { z } = require('zod');
const { objectId } = require('./common');

const jobIdParamSchema = z.object({ id: objectId() });

const listMessagesQuerySchema = z.object({
  // Only messages after this message id (for polling).
  after: objectId().optional(),
});

const sendMessageSchema = z.object({
  body: z.string().trim().min(1, 'Write a message first').max(1000, 'Messages can be up to 1000 characters'),
});

module.exports = { jobIdParamSchema, listMessagesQuerySchema, sendMessageSchema };
