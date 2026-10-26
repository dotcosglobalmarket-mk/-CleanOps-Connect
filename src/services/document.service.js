const Job = require('../models/Job');
const CleanerProfile = require('../models/CleanerProfile');
const ServiceType = require('../models/ServiceType');
const User = require('../models/User');

// Printable job documents, generated as plain HTML (open and "Save as PDF").
//
// They only state what the platform has recorded. The compliance pack leaves
// the COSHH and risk-assessment content for the cleaner to complete: the
// platform does not know which products will be used, so it never invents
// hazard information or claims anyone is compliant.

const KINDS = ['service-record', 'compliance-pack'];

const COMPANY = {
  name: 'Ethnatcel Care Ltd, trading as CleanOps Connect',
  details: 'Registered in England and Wales, company number 12674639. Registered office: 27 Conqueror Way, Pontefract, WF8 2YJ.',
};

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dateTime(value) {
  if (!value) return 'Not recorded';
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/London' });
}

function pounds(pence) {
  return typeof pence === 'number' ? `£${(pence / 100).toFixed(2)}` : 'Not recorded';
}

const FREQUENCY = { one_off: 'One-off', weekly: 'Weekly', monthly: 'Monthly', contract: 'Contract' };

const PAYMENT_WORDS = {
  BOOKED: 'Booked, awaiting payment',
  PAID_HELD: 'Paid, held until the job is confirmed',
  IN_PROGRESS: 'Paid, job in progress',
  AWAITING_CONFIRMATION: 'Completed by the cleaner, awaiting the customer',
  DISPUTED: 'A problem has been reported and is under review',
  CONFIRMED: 'Confirmed complete',
  PAYOUT_PENDING: 'Confirmed complete',
  PAYOUT_BLOCKED: 'Confirmed complete',
  TRANSFER_FAILED: 'Confirmed complete',
  MANUAL_REVIEW_HOLD: 'Confirmed complete',
  PAID_OUT: 'Confirmed complete, cleaner paid',
  CANCELLED: 'Cancelled before payment',
  CANCELLED_BY_CLEANER: 'Cancelled by the cleaner',
  CANCELLED_BY_CUSTOMER: 'Cancelled by the customer',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partly refunded',
  RESOLVED_REFUND: 'Dispute resolved: refunded',
  RESOLVED_PARTIAL: 'Dispute resolved: partly refunded',
  RESOLVED_PAYOUT: 'Dispute resolved: cleaner paid',
};

const INSURANCE_WORDS = {
  own: "Insured (the cleaner's own insurance)",
  platform: 'Insured (platform-provided cover)',
  none: 'No insurance recorded',
};

// The customer, the cleaner booked on the job, or an admin. Anyone else gets
// 403, and a job with no cleaner has nothing to put in a record yet.
async function loadForDocument(jobId, user) {
  const job = await Job.findById(jobId);
  if (!job) throw httpError(404, 'Job not found');

  const isCustomer = user.role === 'customer' && job.customer && job.customer.toString() === user.id;
  let isCleaner = false;
  if (user.role === 'cleaner' && job.cleaner) {
    const mine = await CleanerProfile.findOne({ user: user.id });
    isCleaner = Boolean(mine && mine._id.toString() === job.cleaner.toString());
  }
  if (!isCustomer && !isCleaner && user.role !== 'admin') {
    throw httpError(403, 'You do not have access to this job');
  }
  if (!job.cleaner) throw httpError(409, 'Documents are available once a cleaner has been booked on the job');

  const [customer, cleaner, serviceType] = await Promise.all([
    User.findById(job.customer),
    CleanerProfile.findById(job.cleaner),
    ServiceType.findById(job.serviceType),
  ]);
  return { job, customer, cleaner, serviceType };
}

function isIndustrial({ job, serviceType }) {
  return job.category === 'industrial' || Boolean(serviceType && serviceType.requiresCoshh);
}

