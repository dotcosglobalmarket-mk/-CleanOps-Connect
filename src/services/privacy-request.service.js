const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const CleanerProfile = require('../models/CleanerProfile');
const CleanerDocument = require('../models/CleanerDocument');
const DocumentFile = require('../models/DocumentFile');
const Job = require('../models/Job');
const JobOffer = require('../models/JobOffer');
const JobNote = require('../models/JobNote');
const JobPhoto = require('../models/JobPhoto');
const Message = require('../models/Message');
const Review = require('../models/Review');
const Series = require('../models/Series');
const Subscription = require('../models/Subscription');
const SubscriptionPayment = require('../models/SubscriptionPayment');
const AuditLog = require('../models/AuditLog');
const stripeService = require('./stripe.service');
const auditService = require('./audit.service');
const { STATES } = require('./payment-state-machine');
const { STAFF_ROLES } = require('../config/permissions');

// A person's rights over their data (UK GDPR Arts. 15, 17, 20), done by an admin
// once the person's identity has been checked:
//
// - exportData: a copy of what we hold about them, as JSON.
// - erase: closes the account and removes or anonymises their personal data. What the
//   law makes us keep is kept: payment and job records for 6 years (HMRC), with the
//   free text and address details taken out. It never runs while money or a booking is
//   still in flight (see blockers).
//
// Both are recorded in the audit log (kept 6 years, so we can show the request was met).

const PAID_UP = [STATES.CANCELLED, STATES.PAID_OUT, STATES.REFUNDED, STATES.PARTIALLY_REFUNDED];
const LIVE_SERIES = ['awaiting_card', 'active', 'paused'];
const ERASED_NAME = 'Deleted user';

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// "LS12 1AB" -> "LS12": enough for an area, not an address.
function outwardCode(postcode) {
  if (!postcode) return undefined;
  const compact = String(postcode).replace(/\s+/g, '').toUpperCase();
  return compact.length > 3 ? compact.slice(0, -3) : compact;
}

async function requirePerson(userId) {
  const user = await User.findById(userId);
  if (!user) throw httpError(404, 'No such person');
  if (STAFF_ROLES.includes(user.role)) {
    throw httpError(400, 'Staff accounts are closed with Deactivate under Staff Accounts, not here');
  }
  return user;
}

const isCleaner = (user) => user.role === 'cleaner';
// Whose records these are. A cleaner who never saved a profile owns nothing, so the filter
// must match nothing: a bare `{ cleaner: undefined }` would match every unassigned job.
const NOTHING = { _id: { $in: [] } };
const ownerFilter = (user, cleaner) => {
  if (!isCleaner(user)) return { customer: user._id };
  return cleaner ? { cleaner: cleaner._id } : NOTHING;
};

// Reasons erasure cannot go ahead yet. Empty means it can.
async function blockers(user, cleaner) {
  const found = [];
  const open = await Job.find({ ...ownerFilter(user, cleaner), paymentStatus: { $nin: [...PAID_UP, null] } })
    .select('paymentStatus')
    .limit(50)
    .lean();
  if (open.length) {
    const states = [...new Set(open.map((j) => j.paymentStatus))].join(', ');
    found.push(`${open.length} booking${open.length === 1 ? '' : 's'} still in progress or with money to settle (${states}). Let them finish or resolve them first.`);
  }

  const series = await Series.countDocuments({ ...ownerFilter(user, cleaner), status: { $in: LIVE_SERIES } });
  if (series) found.push(`${series} regular booking${series === 1 ? ' is' : 's are'} still running. End ${series === 1 ? 'it' : 'them'} first.`);

  if (cleaner && (await Subscription.exists({ cleaner: cleaner._id, isActive: true }))) {
    found.push('They have an active subscription. Cancel it first.');
  }
  return found;
}

async function profileOf(user) {
  return isCleaner(user) ? CleanerProfile.findOne({ user: user._id }) : null;
}

async function lookup(email) {
  const user = await User.findOne({ email: String(email).trim().toLowerCase() });
  if (!user) throw httpError(404, 'No account with that email address');
  if (STAFF_ROLES.includes(user.role)) throw httpError(400, 'That is a staff account. Staff accounts are closed with Deactivate under Staff Accounts');

  const cleaner = await profileOf(user);
  const jobs = await Job.countDocuments(ownerFilter(user, cleaner));
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    active: user.active !== false,
    erasedAt: user.erasedAt || null,
    jobs,
    blockers: user.erasedAt ? [] : await blockers(user, cleaner),
  };
}

// --- A copy of their data ---

