const { z } = require('zod');
const User = require('../models/User');
const authService = require('./auth.service');
const logger = require('../utils/logger');

// Creates the first (super) admin account at start-up from SUPER_ADMIN_EMAIL
// and SUPER_ADMIN_PASSWORD (and an optional SUPER_ADMIN_NAME), so there is a
// way in before any other admin exists. After that, admins create operators
// and other admins from the admin dashboard.
//
// Deliberately cautious:
// - it only ever CREATES a new account, and only when no admin exists yet;
// - it never promotes or changes an account that already exists with that
//   email. Registration has no email verification, so promoting would let
//   anyone who registered that address first become admin;
// - the password is held to the same 12-character minimum as other staff,
//   is stored only as a hash, and is never logged.
// A problem is logged and skipped: it must never stop the API starting.

const MIN_PASSWORD_LENGTH = 12;
const emailSchema = z.string().email();

// ops@cleanop-connect.co.uk -> o**@cleanop-connect.co.uk (enough to recognise, not to reveal)
function maskEmail(email) {
  const [local = '', domain = ''] = String(email).split('@');
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

async function ensureSuperAdmin() {
  const rawEmail = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!rawEmail || !password) {
    const missing = [!rawEmail && 'SUPER_ADMIN_EMAIL', !password && 'SUPER_ADMIN_PASSWORD'].filter(Boolean);
    logger.info(`Super admin setup skipped: ${missing.join(' and ')} not set in this environment`);
    return { status: 'not_configured', missing };
  }

  const email = rawEmail.trim().toLowerCase();
  if (!emailSchema.safeParse(email).success) {
    logger.error('SUPER_ADMIN_EMAIL is not a valid email address: no admin account created');
    return { status: 'invalid_email' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    logger.error(`SUPER_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters: no admin account created`);
    return { status: 'weak_password' };
  }

  if (password !== password.trim()) {
    logger.info('SUPER_ADMIN_PASSWORD starts or ends with a space; it is used exactly as typed, spaces included');
  }

  const admins = await User.find({ role: 'admin' }).select('email active').lean();
  if (admins.length) {
    const list = admins.map((a) => `${maskEmail(a.email)}${a.active === false ? ' (disabled)' : ''}`).join(', ');
    const match = admins.some((a) => a.email === email);
    logger.info(
      `Super admin setup skipped: an admin already exists (${list}). ` +
        (match
          ? 'SUPER_ADMIN_EMAIL matches it, but its existing password is never overwritten by a restart.'
          : 'SUPER_ADMIN_EMAIL does not match it, so that email has no account; log in with the existing admin.')
    );
    return { status: 'admin_exists' };
  }

  if (await User.exists({ email })) {
    logger.error(
      `An account with the SUPER_ADMIN_EMAIL address (${email}) already exists and is not an admin. ` +
        'It was left unchanged. Remove that account, or use a different SUPER_ADMIN_EMAIL.'
    );
    return { status: 'email_taken' };
  }

  try {
    await User.create({
      name: (process.env.SUPER_ADMIN_NAME || 'Super Admin').trim(),
      email,
      passwordHash: await authService.hashPassword(password),
      role: 'admin',
      active: true,
    });
  } catch (err) {
    // Two instances starting together: the other one created it first.
    if (err && err.code === 11000) return { status: 'admin_exists' };
    logger.error(`Could not create the super admin account: ${err.message}`);
    return { status: 'error' };
  }

  logger.info(`Super admin account created for ${email}. You can now log in at login.html.`);
  return { status: 'created' };
}

module.exports = { ensureSuperAdmin, MIN_PASSWORD_LENGTH };
