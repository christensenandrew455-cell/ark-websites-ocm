# ARK Client Center account and payment setup

The account-creation flow is:

1. Main information
2. Email and phone verification
3. Business information
4. In-app Stripe payment-method setup
5. Existing app Dashboard

The last signup screen uses Stripe's Payment Element and a SetupIntent. It saves a payment method to the authenticated account's Stripe Customer and does not charge the customer on that screen.

## 1. Firebase Authentication

In Firebase Console, enable **Authentication → Sign-in method → Email/Password**.

Keep the existing `NEXT_PUBLIC_FIREBASE_*` values configured in Vercel.

## 2. Firebase Admin credentials

In Firebase Console, open **Project settings → Service accounts** and generate a server credential. Add these server-only Vercel environment variables:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

For `FIREBASE_PRIVATE_KEY`, paste the complete private key. Vercel can store the multiline value directly; the application also supports a value containing literal `\n` characters.

## 3. Stripe test-mode setup

Use Stripe test mode until the full onboarding checklist below passes. Add:

- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `YOUR_DOMAIN=https://ark-websites-ocm-xi.vercel.app`
- `APP_HOME_PATH=/`

The publishable key is returned to the signed-in payment page by a protected server route. The secret and webhook keys must remain server-only and must never use a `NEXT_PUBLIC_` name.

A secret key was exposed in older code. Revoke or rotate that key in Stripe and configure only the replacement. Do not copy the old key into this project or deployment.

Register the production webhook endpoint as:

```text
https://ark-websites-ocm-xi.vercel.app/api/billing/webhook
```

Subscribe it at minimum to SetupIntent success/failure events and the invoice/subscription events used by the existing billing enforcement logic. Production requests are rejected unless the Stripe signature validates with `STRIPE_WEBHOOK_SECRET`.

The onboarding route determines the Stripe Customer from the verified Firebase token and the server-side account record. The browser never submits or selects a Stripe Customer ID. If the account does not have a Customer, the server creates one with an idempotency key and saves its ID before creating the SetupIntent.

The Payment Element is Stripe-controlled. Do not replace it with card-number, expiration, or security-code inputs owned by ARK.

## 4. Recurring billing configuration

The known Stripe Product is:

```text
prod_V30kc7tD7n7F
```

That is a Product ID, not a Price ID, and the payment-method setup screen does not use it. Configure the recurring `price_...` attached to that product when the separate subscription-start process is enabled. Existing billing configuration accepts:

- `STRIPE_ACCOUNT_PRODUCT_ID`
- `STRIPE_ACCOUNT_BASE_PRICE_ID`
- `STRIPE_ACCOUNT_LEAD_PRICE_ID`
- `STRIPE_ACCOUNT_CHAT_PRICE_ID`
- `STRIPE_ACCOUNT_MESSAGE_PRICE_ID`

Set `STRIPE_ACCOUNT_PRODUCT_ID` to the mode-appropriate Product ID and set `STRIPE_ACCOUNT_BASE_PRICE_ID` to its active $50 USD monthly recurring Price. Test and live modes have separate objects, so use the matching IDs in each environment. The billing code verifies the Price amount, currency, recurrence, active state, and Product before it can create or align a subscription. The signup SetupIntent remains separate from subscription creation and does not create an invoice or immediate charge.

If Stripe's hosted billing portal is enabled for later payment-method management, also configure:

- `STRIPE_BILLING_PORTAL_CONFIGURATION_ID`

The portal is not part of signup.

## 5. Verification delivery

Add:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL=ARK Client Center <accounts@your-verified-domain.com>`
- `TELNYX_API_KEY`
- `TELNYX_SIGNUP_FROM_NUMBER=+17742316164`

`TELNYX_SIGNUP_FROM_NUMBER` is the central ARK number that sends signup codes and the later receptionist-number-ready message. Verify the sending domain in Resend and use a messaging-enabled Telnyx number.

## 6. ARK administrator account

Create the administrator user in **Firebase Authentication → Users**, using the intended email and password. Add the same email to Vercel as:

- `ADMIN_EMAILS=your-email@example.com`

Separate multiple administrator emails with commas. On login, the app gives a configured email the Firebase `admin` claim. The dashboard then shows the business chooser. Business accounts see only their own assigned data.

Administrators may enter their email in the login page's **Business name** field.

## 7. Firestore rules

The repository contains account-isolated rules in `firestore.rules` and deployment configuration in `firebase.json`. Publish them through Firebase Console or run:

```bash
firebase deploy --only firestore:rules
```

After publication, a normal active account can access only its own `clientId`, administrators can access registered businesses, and signup/verification writes remain server-only.

## 8. Signup behavior

1. The owner submits main account information, a password, required legal acceptance, and an optional referring account ID.
2. The server creates a restricted Firebase account and sends separate four-digit codes by email and text.
3. Both contacts must be verified before business setup opens.
4. The owner completes business and AI receptionist information.
5. The in-app Payment Element saves a card to the Stripe Customer through a SetupIntent with `usage: off_session`.
6. The browser submits only the SetupIntent ID. The server retrieves it from Stripe, verifies its success, Customer, account metadata, and authenticated user, and then activates the account.
7. The owner is sent to the existing Dashboard. The administrator sees the account under **Needs a Number**, assigns a receptionist number, and the owner receives a text when it is ready.

The standard billing model is $50 per monthly period, $2 per new lead, $1 per new chat when Messages is available, plus $1 per 50 SMS parts. Deleting usage records does not reduce recorded billing. Each qualified referral saves 10% for one billing period, up to five referrals and 50% off.

## 9. Test-mode acceptance checklist

- A new account receives one correct Stripe Customer.
- Email and phone verification both occur before business information.
- Business information must be complete before the payment page opens.
- The Payment Element appears inside ARK Client Center.
- Stripe test card `4242 4242 4242 4242` can complete the SetupIntent with a future expiry and any valid security code.
- No charge or subscription is created by the payment setup screen.
- The saved PaymentMethod belongs to the authenticated account's Customer and becomes that Customer's default invoice payment method.
- A failed or incomplete SetupIntent shows the selected failure message and does not activate the account.
- A SetupIntent belonging to another user, Customer, or account metadata cannot activate the account.
- A successful user sees `account set up complete` and reaches the existing Dashboard.
- Stripe secret and webhook keys never appear in frontend JavaScript or API responses.
- The production webhook rejects missing or invalid signatures.
- The exposed historical key is revoked before deployment.

## 10. Password reset

The forgot-password page accepts the business name. The server finds the registered business email and asks Firebase Authentication to send the reset email.
