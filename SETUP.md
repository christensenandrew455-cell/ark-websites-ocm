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

Use Stripe test mode until the acceptance checklist passes. Configure:

- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `YOUR_DOMAIN=https://ark-websites-ocm-xi.vercel.app`
- `APP_HOME_PATH=/`
- `STRIPE_ACCOUNT_PRODUCT_ID`
- `STRIPE_ACCOUNT_BASE_PRICE_ID`
- `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` when the portal is enabled

`STRIPE_ACCOUNT_BASE_PRICE_ID` must be the active $50 USD monthly recurring Price attached to the configured Product. Test and live mode use different object IDs. The server verifies the Price amount, currency, recurrence, active state, and Product before starting a subscription.

There are no Stripe metered Prices or billing meters. A completed receptionist call or other new lead adds two usage points, a new chat adds one, and each rolling 50 SMS parts adds one. A lead saved from the same receptionist call uses the same event ID and counts once. Whenever the balance reaches or exceeds 20, Stripe charges an exact $20 off-session PaymentIntent and carries any excess forward. For example, 19 plus a two-point call or lead charges $20 and leaves one point.

Register this webhook endpoint:

```text
https://ark-websites-ocm-xi.vercel.app/api/billing/webhook
```

Subscribe it to SetupIntent, invoice payment, subscription, and PaymentIntent events used by the app. Production requests are rejected unless the Stripe signature validates with `STRIPE_WEBHOOK_SECRET`.

The browser never submits a Stripe Customer ID. Protected server routes derive the Customer from the verified Firebase token and server-side temporary or regular account. The Payment Element remains Stripe-controlled; do not add ARK-owned card-number, expiration, or security-code inputs.

## Verification delivery

Configure:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL=ARK Client Center <accounts@your-verified-domain.com>`
- `TELNYX_API_KEY`
- `TELNYX_SIGNUP_FROM_NUMBER=+17742316164`
- `ACCOUNT_VERIFICATION_SECRET` with a long random server-only value

Verify the sending domain in Resend and use a messaging-enabled Telnyx number. `TELNYX_SIGNUP_FROM_NUMBER` sends signup codes and later number-ready messages.

## Administrator account

Create the administrator in Firebase Authentication and add the same email to `ADMIN_EMAILS`. Separate multiple emails with commas. The app uses only two roles: `admin` and `standard`.

## Firestore rules and scheduled workflows

Publish the repository rules:

```bash
firebase deploy --only firestore:rules
```

Configure `CRON_SECRET` for the scheduled routes. The daily billing jobs refresh the payment method, retry eligible failed usage or invoice payments no more than once per day, and permanently delete an unpaid account after the full seven-day recovery window. The workflow job also deletes expired temporary signups and expired unverified regular accounts.

## Signup behavior

1. Main information creates a Firebase Auth user and one temporary `pendingOwnerSignups/{clientId}` record. It does not create a regular `accounts` record.
2. Separate four-digit email and phone codes are sent, hashed in the temporary record, and both must be verified before business setup opens.
3. Business settings are validated and saved into the temporary record.
4. Stripe confirms an off-session SetupIntent.
5. The server validates the SetupIntent Customer and metadata, starts one base subscription, promotes the verified temporary data into the regular account, initializes a zero-point usage balance, and deletes the temporary record.
6. The administrator assigns the receptionist number through **Needs a Number**.

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
- The webhook rejects missing or invalid signatures.

## Password reset

The forgot-password page accepts the business name. The server resolves the registered business email and asks Firebase Authentication to send the reset email.
