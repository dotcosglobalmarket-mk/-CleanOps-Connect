# Stripe Checkout: remaining setup

Hosted Stripe Checkout (the customer is redirected to a Stripe-hosted payment page) was added as a **new, separate endpoint**: `POST /payments/checkout-session`. It does not change the existing job payment flow (PaymentIntent + Payment Element).

## Values to Replace

The following values are placeholders and must be updated before going live.

**Files containing placeholders:**
- [src/services/stripe.service.js](src/services/stripe.service.js)

| Field | Current Value | What to Set |
|-------|--------------|-------------|
| mode | payment | Set to "payment" for one-time charges or "subscription" for recurring billing. If you switch to "subscription", also add `payment_method_collection: "always"`. |
| success_url | `{FRONTEND_URL}/customer.html?checkout=success&session_id={CHECKOUT_SESSION_ID}` (falls back to `https://example.com` if `FRONTEND_URL` is not set) | Your actual post-payment success page URL. Keep the `{CHECKOUT_SESSION_ID}` template. Today `customer.html` ignores the `checkout` and `session_id` parameters. |
| cancel_url | `{FRONTEND_URL}/customer.html?checkout=cancelled` (falls back to `https://example.com` if `FRONTEND_URL` is not set) | Your actual cancel/return page URL. |
| line_items[].price | price_... | Your actual Stripe Price ID from the Dashboard (https://dashboard.stripe.com/prices) or API. Until this is replaced, Stripe rejects the request. |

## Configured Parameters

These parameters were configured in Checkout Studio and are already set correctly.

**Files containing these parameters:**
- [src/services/stripe.service.js](src/services/stripe.service.js)

| Parameter | Value |
|-----------|-------|
| ui_mode | hosted_page |
| billing_address_collection | auto |
| phone_number_collection | `{ enabled: false }` |
| automatic_tax | `{ enabled: false }` |
| allow_promotion_codes | false |
| submit_type | auto |
| integration_identifier | hosted_mobile_app_0001 |
| origin_context | mobile_app |

Notes on these values:
- `payment_method_collection: "always"` is also set in Checkout Studio, but it only applies to `mode: "subscription"`, so it is left out while `mode` is `"payment"`.
- `integration_identifier` and `origin_context` describe a **mobile app**, but this project is a website. They were used exactly as configured; change them in Checkout Studio if that is not what you want.
- `ui_mode: "hosted_page"` is for Stripe SDK 21.0.0 and above. This project uses `stripe` ^22.6.2 (`package.json`). If you ever downgrade below 21.0.0, use `hosted` instead.

## Setup

1. **Environment variables** (server only, never in browser code):
   - `STRIPE_SECRET_KEY`: your key from https://dashboard.stripe.com/test/apikeys (already used by the app).
   - `STRIPE_WEBHOOK_SECRET`: from https://dashboard.stripe.com/workbench/webhooks (already used by the app).
   - `FRONTEND_URL`: the public address of the website, e.g. `https://www.cleanop-connect.co.uk` (added to `.env.example`).
   - `VITE_STRIPE_PUBLISHABLE_KEY` is only for the existing Payment Element page; hosted Checkout does not need it.
2. **Dependencies:** none to add. `stripe` is already installed.
3. **Replace the placeholders** in the table above.

## Project structure

No new files except this one and a test. Changes:
- [src/services/stripe.service.js](src/services/stripe.service.js): `createCheckoutSession()`
- [src/controllers/PaymentController.js](src/controllers/PaymentController.js): `checkoutSession`
- [src/routes/payments.routes.js](src/routes/payments.routes.js): `POST /payments/checkout-session` (logged-in customers only)
- [tests/unit/stripe-checkout-session.test.js](tests/unit/stripe-checkout-session.test.js)

## How it works

1. A logged-in customer's browser calls `POST /payments/checkout-session` (with the usual `Authorization: Bearer` token).
2. The server creates a Checkout Session with the parameters above and returns `{ "url": "https://checkout.stripe.com/..." }`.
3. The browser sets `window.location.href = url`. The customer pays on the Stripe-hosted page.
4. Stripe sends the customer to `success_url` (or `cancel_url` if they go back).
5. Stripe also sends a `checkout.session.completed` event to `/webhooks/stripe`. **That event is not handled yet**: the webhook controller ignores unknown events. Add a case for it before relying on this to fulfil anything.

This endpoint is not connected to any page or to job payments yet. The existing flow sets a different price per job (the cleaner's price), which a fixed Stripe Price ID does not fit. To use Checkout for jobs you would build the line item with `price_data` from the job's `pricePence` and handle `checkout.session.completed` to move the job to `PAID_HELD`.

## Testing

Use Stripe test mode with a test secret key (`sk_test_...`) and a real test Price ID.

| Card number | Result |
|-------------|--------|
| 4242 4242 4242 4242 | Succeeds |
| 4000 0025 0000 3155 | Requires 3D Secure authentication |
| 4000 0000 0000 9995 | Declined (insufficient funds) |

Use any future expiry date, any 3-digit CVC and any postcode.

Local check: `npm test` (the new test checks the exact parameters sent to Stripe).

## Next steps

- Create your products and prices at https://dashboard.stripe.com/products and put the Price ID in `line_items`.
- Handle `checkout.session.completed` in `src/controllers/StripeWebhookController.js` for fulfilment.
- Add a button on a page that calls the endpoint and redirects to the returned `url`.
- Decide whether the hosted Checkout page should be used for job payments at all (see above).

## Resources

- https://support.stripe.com
- https://docs.stripe.com/mcp
