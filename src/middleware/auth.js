const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { STAFF_ROLES, hasPermission } = require('../config/permissions');

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const token = authHeader.slice('Bearer '.length);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    next();
  };
}

// Staff routes re-check the account on every request. A JWT is valid for 7
// days, so without this a deactivated operator (or one whose role changed)
// would keep access until their token expired.
async function requireActiveStaff(req, res, next) {
  if (!req.user || !STAFF_ROLES.includes(req.user.role)) {
    return res.status(403).json({ message: 'Insufficient permissions' });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user || user.active === false || user.role !== req.user.role) {
      return res.status(401).json({ message: 'Your staff account is not active. Please log in again.' });
    }
    req.user.name = user.name;
    next();
  } catch (err) {
    next(err);
  }
}

// Every listed permission is required.
function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!req.user || !permissions.every((permission) => hasPermission(req.user.role, permission))) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
  requireActiveStaff,
  requirePermission,
};