const STYLES = `
  body { font-family: Arial, Helvetica, sans-serif; color: #111; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.45; }
  h1 { font-size: 1.5rem; margin-bottom: 0.2rem; }
  h2 { font-size: 1.1rem; margin-top: 1.6rem; border-bottom: 1px solid #999; padding-bottom: 0.2rem; }
  table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; }
  th, td { border: 1px solid #999; padding: 0.4rem 0.5rem; text-align: left; vertical-align: top; font-size: 0.9rem; }
  th { background: #eee; width: 32%; }
  .grid th { width: auto; }
  .blank td { height: 2.2rem; }
  .note { font-size: 0.85rem; color: #333; }
  .box { border: 1px solid #999; padding: 0.6rem 0.8rem; margin: 0.6rem 0; background: #fafafa; }
  .sign td { height: 3rem; }
  footer { margin-top: 2rem; font-size: 0.75rem; color: #444; border-top: 1px solid #999; padding-top: 0.5rem; }
  @media print { body { margin: 0; max-width: none; } .noprint { display: none; } }
`;

function shell(title, body, generatedAt) {
  return `<!DOCTYPE html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${STYLES}</style></head>
<body>
<p class="noprint note"><button onclick="window.print()">Print or save as PDF</button></p>
${body}
<footer>
  <p>Generated ${esc(dateTime(generatedAt))} from the records held by ${esc(COMPANY.name)}.</p>
  <p>${esc(COMPANY.details)}</p>
</footer>
</body></html>`;
}

