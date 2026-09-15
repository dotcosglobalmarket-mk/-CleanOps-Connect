# CleanOps Connect

A UK‑focused domestic and industrial cleaning lead‑allocation platform. CleanOps Connect intelligently matches customers with verified cleaners using AI scoring, Mapbox postcode geolocation, compliance checks (DBS/COSHH), subscription plans, and optional insurance add‑ons.

This repository contains the backend service powering the CleanOps Connect platform.

> **Note:** This repository currently contains two parallel backend scaffolds: the Node.js/Express service documented below (`src/`), and an earlier lightweight Python scaffold in `cleanops_connect/` (see [Python backend scaffold](#python-backend-scaffold)). Consolidating on one is a follow-up.

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

## Future Roadmap

- Customer mobile app
- Cleaner mobile app
- Industrial tendering module
- Escrow payments
- Automated compliance document generation
- AI‑powered job pricing suggestions

## License

MIT License

## Python backend scaffold

This repository also includes an earlier, lightweight Python backend scaffold in `cleanops_connect/` with:

- data models for `User`, `CleanerProfile`, `Job`, `JobOffer`, `ServiceType`, and `Subscription`
- modular `controllers`, `services`, `repositories`, and `middleware`
- placeholder services for Mapbox postcode geocoding, AI lead scoring, spatial filtering, cleaner onboarding, job creation, subscription billing, and insurance add-on logic
- in-memory repositories to support future API and persistence work

Run its tests with:

```bash
python -m unittest discover -s tests
```

## Author

Collins — Founder of CleanOps Connect
Pontefract, UK
