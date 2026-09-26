// Role -> permission map for staff accounts. Operators are internal ops
// staff with least-privilege access; admins hold everything operators have
// plus the actions that need separation of duties (suspending cleaners,
// approving large refunds, managing staff, reading the full audit log).

const STAFF_ROLES = ['operator', 'admin'];

const OPERATOR_PERMISSIONS = [
  'summary.read',
  'jobs.read',
  'jobs.note',
  'cleaners.read',
  'cleaners.verify',
  'cleaners.review',
  'disputes.read',
  'disputes.resolve',
  'payments.queue.read',
  'payments.retry',
];

const ADMIN_ONLY_PERMISSIONS = [
  'cleaners.suspend',
  'refunds.over_limit',
  'approvals.decide',
  'audit.read',
  'users.manage',
  'service_types.manage',
];

const ROLE_PERMISSIONS = Object.freeze({
  operator: new Set(OPERATOR_PERMISSIONS),
  admin: new Set([...OPERATOR_PERMISSIONS, ...ADMIN_ONLY_PERMISSIONS]),
});

function hasPermission(role, permission) {
  const permissions = ROLE_PERMISSIONS[role];
  return Boolean(permissions && permissions.has(permission));
}

module.exports = {
  STAFF_ROLES,
  ROLE_PERMISSIONS,
  hasPermission,
};
