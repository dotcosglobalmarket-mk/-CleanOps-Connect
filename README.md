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
```

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

### Jobs

- `POST /jobs` 🔒 (customer) – Create a new job
- `POST /jobs/:id/allocate` 🔒 (job owner or admin) – Run AI allocation and send offers
- `GET /jobs/:id` – View job details

### Cleaners

- `POST /cleaners` 🔒 (cleaner) – Register cleaner
- `POST /cleaners/coverage` 🔒 (cleaner or admin) – Set radius or polygon coverage
- `GET /cleaners/:id` – View cleaner profile

### Subscriptions

- `POST /subscriptions` 🔒 (cleaner or admin) – Activate plan
- `POST /subscriptions/insurance` 🔒 (cleaner or admin) – Add insurance add‑on

🔒 requires a `Authorization: Bearer <token>` header from `/auth/login`.

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

### Frontend (Cloudflare)

`frontend/` is a plain HTML/CSS/JS static site (no build step) covering registration, login, a customer dashboard (post a job, view it, run allocation), and a cleaner dashboard (register profile, set coverage, manage subscription/insurance). It talks directly to the backend's REST API over `fetch`.

Before deploying, set `window.API_BASE_URL` in `frontend/js/config.js` to your deployed backend's URL (e.g. the DigitalOcean App Platform URL) — CORS is already open on the backend, so cross-origin requests from the Cloudflare-hosted frontend work out of the box.

Deploy with Wrangler (config already in `wrangler.toml` at the repo root, using Cloudflare's Workers Static Assets):

```
npx wrangler deploy
```

Or connect this repo to a Cloudflare Pages project with build output directory set to `frontend/` and no build command.

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
