const express = require('express');
const { rateLimit } = require('express-rate-limit');
const ChatController = require('../controllers/ChatController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');
const { jobIdParamSchema, listMessagesQuerySchema, sendMessageSchema } = require('../validation/chat.validation');

// In-app chat between a customer and the cleaner booked on their job.
const router = express.Router();

router.use(requireAuth, requireRole('customer', 'cleaner'));

// Per signed-in user, so one person sending a flood cannot drown a job.
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.CHAT_RATE_LIMIT_MAX) || 30,
  keyGenerator: (req) => req.user.id,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: "You're sending messages too quickly, please slow down" },
});

router.get('/unread', ChatController.unread);
router.get('/jobs/:id/messages', validateParams(jobIdParamSchema), validateQuery(listMessagesQuerySchema), ChatController.list);
router.post(
  '/jobs/:id/messages',
  sendLimiter,
  validateParams(jobIdParamSchema),
  validateBody(sendMessageSchema),
  ChatController.send
);
router.get('/jobs/:id/stream', validateParams(jobIdParamSchema), ChatController.stream);

module.exports = router;
