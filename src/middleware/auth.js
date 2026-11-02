const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { STAFF_ROLES, hasPermission } = require('../config/permissions');
const { isCurrent } = require('../services/session.service');

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const token = authHeader.slice('Bearer '.length);

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }

  try {
    // A session carries the version it was issued under. A password reset, a
    // two-step login reset or a deactivation raises the version, which ends
    // every earlier session. Impersonation tokens are short and carry no version.
    if (payload.tv !== undefined && !payload.imp) {
      const user = await User.findById(payload.sub);
      if (!isCurrent(payload, user)) {
        return res.status(401).json({ message: 'Your session has ended. Please log in again.' });
      }
    }

    req.user = { id: payload.sub, role: payload.role };

    // Impersonation tokens (see impersonation.service.js) carry the real
    // admin's id in `imp`. These tokens are read-only everywhere: a staff
    // member diagnosing a support ticket can see exactly what the cleaner
    // sees, but can never act on their behalf.
    if (payload.imp) {
      req.user.impersonatedBy = payload.imp;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return res.status(403).json({ message: 'This is a read-only support view and cannot make changes' });
      }
    }

    next();
  } catch (err) {
    next(err);
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

// For routes open to staff and to other roles: staff are re-checked against the
// database (a staff JWT lasts 7 days), everyone else passes straight through.
function requireActiveIfStaff(req, res, next) {
  if (req.user && STAFF_ROLES.includes(req.user.role)) return requireActiveStaff(req, res, next);
  return next();
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
  requireActiveIfStaff,
  requirePermission,
};
