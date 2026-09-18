# CleanOps Connect

A UK‑focused domestic and industrial cleaning lead‑allocation platform. CleanOps Connect intelligently matches customers with verified cleaners using AI scoring, Mapbox postcode geolocation, compliance checks (DBS/COSHH), subscription plans, and optional insurance add‑ons.

This repository contains the backend service powering the CleanOps Connect platform.

## Features

### AI‑Driven Lead Allocation

- Scores cleaners based on distance, experience, rating, insurance status, compliance, and price fit.
- Supports both domestic and industrial cleaning categories.

### Mapbox Postcode Routing

- Converts UK postcodes to coordinates.
- Filters cleaners by radius or polygon coverage areas.
- Enables precise geographic lead distribution.

### Cleaner Subscription System

- Monthly subscription tiers: Starter, Pro, Industrial Pro.
- Optional insurance add‑on integrated into billing logic.

### Compliance & Verification

- DBS verification for domestic cleaners.
- COSHH training flags for industrial cleaners.
- Insurance validation for high‑risk jobs.

### Job Management

- Customers create jobs with postcode, budget, frequency, and service type.
- Cleaners receive job offers based on AI scoring.
- Supports one‑off, recurring, and industrial contract jobs.

## Tech Stack

- Node.js + Express
- MongoDB (Atlas or DigitalOcean Managed)
- Mapbox Geocoding API
- Modular service‑based architecture
- JWT authentication
- Environment‑based configuration

## Project Structure

```
cleanops-connect/
  src/
    controllers/
    services/
    models/
    middleware/
    utils/
    config/
  tests/
  package.json
  .env.example
  README.md
```

## Environment Variables

Create a `.env` file based on `.env.example`:

```
PORT=4000
MONGO_URI=
MAPBOX_API_KEY=
JWT_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` are placeholders — no live Stripe
account is connected yet. See the Payments section below for the escrow model
this key pair supports.

## Installation

Clone the repository:

```
git clone https://github.com/dotsonglobalmarket-mk/CleanOps-Connect.git
cd CleanOps-Connect
```

Install dependencies:

```
npm install
```

Start development server:

```
npm run dev
```

## Core Models

- **User** – authentication and identity
- **CleanerProfile** – coverage, skills, compliance, insurance
- **Job** – customer job requests
- **JobOffer** – AI‑ranked cleaner offers
- **ServiceType** – domestic & industrial categories
- **Subscription** – monthly plans + insurance add‑on

## API Endpoints (Initial Set)

### Auth

- `POST /auth/register` – Register a customer, cleaner, or admin account
- `POST /auth/login` – Log in and obtain a JWT

### Service Types

- `GET /service-types` – List service types, optionally `?category=domestic|industrial`. No auth required — the frontend uses this to populate the "service type" dropdown when a customer posts a job, since a raw ObjectId isn't something a customer can be expected to know. A default catalogue is seeded automatically on server start (see `src/services/service-type-seed.service.js`).
- `POST /service-types` 🔒 (admin) – Add a new service type
- `PATCH /service-types/:id` 🔒 (admin) – Edit a service type

### Jobs

- `POST /jobs` 🔒 (customer) – Create a new job
- `POST /jobs/:id/allocate` 🔒 (job owner or admin) – Run AI allocation and send offers
- `POST /jobs/:id/offers/:offerId/accept` 🔒 (the offered cleaner) – Accept an offer **at the price the cleaner sets** (`pricePence` — the platform never sets or suggests a rate). Books the job (creates the Stripe PaymentIntent, see Payments below) and automatically declines every other outstanding offer on the job.
- `POST /jobs/:id/offers/:offerId/decline` 🔒 (the offered cleaner) – Decline an offer
- `GET /jobs/:id` – View job details

### Cleaners

- `POST /cleaners` 🔒 (cleaner) – Register cleaner
- `POST /cleaners/coverage` 🔒 (cleaner or admin) – Set radius or polygon coverage
- `GET /cleaners/me` 🔒 (cleaner) – View your own profile, including dashboard fields (bio, hourly rate, working hours, contact details, custom services)
- `PATCH /cleaners/me` 🔒 (cleaner) – Update your own profile
- `GET /cleaners/:id` – View cleaner profile

### Subscriptions

- `POST /subscriptions` 🔒 (cleaner or admin) – Activate plan
- `POST /subscriptions/insurance` 🔒 (cleaner or admin) – Add insurance add‑on

### Payments (Escrow & Commission)