async function exportData(userId) {
  const user = await requirePerson(userId);
  const cleaner = await profileOf(user);
  const asCleaner = isCleaner(user);

  const jobFields = asCleaner
    ? 'serviceType category postcode estimatedHours frequency status paymentStatus pricePence cleanerPayoutPence bookedAt checkedInAt confirmedAt createdAt'
    : 'serviceType category postcode description estimatedHours frequency preferredStartAt budgetMin budgetMax procurement status paymentStatus pricePence disputeReason disputeDetail disputedAt bookedAt checkedInAt confirmedAt createdAt';
  const jobs = await Job.find(ownerFilter(user, cleaner)).select(jobFields).populate('serviceType', 'name').sort({ createdAt: 1 }).lean();
  const jobIds = jobs.map((j) => j._id);
  const where = ownerFilter(user, cleaner);

  const [offers, reviewsWritten, reviewsReceived, messages, documents, photos, subscriptions, subscriptionPayments, series, notes, audit] =
    await Promise.all([
      asCleaner && cleaner ? JobOffer.find({ cleaner: cleaner._id }).select('job status score quotePricePence quoteMessage quotedAt createdAt').lean() : [],
      asCleaner ? [] : Review.find({ customer: user._id }).select('job rating comment status createdAt').lean(),
      asCleaner && cleaner ? Review.find({ cleaner: cleaner._id }).select('job rating comment status createdAt').lean() : [],
      Message.find({ sender: user._id }).select('job senderRole body createdAt').sort({ createdAt: 1 }).lean(),
      asCleaner && cleaner
        ? CleanerDocument.find({ cleaner: cleaner._id }).select('type status originalName uploadedAt reviewedAt rejectionReason expiresAt fileDeletedAt').lean()
        : [],
      JobPhoto.find({ uploadedBy: user._id }).select('job kind originalName uploadedAt').lean(),
      asCleaner && cleaner ? Subscription.find({ cleaner: cleaner._id }).select('plan pricePence isActive stripeStatus createdAt').lean() : [],
      asCleaner && cleaner ? SubscriptionPayment.find({ cleaner: cleaner._id }).select('plan amountPence status occurredAt').lean() : [],
      Series.find(where).select('status frequency pricePence postcode firstVisitAt endsOn createdAt').lean(),
      jobIds.length ? JobNote.find({ job: { $in: jobIds } }).select('job body createdAt').lean() : [],
      AuditLog.find({ $or: [{ targetType: 'user', targetId: user._id }, ...(cleaner ? [{ targetType: 'cleaner', targetId: cleaner._id }] : [])] })
        .select('action actorRole createdAt reason')
        .lean(),
    ]);

  const account = {
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    createdAt: user.createdAt,
    active: user.active !== false,
    savedCard: user.savedCard && user.savedCard.last4
      ? {
          brand: user.savedCard.brand,
          last4: user.savedCard.last4,
          expMonth: user.savedCard.expMonth,
          expYear: user.savedCard.expYear,
          consentAt: user.savedCard.consentAt,
          consentVersion: user.savedCard.consentVersion,
        }
      : undefined,
    cardConsentLog: user.cardConsentLog,
    textAlerts: user.smsAlerts && (user.smsAlerts.enabled || user.smsAlerts.consentAt)
      ? {
          enabled: Boolean(user.smsAlerts.enabled),
          mobile: user.smsAlerts.mobile,
          consentAt: user.smsAlerts.consentAt,
          consentVersion: user.smsAlerts.consentVersion,
          disabledAt: user.smsAlerts.disabledAt,
        }
      : undefined,
  };

  let profile;
  if (cleaner) {
    const plain = cleaner.toObject ? cleaner.toObject() : { ...cleaner };
    const { photo, user: _owner, __v, ...rest } = plain;
    profile = { ...rest, hasProfilePicture: Boolean(photo && photo.file) };
  }

  // Other people's details (a cleaner's customers, for example) are left out: they are
  // not this person's data.
  const jobsOut = asCleaner ? jobs.map((j) => ({ ...j, postcode: outwardCode(j.postcode) })) : jobs;
  const seriesOut = asCleaner ? series.map((s) => ({ ...s, postcode: outwardCode(s.postcode) })) : series;

  return {
    generatedAt: new Date().toISOString(),
    about: 'A copy of the personal data CleanOps Connect (Ethnatcel Care Ltd) holds about you. Files you uploaded (certificates, photos) are not repeated here: you supplied them, and they are listed under documents and jobPhotos.',
    account,
    cleanerProfile: profile,
    jobs: jobsOut,
    regularBookings: seriesOut,
    offers,
    reviewsWritten,
    reviewsReceived,
    messagesSent: messages,
    documents,
    jobPhotos: photos,
    subscriptions,
    subscriptionPayments,
    ourRecordsOfActionsOnYourAccount: audit,
    staffNotesOnYourBookings: {
      reviewBeforeSending: 'Internal notes our team wrote about your bookings. Check them for other people\'s details before this copy is sent.',
      notes,
    },
  };
}

// --- Erasure ---

