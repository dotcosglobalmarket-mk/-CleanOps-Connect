# CleanOps Connect: critical review and build plan

## Context
The user asked for a critical review of cleanop-connect.co.uk, a plan for what to build next, an **Operator dashboard**, and suggestions for everything else.

**Decisions from the user**
- **Operator** means platform ops staff: a restricted internal role that sits below the super admin.
- **CQC is out of scope.** The regulations that apply are UK GDPR, DBS checks, COSHH, the Consumer Rights Act 2015, and ASA/CAP rules on advertising.

The network proxy blocked the live site. The review is based on the repo, which is the source for the live site: the `marketing/` Vite site is deployed through a Cloudflare Worker, and the `src/` Express/Mongo API runs on DigitalOcean.

## Critical review: key findings (verified in code)

**P0: security and legal (fix before anything else ships)**
1. **Anyone can self-register as an admin.** `src/validation/auth.validation.js:7` accepts `role: 'admin'`.
2. **Booking has no ownership check.** `POST /payments/jobs/:id/book` (`src/controllers/PaymentController.js:16`) lets any customer book any job, with any cleaner, at any price. This bypasses the offer flow.
3. **Cleaners can mark themselves as compliant.** They can self-certify `dbsVerified` and `coshhTrained` (`src/validation/cleaner.validation.js:9-10`), which makes the landing page's "DBS-checked & fully insured" claim unenforced.
4. **Public endpoints leak personal data.** `GET /jobs/:id` and `GET /cleaners/:id` require no login. They expose postcode, coordinates, phone, Stripe IDs and commission rate.
5. **The frontend has XSS risks.** `innerHTML` renders unescaped values in `marketing/js/customer.js`, `cleaner.js` and `nav.js`. The JWT is stored in localStorage, which makes any XSS worse.
6. **No hardening.** CORS allows `*`, there is no helmet, no rate limit on login or register, no password reset, and no email verification.
7. **Legal and advertising gaps.**
   - There are no Privacy, Terms or Cookies pages. The site collects personal data, so UK GDPR requires them.
   - The testimonials are invented, which breaches ASA/CAP rules and the consumer protection rules in the DMCC Act 2024.
   - The footer has 10 dead `href="#"` links.
8. **Payment logic bugs.**
   - The cancellation window is measured from `createdAt`, not from when the job was booked.
   - A PaymentIntent is created before the state check, so a failed booking can leave an orphaned one.
   - `resolveDisputePartial` does not check the dispute state first.
   - `acceptOffer` can race if two cleaners accept at once.

**P1: product gaps (the journey breaks end to end)**
- **Customer:** no "my jobs" list, jobs are viewed by pasting an ID, there is no Stripe.js checkout, and there are no screens to confirm, dispute or cancel.
- **Cleaner:** no offers inbox, no check-in or complete buttons, no earnings screen, and nothing ever creates a Stripe Connect account. Because of that, payouts can never succeed.
- **Admin:** the dispute-resolution endpoints exist but have no UI. There is also no audit trail of admin actions.
- **Notifications:** they are only `console.log` calls. Customers and cleaners are never told about offers or bookings.

**P2: operations and tech debt**
- `.do/app.yaml` is missing the Stripe env vars.
- Node 18 is end-of-life.
- The retry worker runs inside the web process, so it would run twice if there were two instances.
- `openapi.yaml` is out of date, and there is no lint config.

## Phase 1: P0 fixes (one PR, first) — implemented on `claude/amazing-johnson-v2hbge`

Notes from implementation:
- `POST /payments/jobs/:id/book` is now **admin-only**. A normal booking already happens when a cleaner accepts an offer at the price they set, so a customer-facing book endpoint is not needed and would let the customer set the cleaner's price.
- Extra fixes found while implementing: suspended or unavailable cleaners were still sent offers (now excluded in `allocateJob`), and the landing page claimed "DBS-checked & fully insured cleaners" and "Identity verified", which the matching rules do not enforce (copy corrected).
- Legal pages contain highlighted `[To be completed: …]` fields (company name and number, ICO registration, contact emails, retention periods). These must be filled in and the pages legally reviewed before merging.
- Needs legal review: the 50% refund for a customer who cancels more than 24 hours after booking may conflict with the 14-day cancellation right in the Consumer Contracts Regulations 2013 when no service has been provided yet.

