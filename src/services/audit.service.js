const AuditLog = require('../models/AuditLog');

const AUDIT_LIST_LIMIT = 200;

// Staff activity is kept for 12 months. The record behind a refund, payout or
// dispute decision is kept for 6 years, as long as the payment record it explains.
const DAY_MS = 24 * 60 * 60 * 1000;
const STANDARD_RETENTION_DAYS = 365;
const FINANCIAL_RETENTION_DAYS = 6 * 365;
const FINANCIAL_ACTION_PREFIXES = ['dispute.', 'approval.', 'payout.'];

const isFinancialAction = (action) => FINANCIAL_ACTION_PREFIXES.some((prefix) => String(action).startsWith(prefix));

function expiryFor(action, from = new Date()) {
  const days = isFinancialAction(action) ? FINANCIAL_RETENTION_DAYS : STANDARD_RETENTION_DAYS;
  return new Date(new Date(from).getTime() + days * DAY_MS);
}

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
    expireAt: expiryFor(action),
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
  expiryFor,
  isFinancialAction,
  STANDARD_RETENTION_DAYS,
  FINANCIAL_RETENTION_DAYS,
  record,
  listForTarget,
  list,
};