async function erase(userId, { confirmEmail, reason }, req) {
  const user = await requirePerson(userId);
  if (user.erasedAt) throw httpError(409, 'This account has already been erased');
  if (String(confirmEmail || '').trim().toLowerCase() !== String(user.email).toLowerCase()) {
    throw httpError(400, "The email you typed does not match this account's email");
  }
  if (!reason || String(reason).trim().length < 3) throw httpError(400, 'Say why the account is being erased');

  const cleaner = await profileOf(user);
  const stopping = await blockers(user, cleaner);
  if (stopping.length) throw httpError(409, `This account cannot be erased yet. ${stopping.join(' ')}`);

  const counts = {};

  // Stripe first: if it refuses, nothing here has changed and the request can simply be retried.
  const stripeIds = [user.stripeCustomerId, cleaner && cleaner.stripeCustomerId].filter(Boolean);
  for (const id of new Set(stripeIds)) await stripeService.deleteCustomer(id);
  counts.stripeCustomers = new Set(stripeIds).size;

  // Pictures and files they uploaded.
  const photos = await JobPhoto.find({ uploadedBy: user._id }).select('file').lean();
  const fileIds = photos.map((p) => p.file);
  if (cleaner && cleaner.photo && cleaner.photo.file) fileIds.push(cleaner.photo.file);
  if (cleaner) {
    const docs = await CleanerDocument.find({ cleaner: cleaner._id }).select('file').lean();
    docs.forEach((d) => d.file && fileIds.push(d.file));
    await CleanerDocument.updateMany(
      { cleaner: cleaner._id },
      { $set: { originalName: 'removed', fileDeletedAt: new Date() }, $unset: { rejectionReason: 1, file: 1 } }
    );
    counts.documents = docs.length;
  }
  if (fileIds.length) await DocumentFile.deleteMany({ _id: { $in: fileIds } });
  await JobPhoto.deleteMany({ uploadedBy: user._id });
  counts.files = fileIds.length;

  // Their words.
  const messages = await Message.deleteMany({ sender: user._id });
  counts.messages = messages.deletedCount || 0;

  if (isCleaner(user)) {
    if (cleaner) {
      await CleanerProfile.updateOne(
        { _id: cleaner._id },
        {
          $set: {
            name: ERASED_NAME,
            basePostcode: 'ERASED',
            services: [],
            customServices: [],
            available: false,
            deactivationStatus: 'suspended',
            payoutsEnabled: false,
            dbsVerified: false,
            coshhTrained: false,
            insuranceStatus: 'none',
          },
          $unset: {
            companyName: 1, bio: 1, phoneNumber: 1, contactEmail: 1, website: 1, instagram: 1, lat: 1, lng: 1,
            coveragePolygon: 1, photo: 1, selfEmploymentEvidenceRef: 1, stripeCustomerId: 1,
          },
        }
      );
      await JobOffer.updateMany({ cleaner: cleaner._id, status: { $in: ['sent', 'quoted'] } }, { $set: { status: 'expired' } });
    }
  } else {
    // Their bookings: the record stays (6 years), the address detail and free text go.
    const mine = await Job.find({ customer: user._id }).select('postcode').lean();
    for (const job of mine) {
      await Job.updateOne(
        { _id: job._id },
        { $set: { postcode: outwardCode(job.postcode) || 'ERASED', description: 'Removed at the customer\'s request' }, $unset: { lat: 1, lng: 1, disputeDetail: 1, 'tender.requirements': 1 } }
      );
    }
    counts.jobs = mine.length;
    const unbooked = await Job.find({ customer: user._id, paymentStatus: { $in: [null] }, status: { $nin: ['completed', 'cancelled'] } }).select('_id').lean();
    if (unbooked.length) {
      await Job.updateMany({ _id: { $in: unbooked.map((j) => j._id) } }, { $set: { status: 'cancelled' } });
      await JobOffer.updateMany({ job: { $in: unbooked.map((j) => j._id) }, status: { $in: ['sent', 'quoted'] } }, { $set: { status: 'expired' } });
    }
    await Series.updateMany({ customer: user._id }, { $set: { description: 'Removed at the customer\'s request' }, $unset: { lat: 1, lng: 1 } });
    // Their reviews stay as star ratings, without the words.
    await Review.updateMany({ customer: user._id }, { $unset: { comment: 1 } });
  }

  // The account itself. The row stays so the payment records still point somewhere.
  user.name = ERASED_NAME;
  user.email = `erased-${user._id}@erased.invalid`;
  user.phone = undefined;
  user.passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  user.stripeCustomerId = undefined;
  user.savedCard = undefined;
  user.smsAlerts = undefined;
  user.resetPasswordTokenHash = undefined;
  user.resetPasswordExpiresAt = undefined;
  user.active = false;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  user.erasedAt = new Date();
  await user.save();

  await auditService.record({
    req,
    action: 'user.erase',
    targetType: 'user',
    targetId: user._id,
    before: { role: user.role },
    after: { erased: true, counts },
    reason: `${String(reason).trim().slice(0, 450)} (identity checked)`,
  });
  return { erased: true, counts };
}

module.exports = { lookup, exportData, erase, blockers, outwardCode };