- **Registration:** in `auth.validation.js`, allow only `['customer','cleaner']`. Admin and operator accounts are created only by an admin (see Phase 2).
- **Booking:** in `PaymentController.book`, load the job and require `job.customer === req.user.id` (or admin). Require an accepted `JobOffer` for that cleaner, and take `pricePence` from the offer, not the request body. In `payment.service.bookJob`, check the state before calling Stripe.
- **Compliance flags:** remove `dbsVerified` and `coshhTrained` from `createCleanerSchema`. They can only be set through the existing `PATCH /admin/cleaners/:id/verification`. Remove the checkboxes from `marketing/cleaner.html` and `cleaner.js`.
- **Public endpoints:** `GET /jobs/:id` requires login and returns data only to the owner, the assigned or offered cleaner, admin or ops. `GET /cleaners/:id` returns a public projection only: name, rating, services, verified badges and area. No phone, Stripe or commission fields.
- **Frontend XSS:** move `escapeHtml` from `marketing/js/admin.js:39` into a shared `marketing/js/dom.js` and use it in `customer.js`, `cleaner.js` and `nav.js`.
- **API hardening:** add `helmet`, an allow-list for CORS read from an env var, and `express-rate-limit` on `/auth/*`.
- **Payment bugs:** add a `bookedAt` field on Job and measure the cancellation window from it. Add a state guard to `resolveDisputePartial`. Make `acceptOffer` atomic with `findOneAndUpdate({status:'open'})`.
- **Legal pages:** add `privacy.html`, `terms.html` and `cookies.html`, and register them in `marketing/vite.config.js`. Remove the fake testimonials, or label them clearly as illustrative until real reviews exist. Fix the footer links.
- **Tests:** add tests for each fix in `tests/integration/*.routes.test.js` and `tests/unit/payment.service.test.js`.

## Phase 2: Operator (platform ops) dashboard

**Role model:** add `'operator'` to the `User.role` enum in `src/models/User.js`. Access is permission-based and least-privilege.
- **Operator can:**
  - view jobs, cleaners, the payments ops queue and disputes
  - verify DBS, COSHH and insurance with evidence notes
  - put a cleaner under review
  - resolve disputes with a full payout, or a refund up to a set limit
  - trigger manual transfer retries
  - add support notes to jobs
- **Operator cannot:**
  - suspend a cleaner
  - issue refunds above `OPS_REFUND_LIMIT_PENCE` (default £150). These go to an admin for approval.
  - manage service types or users, or see revenue figures
- **Implementation:** add `requirePermission(perm)` to `src/middleware/auth.js`, driven by a role→permissions map in a new `src/config/permissions.js`. Keep `requireRole` working as it does now.

**Audit trail (required for disputes, refunds and GDPR accountability)**
- New model `src/models/AuditLog.js` with fields: actor, actorRole, action, targetType, targetId, before, after, reason (required), ip, timestamp. It is append-only.
- New `src/services/audit.service.js` records the actor for every ops or admin mutation, including the existing admin verification and deactivation actions.

**API** (new file `src/routes/ops.routes.js`, mounted at `/ops`; it reuses `admin.service.js` and `payment.service.js`)
- `GET /ops/summary`: queue counts for pending verifications, open disputes, transfers on manual hold, jobs overdue for check-in, and offers that expired with no cleaner accepting.
- `GET /ops/disputes` and `GET /ops/disputes/:id`: job details, the customer's dispute reason, and the payment timeline.
- `POST /ops/disputes/:id/resolve`: `{outcome: payout|refund|partial, amountPence, reason}`. This calls the existing `resolveDispute*` functions. Refunds over the limit create a `PendingApproval` record for an admin.
- `GET /ops/verifications` and `PATCH /ops/cleaners/:id/verification`: require an evidence note (DBS certificate number and issue date, insurer and policy expiry).
- `POST /ops/jobs/:id/notes`, plus reused list and detail endpoints for jobs, cleaners and the payments queue.
- `GET /admin/audit` and `GET /admin/approvals`, `POST /admin/approvals/:id/{approve|reject}`: admin only.
- `POST /admin/users` (admin only): create operator or admin accounts. This replaces self-registration for those roles.

