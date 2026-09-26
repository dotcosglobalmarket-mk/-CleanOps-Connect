const User = require('../models/User');
const authService = require('./auth.service');
const auditService = require('./audit.service');
const { STAFF_ROLES } = require('../config/permissions');

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function toStaff(user) {
  return { ...authService.toPublicUser(user), active: user.active !== false, createdAt: user.createdAt };
}

async function listStaff({ role } = {}) {
  const users = await User.find({ role: role ? role : { $in: STAFF_ROLES } }).sort({ createdAt: -1 });
  return users.map(toStaff);
}

// Staff accounts are created by an admin only — never self-registered. The
// admin gives the initial password to the new staff member directly.
async function createStaff({ name, email, password, role }, req) {
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) throw httpError(409, 'Email already registered');

  const passwordHash = await authService.hashPassword(password);
  const user = await User.create({ name, email, passwordHash, role });

  await auditService.record({
    req,
    action: 'user.create',
    targetType: 'user',
    targetId: user._id,
    after: { email: user.email, role: user.role },
    reason: `Created ${role} account`,
  });
  return toStaff(user);
}

async function setStaffActive(userId, active, reason, req) {
  if (userId === req.user.id && active === false) {
    throw httpError(400, 'You cannot deactivate your own account');
  }

  const user = await User.findById(userId);
  if (!user || !STAFF_ROLES.includes(user.role)) throw httpError(404, 'Staff account not found');

  const before = { active: user.active !== false };
  user.active = active;
  await user.save();

  await auditService.record({
    req,
    action: active ? 'user.activate' : 'user.deactivate',
    targetType: 'user',
    targetId: user._id,
    before,
    after: { active },
    reason,
  });
  return toStaff(user);
}

module.exports = {
  listStaff,
  createStaff,
  setStaffActive,
};