Uses Stripe's **Separate Charges and Transfers** pattern: a customer's payment
lands in the platform's own Stripe balance first, and is only moved to the
cleaner via a later, explicit `Transfer.create()` call — this gap is the
escrow window. Commission is **deductive**: the cleaner sets their own price
(`pricePence`), the customer is charged exactly that amount, and commission is
only ever subtracted from what the cleaner receives, never added on top. The
full lifecycle (booking → payment held → in progress → confirmation/dispute →
payout) is governed by a single state machine in
`src/services/payment-state-machine.js`; `paymentStatus` on a `Job` is never
written anywhere else.

- `POST /payments/jobs/:id/book` 🔒 (customer or admin) – Book a job at the
  cleaner's price and create the Stripe PaymentIntent
- `POST /payments/jobs/:id/cancel` 🔒 (job's own customer or cleaner, or admin)
  – Cancel a job before it starts and issue the appropriate refund
- `POST /payments/jobs/:id/check-in` 🔒 (assigned cleaner) – Mark the job as
  started
- `POST /payments/jobs/:id/complete` 🔒 (assigned cleaner) – Mark the job
  complete and start the 48hr auto-confirm window
- `POST /payments/jobs/:id/confirm` 🔒 (job's own customer or admin) – Confirm
  completion and trigger commission calculation + payout
- `POST /payments/jobs/:id/dispute` 🔒 (job's own customer or admin) – Raise a
  dispute with a reason code before the auto-confirm window closes
- `POST /payments/jobs/:id/resolve/refund` 🔒 (admin) – Resolve a dispute in
  the customer's favour (full refund)
- `POST /payments/jobs/:id/resolve/partial` 🔒 (admin) – Split the outcome
  between a partial refund and a reduced cleaner payout
- `POST /payments/jobs/:id/resolve/payout` 🔒 (admin) – Resolve a dispute in
  the cleaner's favour and proceed to payout
- `GET /payments/ops/queue` 🔒 (admin) – List jobs stuck in
  `MANUAL_REVIEW_HOLD` or `PAYOUT_BLOCKED` for ops follow-up
- `POST /payments/ops/jobs/:id/manual-retry` 🔒 (admin) – Manually retry a
  transfer that exhausted its automatic retry attempts
- `POST /webhooks/stripe` – Stripe webhook endpoint (signature-verified,
  deduplicated). Subscribes to `payment_intent.succeeded`,
  `transfer.created`, `transfer.paid`, `transfer.failed`, `payout.failed`,
  `account.updated`, `charge.dispute.created`.

A background worker (`src/workers/transfer-retry.worker.js`, started from
`src/server.js`) periodically retries `TRANSFER_FAILED` payouts on an
exponential backoff (5min → 30min → 2hr, capped at 3 attempts before
escalating to `MANUAL_REVIEW_HOLD`), and auto-confirms jobs whose 48hr
customer-confirmation window has elapsed with no dispute raised.

Cancellation-policy numbers (`24hr` full-refund window, `50%` partial refund
after that) are placeholder defaults pending a real business decision — see
the comment above them in `src/services/payment.service.js`.

🔒 requires a `Authorization: Bearer <token>` header from `/auth/login`.

### Admin

All routes below require `requireRole('admin')`. This is the platform's super-admin dashboard, backing `marketing/admin.html`.

- `GET /admin/summary` – Aggregate counts for the overview screen: cleaner verification/review/suspension counts, job totals, and the payments ops queue size
- `GET /admin/cleaners` – List cleaners, optionally `?deactivationStatus=active|under_review|suspended` and/or `?verified=true|false` (a cleaner counts as verified once `dbsVerified` is true and `insuranceStatus` isn't `none`)
- `GET /admin/cleaners/:id` – View a single cleaner
- `PATCH /admin/cleaners/:id/verification` – Update `dbsVerified` / `coshhTrained` / `insuranceStatus` (at least one field required)
- `PATCH /admin/cleaners/:id/deactivation` – Set `deactivationStatus`. This is the human review step itself — any rating/algorithm-triggered suspension must land here as `under_review` first, never straight to `suspended` (see `CleanerProfile.deactivationStatus`)
- `GET /admin/jobs` – List jobs across every status, optionally `?status=` (the lead-allocation status) and/or `?paymentStatus=` (the escrow state machine status)
- `GET /admin/jobs/:id` – View a single job with populated customer/cleaner/service type

The existing `GET /payments/ops/queue` and `POST /payments/ops/jobs/:id/manual-retry` (documented under Payments above) are also admin-only and surface in the same dashboard's Payments Ops Queue tab.

## Mapbox Integration

Mapbox is used for:

- Postcode → lat/lng conversion
- Coverage radius filtering
- Polygon coverage (GeoJSON)
- Spatial matching for lead allocation

Placeholder service: `/src/services/mapbox.service.js`

## Request Validation

Request bodies and path params are validated with [Zod](https://zod.dev) before reaching any controller or service — see `/src/validation/`. A malformed request returns `400` with a `details` array naming each invalid field, before any database or business logic runs.

## AI Lead Scoring

Initial rule‑based scoring considers:

- Distance
- Experience
- Rating
- Price fit
- Insurance status
- Compliance flags

Later phases introduce machine learning based on job outcomes.

Placeholder service: `/src/services/ai-scoring.service.js`

## Testing

Run the automated test suite:

```
npm test
```

Unit tests (`tests/unit/`) cover the pure business logic — coverage filtering, AI scoring, insurance gating, Mapbox geocoding, auth/validation middleware, and error handling — with no database required. Integration tests (`tests/integration/`) exercise the Express routes end-to-end (auth, ownership checks, validation) with the Mongoose models mocked, so no live MongoDB is needed to run them locally or in CI. The GitHub Actions deploy workflow (`.github/workflows/deploy.yml`) runs this suite as a required `test` job before every deploy.

## Deployment

### Local Development

Run with Node.js.

### Production Deployment (DigitalOcean)

You can deploy via:

- DigitalOcean App Platform (recommended)
- DigitalOcean Droplet (manual control)

MongoDB can be hosted on:

- MongoDB Atlas (free tier available)
- DigitalOcean Managed MongoDB

### Frontend (Cloudflare Workers)

`marketing/` is a Vite-built static site covering registration, login, a customer dashboard (post a job, view it, run allocation), and a cleaner dashboard (register profile, set coverage, manage subscription/insurance). It talks directly to the backend's REST API over `fetch`; CORS is already open on the backend, so cross-origin requests from the Cloudflare-hosted frontend work out of the box.

It's deployed as a Cloudflare **Worker serving static assets** (not Cloudflare Pages), via Cloudflare's own Git integration — there is no GitHub Actions workflow for this; Cloudflare builds and deploys directly from the repo.

#### Local development

```
cd marketing
npm install
cp .env.production.example .env.production   # then edit VITE_API_URL
npm run dev       # dev server
npm run build     # production build -> marketing/dist
```

#### Environment variables

Set in `marketing/.env.production` for local builds, or as build-time environment variables in the Cloudflare dashboard for the Worker's Git integration (Workers & Pages → `cleanops-connect` → Settings → Environment variables):

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Backend base URL (e.g. the DigitalOcean App Platform URL), no trailing slash |
| `VITE_MAPBOX_TOKEN` | Mapbox **public** access token (starts with `pk.`), used client-side to render the real coverage map on the landing page via the Static Images API. Create one at [account.mapbox.com/access-tokens](https://account.mapbox.com/access-tokens/) and restrict it to your production domain(s). This is distinct from the backend's `MAPBOX_API_KEY`, which is a private key used server-side for geocoding and must never be reused here. |

#### CI/CD (Cloudflare Workers Git integration)

Cloudflare's own Git integration on the `cleanops-connect` Workers project watches this repo and, on every push to `main`, runs from the project's configured root directory (`/marketing`):

1. **Build command**: `npm install && npm run build` — produces `marketing/dist`.
2. **Deploy command**: `npx wrangler deploy` — reads `marketing/wrangler.toml`, which points its `[assets]` binding at `./dist`, and publishes the Worker.

No GitHub secrets are required for this deploy path; environment variables are configured directly on the Cloudflare dashboard as described above. Configure the Git integration under Workers & Pages → `cleanops-connect` → Settings → Builds, with **Root directory** set to `/marketing`.

#### Custom domain: cleanop-connect.co.uk

1. **Add a custom domain to the Worker**: Cloudflare dashboard → Workers & Pages → `cleanops-connect` → **Settings** → **Domains & Routes** → **Add** → **Custom Domain** → enter `cleanop-connect.co.uk` → repeat for `www.cleanop-connect.co.uk`.
2. **DNS records** (Cloudflare dashboard → your zone → DNS → Records) — adding a custom domain to a Worker creates the required `CNAME`/`AAAA` records automatically when the zone's nameservers are on Cloudflare.
3. **SSL**: Cloudflare dashboard → your zone → SSL/TLS → set encryption mode to **Full** (or **Full (strict)**). Cloudflare issues and manages the edge certificate for both hostnames automatically once the custom domains are active.
4. **Redirect `www` → apex**: Cloudflare dashboard → your zone → Rules → Redirect Rules → create a rule: When incoming requests match hostname equals `www.cleanop-connect.co.uk`, then redirect to `https://cleanop-connect.co.uk/${uri}` (Type: Dynamic, Status code: 301).

## Future Roadmap

- Customer mobile app
- Cleaner mobile app
- Industrial tendering module
- Escrow payments
- Automated compliance document generation
- AI‑powered job pricing suggestions

## License

MIT License

## Author

Collins — Founder of CleanOps Connect
Pontefract, UK
