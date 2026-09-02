# ARK Client Center setup

The owner signup flow is:

1. Main information
2. Email and phone verification
3. Business information
4. Plan selection and Apple In-App Purchase on iOS or Stripe elsewhere
5. Sign-in page

The available monthly plans are defined in `app/lib/billingPricing.js`:

| Plan | Accepted leads per billing month | Price |
| --- | ---: | ---: |
| Starter | 25 | $24.99/month |
| Standard | 50 | $47.49/month |
| Growth | 100 | $89.99/month |
| Scale | 200 | $169.99/month |

Each unique service request counts once when the owner taps **Accept**. Incoming and outgoing calls, declined leads, edits, messages, and SMS parts do not count. Each provider billing period resets the allowance to exactly the plan's included 25, 50, 100, or 200 leads; unused leads do not roll over. When an account reaches its allowance, the owner can wait for renewal, change plans, or buy a custom quantity of temporary top-up leads at exactly $1 per lead. Top-ups expire at the next billing-period reset and receive no volume discount.

## Account creation

Step 1 creates only a Firebase Authentication user and a server-only signup-verification request under `system/global/signupVerificationRequests`; it does not create a Firestore account. After email and phone verification, the server creates one verified `pendingOwnerSignups/{clientId}` record with a one-hour expiration. After Apple or Stripe confirms the chosen subscription, the server creates `accounts/{clientId}`, removes the temporary record, signs the browser out, and sends the owner to `/login`.

Firestore has three top-level collections:

- `accounts` — regular account state and account-owned subcollections, including idempotent accepted-lead events
- `pendingOwnerSignups` — verified, one-hour temporary signup records awaiting business information or payment
- `system` — server-only operational records under `system/global`

## Firebase Authentication and Admin

Enable **Firebase Authentication → Sign-in method → Email/Password** and configure:

- `NEXT_PUBLIC_FIREBASE_*`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

Paste the complete private key. Multiline text and a value containing literal `\n` characters are supported.

## Apple In-App Purchase

iOS uses four StoreKit 2 auto-renewable subscriptions in a single subscription group plus one $1 consumable accepted-lead top-up. Complete the App Store Connect products, server-notification endpoint, environment variables, sandbox testing, and submission steps in [APPLE_IAP_SETUP.md](APPLE_IAP_SETUP.md). Stripe must not be presented by the iOS runtime.

## Stripe on web and Android

Configure matching-mode keys:

- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET` for recurring-payment and billing-period updates

Website and Android signups use the regular plan prices below. There is no separate website discount or promotional Price. Use these exact environment variable names for optional Stripe Price overrides:

The server validates configured Price IDs or creates stable code-managed monthly Prices with these lookup keys:

| Optional environment variable | Required Price | Managed lookup key |
| --- | --- | --- |
| `STRIPE_STARTER_PRICE_ID` | $24.99 USD/month | `ark_client_center_starter_monthly_v5` |
| `STRIPE_STANDARD_PRICE_ID` | $47.49 USD/month | `ark_client_center_standard_monthly_v5` |
| `STRIPE_GROWTH_PRICE_ID` | $89.99 USD/month | `ark_client_center_growth_monthly_v5` |
| `STRIPE_SCALE_PRICE_ID` | $169.99 USD/month | `ark_client_center_scale_monthly_v5` |

Leave an optional Price ID blank to let the server find or create that plan's Price in the current Stripe test/live mode. A stale optional Price from the retired catalog is ignored so ARK can provision the correct current amount; do not configure any usage Price.

Create the extra-lead Price manually in Stripe, then configure this required server-side variable:

| Required environment variable | Required Price |
| --- | --- |
| `STRIPE_ACCEPTED_LEAD_TOP_UP_PRICE_ID` | Active, one-time $1.00 USD Price |

The app only retrieves and validates this Price. It never creates or edits the top-up Product or Price in Stripe.

Enable the Stripe webhook for `customer.subscription.created`, `customer.subscription.updated`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `payment_intent.succeeded`, and `setup_intent.succeeded`. These events keep the plan, accepted-lead reset period, top-ups, card, and payment state current.

ARK's signed-in Payment manager uses Stripe Payment Elements for card updates, Subscription Schedules for next-renewal changes, and a billing-cycle reset with no proration for immediate changes. Immediate changes require successful payment, discard unused prior-plan leads, and begin a fresh allowance period. Stripe PaymentIntents derive the top-up amount from the manually configured $1 Price and record that Price ID in payment metadata. The legacy customer-portal route remains available only as a fallback and is not used by the Payment screen.

The browser never submits a Stripe Customer ID. Protected routes derive the Customer from the verified Firebase token and server-side signup or account. The Payment Element remains Stripe-controlled; do not add ARK-owned card-number, expiration, or security-code fields.

## Verification delivery

Configure:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL=ARK Client Center <accounts@your-verified-domain.com>`
- `TELNYX_API_KEY`
- `TELNYX_SIGNUP_FROM_NUMBER=+17742316164`
- `ACCOUNT_VERIFICATION_SECRET` with a long random server-only value

Verify the sending domain in Resend and use a messaging-enabled Telnyx number. `TELNYX_SIGNUP_FROM_NUMBER` sends signup codes and later number-ready messages.

## ARK Admin event bridge

ARK Client Center forwards signed events to `https://ark-admin-app.vercel.app/api/webhooks/events`. Set the same random `ARK_WEBHOOK_SECRET` of at least 32 bytes in both deployments. `ARK_ADMIN_WEBHOOK_URL` can override the destination. The route sends and accepts `X-ARK-Timestamp` and `X-ARK-Signature`; temporary legacy header and environment aliases remain accepted during the separate ARK Admin migration.

## Firestore rules and scheduled workflows

Publish the repository rules:

```bash
firebase deploy --only firestore:rules
```

Configure `CRON_SECRET`. For Stripe-billed accounts, the daily billing job refreshes the saved payment method and enforces unpaid recurring invoices. Apple controls Apple subscription retries and sends version 2 server notifications; ARK does not auto-delete an Apple-billed account while Apple may still recover the subscription. The workflow also deletes expired verification requests, temporary signups, and unverified legacy accounts.

## Test-mode acceptance checklist

- Before verification, a signup has one Auth user and one server-only verification request, with no account document.
- After email and phone verification, the request becomes one temporary Firestore record that expires in one hour.
- Business information must be complete before plan selection and payment.
- Stripe test card `4242 4242 4242 4242` completes setup with a future expiry and any valid security code.
- Each plan starts exactly one monthly recurring subscription at the configured amount.
- Apple signup recognizes all four products under `com.arkwebsites.app`.
- A SetupIntent or Apple transaction belonging to another owner cannot promote the signup.
- Payment success creates one `standard` account role, initializes the chosen accepted-lead allowance at zero used, signs out, and opens `/login`.
- Reposting an acceptance for the same lead does not count it twice.
- Calls never consume the allowance; after exhaustion, accepting another lead opens upgrade, $1-per-lead top-up, and wait-for-renewal options.
- A new provider billing period resets the allowance to the selected plan's exact base amount and clears all top-ups without rollover.
- A scheduled plan change starts at renewal. An immediate Stripe plan change charges the new monthly price, starts a fresh period, and discards unused prior-plan leads.
- Stripe and Apple top-up settlement is idempotent, and the paid lead quantity is added only once.
- A failed recurring subscription payment disables receptionist calls and intake until payment recovery.
- Stripe secrets never appear in frontend code or API responses.
- Billing webhooks reject missing or invalid signatures.

## Password reset

The forgot-password page accepts the business name. The server resolves the registered business email and asks Firebase Authentication to send the reset email.