**UI** (new `marketing/ops.html` and `marketing/js/ops.js`, registered in `vite.config.js`)
- Reuses the patterns in `admin.js`: `renderTable`, `statusBadge` and the tab layout. Move the shared helpers into `marketing/js/dashboard-ui.js`.
- **Tabs:**
  - **Today:** queue counters and SLA flags.
  - **Disputes:** detail drawer and resolve form, with a mandatory reason.
  - **Verification:** evidence form.
  - **Payments queue.**
  - **Jobs:** notes and timeline.
  - **Cleaners.**
- Update `login.js` so an operator is redirected to `ops.html`.
- Add a **Disputes** tab and an **Audit log** tab to `admin.html` as well.
- Accessibility: `role="tab"` and `aria-selected` on tabs, `aria-live` on alerts, and one `<h1>` per page.

## Phase 3: complete the core journeys (suggested next)
1. **Cleaner:**
   - Stripe Connect Express onboarding: `POST /cleaners/me/stripe/onboard` returns an account link, and the `account.updated` webhook sets `payoutsEnabled`.
   - Offers inbox with accept or decline.
   - My jobs, with check-in and complete buttons.
   - Earnings and payouts screen.
2. **Customer:**
   - `GET /jobs/mine` and a "My jobs" list.
   - A view of offers showing the cleaner's public profile and price.
   - Stripe Payment Element checkout using the PaymentIntent client secret.
   - Buttons to confirm, dispute and cancel.
3. **Notifications:** email through Resend, and optionally SMS through Twilio, for offer sent, offer accepted, booked, check-in, completed, auto-confirm warning and dispute outcome. Replace the `console.log` placeholders.
4. **Reviews:** a `Review` model, with one review per completed job. It feeds `ratingAverage` and `ratingCount`, and the landing-page testimonials are then drawn from real reviews.

## Phase 4: trust, compliance and scale (later)
- **Compliance documents:** upload DBS, insurance and COSHH certificates to storage such as R2, with expiry dates. A daily job flags documents expiring within 30 days and automatically sets the cleaner to `under_review` once a document expires.
- **UK GDPR:** a data export endpoint for Subject Access Requests, account deletion or anonymisation, and a retention policy for jobs and payments. Financial records are kept for 6 years (HMRC).
- **Real subscription billing** with Stripe Billing, replacing the current database-only records.
- **Background worker:** move the transfer retry worker to a separate DigitalOcean worker component.
- **Upkeep:**
  - Upgrade to Node 20 or 22 and use `npm ci --omit=dev`.
  - Add the Stripe env vars to `.do/app.yaml`.
  - Bring `openapi.yaml` up to date.
  - Add ESLint and run it in CI.
- **SEO:** Open Graph tags, `robots.txt`, `sitemap.xml`, and area landing pages for Leeds, Bradford and Wakefield.

## Verification
- `npm test`: all current tests plus new tests for each P0 fix (admin self-registration rejected, booking by a non-owner returns 403, cleaner cannot set `dbsVerified`, public projection has no personal data) and for the ops routes (operator 403 on suspend and on refunds over the limit, audit rows written, approval flow).
- `cd marketing && npm run build`: all pages build, including `ops.html` and the legal pages.
- **Manual smoke test:**
  1. Run `npm run dev` and `cd marketing && npm run dev`.
  2. Create an operator through `POST /admin/users`.
  3. Log in and confirm the redirect to `ops.html`.
  4. Resolve a seeded dispute and check the AuditLog entry.
  5. Try a refund over the limit and confirm it appears in the admin approvals list.
- Each phase ships as its own PR on `claude/amazing-johnson-v2hbge`, with Phase 1 first.