function rows(pairs) {
  return `<table>${pairs.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
}

function reference(job) {
  return String(job._id).slice(-8).toUpperCase();
}

function jobSection({ job, customer, cleaner, serviceType }) {
  return `
<h2>The job</h2>
${rows([
  ['Reference', reference(job)],
  ['Service', serviceType ? serviceType.name : 'Cleaning'],
  ['Type of work', job.category === 'industrial' ? 'Industrial / commercial' : 'Domestic'],
  ['How often', FREQUENCY[job.frequency] || 'One-off'],
  ['Estimated hours', job.estimatedHours || 'Not recorded'],
  ['Site postcode', job.postcode],
  ['Customer', customer ? customer.name : 'Not recorded'],
  ['Cleaner', cleaner ? `${cleaner.name}${cleaner.companyName ? ` (${cleaner.companyName})` : ''}` : 'Not recorded'],
  ['Description', job.description || 'None given'],
])}`;
}

// Status is the cleaner's CURRENT recorded status, not a snapshot from the
// day of the job, and says so.
function statusSection(cleaner, generatedAt) {
  return `
<h2>Cleaner's recorded status</h2>
${rows([
  ['DBS check', cleaner && cleaner.dbsVerified ? 'Marked as verified by CleanOps Connect staff' : 'Not verified'],
  ['COSHH training', cleaner && cleaner.coshhTrained ? 'Marked as verified by CleanOps Connect staff' : 'Not verified'],
  ['Insurance', INSURANCE_WORDS[(cleaner && cleaner.insuranceStatus) || 'none'] || 'No insurance recorded'],
])}
<p class="note">This is the status recorded on ${esc(dateTime(generatedAt))}, not necessarily on the day of the job. It reflects checks of evidence the cleaner supplied; it is not a guarantee, and you should check certificates yourself where the work needs it.</p>`;
}

function renderServiceRecord(data, generatedAt = new Date()) {
  const { job } = data;
  const body = `
<h1>Service record</h1>
<p class="note">Job reference ${esc(reference(job))}</p>
<div class="box note">This is a record of what CleanOps Connect has recorded about this booking. It is not an invoice or a VAT invoice, and it does not certify the quality of the work.</div>
${jobSection(data)}
<h2>Timeline</h2>
${rows([
  ['Job posted', dateTime(job.createdAt)],
  ['Booked with this cleaner', dateTime(job.bookedAt)],
  ['Cleaner checked in', dateTime(job.checkedInAt)],
  ['Cleaner marked the job complete', dateTime(job.awaitingConfirmationAt)],
  [
    'Confirmed complete',
    job.confirmedAt
      ? `${dateTime(job.confirmedAt)} (${job.confirmationMethod === 'automatic' ? 'automatically, after 48 hours with no problem reported' : 'by the customer'})`
      : 'Not recorded',
  ],
])}
<h2>Price and payment</h2>
${rows([
  ['Agreed price', pounds(job.pricePence)],
  ['Price set by', 'The cleaner'],
  ['Status', PAYMENT_WORDS[job.paymentStatus] || job.paymentStatus || 'Not recorded'],
])}
${job.disputeReason ? `<p class="note">A problem was reported on ${esc(dateTime(job.disputedAt))}.</p>` : ''}
${statusSection(data.cleaner, generatedAt)}`;
  return shell(`Service record ${reference(job)}`, body, generatedAt);
}

const COSHH_ROWS = 6;
const RISK_FIELDS = [
  'Description of the work and areas covered',
  'Hazards identified (e.g. slips, manual handling, working at height, electrical, waste)',
  'Who could be harmed (cleaner, customer staff, visitors, the public)',
  'Control measures in place',
  'Personal protective equipment (PPE) to be worn',
  'Emergency and first-aid arrangements',
  'Waste disposal and spill arrangements',
  'Site access, induction and special conditions',
];

function renderCompliancePack(data, generatedAt = new Date()) {
  const { job } = data;
  const requirements = job.tender && job.tender.requirements;
  const coshhRows = Array.from({ length: COSHH_ROWS }, () => '<tr class="blank"><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('');
  const riskRows = RISK_FIELDS.map((f) => `<tr class="blank"><th scope="row">${esc(f)}</th><td></td></tr>`).join('');

  const body = `
<h1>Pre-start compliance pack</h1>
<p class="note">Job reference ${esc(reference(job))}</p>
<div class="box note">
  <strong>How to use this pack.</strong> The cleaner completes sections A and B before work starts, using the safety
  data sheet for each product. CleanOps Connect pre-fills the job details and recorded status only. It does not supply,
  check or approve the COSHH or risk-assessment information, and this pack is not a statement that any work or person
  is compliant. It is not legal or health-and-safety advice.
</div>
${jobSection(data)}
${requirements ? `<p><strong>Site and requirements from the customer:</strong> ${esc(requirements)}</p>` : ''}
${statusSection(data.cleaner, generatedAt)}

<h2>A. COSHH assessment: substances to be used</h2>
<p class="note">The Control of Substances Hazardous to Health Regulations 2002 require a suitable and sufficient assessment
before work that could expose people to hazardous substances. List each product to be used. Take hazard and handling
details from the manufacturer's safety data sheet (SDS).</p>
<table class="grid">
  <thead><tr><th>Product name</th><th>Supplier</th><th>Hazards (from the SDS)</th><th>Where and how it will be used</th><th>Controls and PPE</th><th>SDS held (Y/N)</th></tr></thead>
  <tbody>${coshhRows}</tbody>
</table>

<h2>B. Risk assessment and method statement</h2>
<p class="note">The Management of Health and Safety at Work Regulations 1999 require risks from work activities to be
assessed. Complete each item for this job.</p>
<table>${riskRows}</table>

<h2>C. Sign-off</h2>
<table class="sign">
  <tr><th scope="row">Cleaner: name and signature</th><td></td><th scope="row">Date</th><td></td></tr>
  <tr><th scope="row">Customer's site contact: name and signature</th><td></td><th scope="row">Date</th><td></td></tr>
</table>
<p class="note">Keep a copy with the job records. Where the customer's site rules apply (permits, inductions, restricted areas), follow them in addition to this pack.</p>`;
  return shell(`Compliance pack ${reference(job)}`, body, generatedAt);
}

async function generateDocument(jobId, kind, user) {
  if (!KINDS.includes(kind)) throw httpError(404, 'Unknown document');
  const data = await loadForDocument(jobId, user);
  if (kind === 'compliance-pack' && !isIndustrial(data)) {
    throw httpError(400, 'A compliance pack is only available for industrial jobs');
  }
  return kind === 'service-record' ? renderServiceRecord(data) : renderCompliancePack(data);
}

module.exports = { generateDocument, renderServiceRecord, renderCompliancePack, esc, KINDS };
