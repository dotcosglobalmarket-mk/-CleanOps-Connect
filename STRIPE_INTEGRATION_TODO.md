# Stripe Checkout integration TODO

## Values to replace
Placeholders in [`src/services/stripe.service.js`](src/services/stripe.service.js) (`createCheckoutSession`):
- `mode` — `'payment'` is a sample; choose `payment`, `subscription` or `setup`.
- `success_url` / `cancel_url` — built from `FRONTEND_URL` pointing at `customer.html`; change to your real pages.
- `line_items[].price` — `price_...` must be a real Stripe Price ID.

## Configured parameters (from Checkout Studio)
In [`src/services/stripe.service.js`](src/services/stripe.service.js): `ui_mode: 'hosted_page'` (SDK >= 21), `billing_address_collection: 'auto'`, `phone_number_collection: {enabled:false}`, `automatic_tax: {enabled:false}`, `allow_promotion_codes: false`, `submit_type: 'auto'`, `integration_identifier: 'hosted_mobile_app_0001'`, `origin_context: 'mobile_app'`.
`payment_method_collection` is omitted: it only applies to `mode: 'subscription'`.

## Setup and next steps
- Env: `STRIPE_SECRET_KEY` (server only) and `FRONTEND_URL`. `STRIPE_WEBHOOK_SECRET` already exists for `/webhooks/stripe`.
- Flow: logged-in customer `POST /payments/checkout-session` -> `{ url }` -> redirect the browser to it -> Stripe returns to `success_url`.
- Test cards: `4242 4242 4242 4242` (success), `4000 0025 0000 3155` (3D Secure).
- Help: https://support.stripe.com and https://docs.stripe.com/mcp

## Notes
- `integration_identifier` / `origin_context` say "mobile app" but this is a website. Used as given by Checkout Studio; change them there if wrong.
- Job prices are set per job by the cleaner, so a fixed Price ID will not fit the jobs flow. Using Checkout for jobs would need `price_data` plus a `checkout.session.completed` webhook case. The existing PaymentIntent flow is untouched.
