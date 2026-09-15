# -CleanOps-Connect

UK domestic and industrial cleaning lead allocation platform with AI scoring, Mapbox postcode routing, cleaner subscriptions, insurance add-ons, compliance checks (DBS/COSHH), and job automation.

## Backend scaffold

This repository now includes a lightweight Python backend scaffold in `cleanops_connect/` with:

- data models for `User`, `CleanerProfile`, `Job`, `JobOffer`, `ServiceType`, and `Subscription`
- modular `controllers`, `services`, `repositories`, and `middleware`
- placeholder services for Mapbox postcode geocoding, AI lead scoring, spatial filtering, cleaner onboarding, job creation, subscription billing, and insurance add-on logic
- in-memory repositories to support future API and persistence work

## Run the scaffold tests

```bash
python -m unittest discover -s tests
```
