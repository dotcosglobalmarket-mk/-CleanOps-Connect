const chatService = require('../services/chat.service');

const HEARTBEAT_MS = 25 * 1000;

async function list(req, res, next) {
  try {
    res.status(200).json(await chatService.listMessages(req.params.id, req.user, req.query));
  } catch (err) {
    next(err);
  }
}

async function send(req, res, next) {
  try {
    res.status(201).json(await chatService.sendMessage(req.params.id, req.user, req.body.body));
  } catch (err) {
    next(err);
  }
}

async function unread(req, res, next) {
  try {
    res.status(200).json(await chatService.unreadSummary(req.user));
  } catch (err) {
    next(err);
  }
}

// Server-sent events. The client reads this with fetch() so the normal
// Authorization header is used (EventSource cannot send one).
async function stream(req, res, next) {
  try {
    const { role } = await chatService.requireParticipant(req.params.id, req.user);

    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 5000\n\n');

    const unsubscribe = chatService.subscribe(req.params.id, (message) => {
      // The sender already has their own message from the POST response.
      if (message.senderRole === role) return;
      res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, send, unread, stream };
