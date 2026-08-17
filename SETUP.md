# ARK Client Center setup

The owner signup flow is:

1. Main information
2. Email and phone verification
3. Business information
4. In-app Stripe payment setup and $50 monthly subscription
5. Dashboard

Steps 1 through 4 use one `pendingOwnerSignups/{clientId}` record with a hard one-hour expiration. The verification code hashes are stored inside that temporary record. After Stripe confirms the payment method and starts the base subscription, the server creates `accounts/{clientId}` and deletes the temporary record.

Firestore has exactly three top-level collections:

- `accounts` — regular account state and account-owned subcollections
- `pendingOwnerSignups` — one-hour temporary signup records
- `system` — server-only operational records under `system/global`

## Firebase Authentication and Admin

Enable **Firebase Authentication → Sign-in method → Email/Password**. Configure the public `NEXT_PUBLIC_FIREBASE_*` values and these server-only values in Vercel:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

Paste the complete private key. Multiline text and a value containing literal `\n` characters are both supported.

## Stripe

Stripe signup payment requires these two matching keys:

- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`

The `$50 USD per month` amount and interval live in `app/lib/billingPricing.js`. Normally, the server uses the secret key to find an existing active `$50 USD` monthly recurring Price in the current Stripe mode. If none exists, it creates the Product and Price automatically with a stable code lookup key. No Product ID is used.

`STRIPE_ACCOUNT_BASE_PRICE_ID` is an optional signup override. Set it to an active USD flat-rate monthly recurring `price_...` in the same Stripe mode when an owner needs to run a temporary live-price test, such as `$0.01`. Replace it with the normal `$50` Price ID and redeploy before public signup. Changing this variable affects new signups only; it does not change subscriptions that already exist.

`STRIPE_USAGE_PRICE_ID` is required and must identify the active one-time `$20 USD` flat-rate Price for the Usage Product in the same Stripe mode. At each completed threshold, the server validates that Price, charges its exact amount to the saved card, and records the Price and Product IDs on the PaymentIntent metadata. No Stripe Product ID variable is needed.

When switching to live mode, replace only the secret and publishable keys together. The onboarding API rejects mixed test/live keys. If a temporary signup contains a Customer or SetupIntent from the other mode, the server safely creates matching live-mode objects.

The payment return URL uses the domain of the incoming request and successful signup returns to `/`, so `YOUR_DOMAIN` and `APP_HOME_PATH` are not used.

There are no Stripe metered Prices or billing meters. A completed receptionist call or other new lead adds two usage points, a new chat adds one, and each rolling 50 SMS parts adds one. A lead saved from the same receptionist call uses the same event ID and counts once. Whenever the balance reaches or exceeds 20, Stripe uses `STRIPE_USAGE_PRICE_ID` to charge an exact $20 off-session PaymentIntent to the saved card and carries any excess forward. For example, 19 plus a two-point call or lead charges $20 and leaves one point.

Signup does not require a webhook. After Stripe confirms the Payment Element, the browser calls the protected setup-status route, which verifies the SetupIntent, starts the `$50` subscription, and creates the regular account. The existing webhook route can be enabled later for asynchronous recurring-payment notifications; only then does it need its own Stripe signing secret.

The browser never submits a Stripe Customer ID. Protected server routes derive the Customer from the verified Firebase token and server-side temporary or regular account. The Payment Element remains Stripe-controlled; do not add ARK-owned card-number, expiration, or security-code inputs.

## Verification delivery

Configure:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL=ARK Client Center <accounts@your-verified-domain.com>`
- `TELNYX_API_KEY`
- `TELNYX_SIGNUP_FROM_NUMBER=+17742316164`
- `ACCOUNT_VERIFICATION_SECRET` with a long random server-only value

Verify the sending domain in Resend and use a messaging-enabled Telnyx number. `TELNYX_SIGNUP_FROM_NUMBER` sends signup codes and later number-ready messages.

## Arc Admin event bridge

Set `ARC_ADMIN_WEBHOOK_URL` to the separate Arc Admin deployment's `/api/webhooks/events` route. Set the same random `ARC_WEBHOOK_SECRET` with at least 32 bytes in both deployments. ARC Client Center has no administrator login, role, route, or screen.

## Firestore rules and scheduled workflows

Publish the repository rules:

```bash
firebase deploy --only firestore:rules
```

Configure `CRON_SECRET` for the scheduled routes. The daily billing jobs refresh the payment method, retry eligible failed usage or invoice payments no more than once per day, and permanently delete an unpaid account after the full seven-day recovery window. The workflow job also deletes expired temporary signups and expired unverified regular accounts.

Temporary signup access expires exactly one hour after creation. Every protected signup route rejects and deletes an expired record when it is encountered, and the ARK Operations workflow performs a permanent cleanup sweep every 15 minutes. That sweep deletes the temporary Firebase Authentication user, temporary Firestore record, and any current-mode Stripe Customer. A valid unexpired temporary login resumes its saved verification, business-information, or payment step; it never opens the regular app shell.

## Signup behavior

1. Main information creates a Firebase Auth user and one temporary `pendingOwnerSignups/{clientId}` record. It does not create a regular `accounts` record.
2. Separate four-digit email and phone codes are sent, hashed in the temporary record, and both must be verified before business setup opens.
3. Business settings are validated and saved into the temporary record.
4. Stripe confirms an off-session SetupIntent.
5. The server validates the SetupIntent Customer and metadata, starts one base subscription, promotes the verified temporary data into the regular account, initializes a zero-point usage balance, and deletes the temporary record.
6. Arc Admin shows the account under **Needs a Number**, where the private APK assigns the receptionist number.

If a monthly or $20 usage charge is declined, the account immediately becomes `disabled`; connection intake, receptionist calls, and inbound/outbound chat stop. The owner can still sign in and use the payment-update action. A successful retry restores the prior connection and receptionist state.

## Test-mode acceptance checklist

- A new signup has one Auth user and one temporary Firestore record before payment, and that record expires after exactly one hour.
- Business information must be complete before the Payment Element opens.
- Stripe test card `4242 4242 4242 4242` completes the SetupIntent with a future expiry and any valid security code.
- Successful setup starts exactly one $50 monthly base subscription with no metered items.
- A SetupIntent belonging to another user, Customer, or account metadata cannot promote the signup.
- Payment success removes the temporary record and creates one `standard` regular account.
- Email and phone verification happens before business information and payment, and refreshes the token before navigation.
- At 19 usage points, a new two-point call or lead produces one $20 charge and leaves one point.
- A decline immediately disables receptionist calls, chat, and new lead intake.
- Billing retries occur at most daily; the account is deleted after seven full days unpaid.
- Stripe keys never appear in frontend code or API responses.
- If the optional webhook is enabled later, it rejects missing or invalid signatures.

## Password reset

The forgot-password page accepts the business name. The server resolves the registered business email and asks Firebase Authentication to send the reset email.
