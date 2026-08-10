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
4. The server verifies that Stripe completed the SetupIntent and activates the existing Firebase account and business records.
5. The owner finishes the receptionist business setup and opens ARK Client Center.

If Stripe is canceled, the saved owner account returns to payment setup instead of being discarded.

The standard billing model is $50 per monthly period, $2 per connected AI receptionist call, $1 per new chat plus $1 per 50 SMS parts, and $5 per active employee used at any time during the period. Deleting usage records does not reduce recorded billing. A lead saved from a counted call is not another charge. Each qualified referral saves 10% for one billing period, up to five referrals and 50% off.

## 7. Password reset

The forgot-password page accepts the business name. The server finds the registered business email and asks Firebase Authentication to send the reset email.
