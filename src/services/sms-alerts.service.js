const User = require('../models/User');
const smsService = require('./sms.service');

// Text alerts are a service message ("a job offer is waiting"), never marketing, and they are
// off until the person turns them on. The wording they agree to is versioned: change the text,
// change the version, and the old agreement no longer matches.
const CONSENT = {
  version: 'sms-2026-11',
  text:
    'Text me on this number when something needs my attention on CleanOps Connect, such as a new job offer or a ' +
    'payment step. The texts are short, never advertising, and say nothing about the job itself. I can turn them off ' +
    'here at any time, which deletes this number.',
};

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function view(user) {
  const sms = (user && user.smsAlerts) || {};
  return {
    enabled: Boolean(sms.enabled && sms.mobile),
    mobile: sms.enabled && sms.mobile ? sms.mobile : undefined,
    configured: smsService.isConfigured(),
    consent: { version: CONSENT.version, text: CONSENT.text },
  };
}

async function getSettings(userId) {
  return view(await User.findById(userId));
}

async function enable(userId, { mobile, consent, consentVersion }) {
  if (consent !== true) throw httpError(400, 'Please tick the box to agree');
  if (consentVersion !== CONSENT.version) throw httpError(409, 'The wording has changed. Please reload the page and read it again.');
  const number = smsService.normaliseUkMobile(mobile);
  if (!number) throw httpError(400, 'Enter a UK mobile number, for example 07123 456789');

  const user = await User.findByIdAndUpdate(
    userId,
    { $set: { 'smsAlerts.enabled': true, 'smsAlerts.mobile': number, 'smsAlerts.consentAt': new Date(), 'smsAlerts.consentVersion': CONSENT.version }, $unset: { 'smsAlerts.disabledAt': 1 } },
    { new: true }
  );
  if (!user) throw httpError(404, 'Account not found');
  return view(user);
}

// Turning off deletes the number.
async function disable(userId) {
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: { 'smsAlerts.enabled': false, 'smsAlerts.disabledAt': new Date() }, $unset: { 'smsAlerts.mobile': 1 } },
    { new: true }
  );
  if (!user) throw httpError(404, 'Account not found');
  return view(user);
}

module.exports = { CONSENT, getSettings, enable, disable };
