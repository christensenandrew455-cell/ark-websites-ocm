# ARK Client Center account and payment setup

The app now supports business signup, Stripe-hosted payment-method setup, business-name login, password reset, account-isolated CRM data, and an ARK admin account that can switch businesses.

## 1. Enable Firebase Authentication

In Firebase Console:

1. Open **Authentication**.
2. Click **Get started** if Authentication has not been enabled.
3. Open **Sign-in method**.
4. Enable **Email/Password**.

Keep the existing `NEXT_PUBLIC_FIREBASE_*` values configured in Vercel.

## 2. Add Firebase Admin credentials to Vercel

In Firebase Console, open **Project settings > Service accounts** and generate a new private key.

Add these server-only Vercel environment variables:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

For `FIREBASE_PRIVATE_KEY`, paste the entire private key. Vercel can store the multiline value directly. The application also supports a value containing literal `\n` characters.

## 3. Add Stripe to Vercel

Stay in Stripe Sandbox while testing. Under **Developers > API keys**, copy the sandbox secret key and add it to Vercel as:

- `STRIPE_SECRET_KEY`

Do not place the Stripe secret key in browser code or in any `NEXT_PUBLIC_` variable.

Also add:

- `NEXT_PUBLIC_APP_URL=https://ark-websites-ocm.vercel.app`

Signup uses Stripe Checkout in `setup` mode. Stripe collects and stores the card information; ARK Client Center receives only the saved payment-method reference and card label.

Signup details are encrypted on the server before Stripe opens and are retained in Firebase for no more than six hours. This lets Stripe return through the browser or native app without depending on that browser tab's session storage.

Add the verification delivery variables:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL=ARK Client Center <accounts@your-verified-domain.com>`
- `TELNYX_API_KEY`
- `TELNYX_SIGNUP_FROM_NUMBER=+17742316164`

`TELNYX_SIGNUP_FROM_NUMBER` is the one central ARK number that sends signup codes and the later receptionist-number-ready message. Verify the sending domain in Resend and use a messaging-enabled Telnyx number.

## 4. Configure the ARK admin account

Create your owner/admin user in **Firebase Authentication > Users**, using your email and password.

Add the same email to Vercel as:

- `ADMIN_EMAILS=your-email@example.com`

Multiple admin emails can be separated with commas. On login, the app gives those emails the Firebase `admin` claim. The dashboard then shows a business chooser. Normal business accounts only see their own assigned business.

Admin accounts may enter their email in the login page's **Business name** field.

## 5. Publish the Firestore rules

The repository contains the account-isolated rules in `firestore.rules` and the deployment configuration in `firebase.json`.

Publish those rules through Firebase Console, or run:

```bash
firebase deploy --only firestore:rules
```

After the rules are published:

- a normal account can access only its own `clientId`
- an admin account can access all registered businesses
- public intake and scheduled workflows continue through Firebase Admin

## 6. Signup behavior

1. The customer enters the business and owner information, password, and an optional referring account ID.
2. The customer reviews the About page.
3. Stripe Checkout collects the payment method.
4. Stripe returns through `arkclientcenter://open` in the native app, with a same-origin browser fallback.
5. The server verifies the SetupIntent, starts the paid subscription, creates the active account, and qualifies any valid referral.
6. The owner must enter separate four-digit codes delivered by email and text before the rest of the client center is accessible.
7. The owner may complete or skip the guided app tour.
8. The administrator sees the active account under **Needs a Number**, assigns a same-area-code receptionist number, and the owner receives a text when it is ready.

If Stripe is canceled, the native return link sends the owner back to signup status. The encrypted pending draft remains available until its six-hour expiration so signup can be retried safely.

The standard billing model is $50 per monthly period, $2 per connected AI receptionist call, $1 per new chat plus $1 per 50 SMS parts, and $5 per active employee used at any time during the period. Deleting usage records does not reduce recorded billing. A lead saved from a counted call is not another charge. Each qualified referral saves 10% for one billing period, up to five referrals and 50% off.

## 7. Password reset

The forgot-password page accepts the business name. The server finds the registered business email and asks Firebase Authentication to send the reset email.
