const AuditLog = require('../models/AuditLog');

const AUDIT_LIST_LIMIT = 200;

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

// Records one staff action. `req` supplies the actor (from requireAuth /
// requireActiveStaff) and the client IP. A reason is mandatory: an audit
// entry that doesn't say why is not useful when a decision is challenged.
async function record({ req, action, targetType, targetId, before, after, reason }) {
  if (!reason || !String(reason).trim()) {
    throw badRequest('A reason is required for this action');
  }

  return AuditLog.create({
    actor: req.user.id,
    actorRole: req.user.role,
    action,
    targetType,
    targetId,
    before,
    after,
    reason: String(reason).trim(),
    ip: req.ip,
  });
}

async function listForTarget(targetType, targetId) {
  return AuditLog.find({ targetType, targetId }).populate('actor', 'name role').sort({ createdAt: -1 });
}

async function list({ actor, action, from, to } = {}) {
  const filter = {};
  if (actor) filter.actor = actor;
  if (action) filter.action = action;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  return AuditLog.find(filter).populate('actor', 'name role').sort({ createdAt: -1 }).limit(AUDIT_LIST_LIMIT);
}

module.exports = {
  record,
  listForTarget,
  list,
};
