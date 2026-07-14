# ARK OCM authentication and billing setup

The app now uses Firebase Authentication, Firestore account records, Firebase custom claims, and Stripe-hosted card setup.

## 1. Firebase Authentication

In the Firebase console, enable **Authentication > Sign-in method > Email/Password**.

Create a Firebase service account and add these server-only variables to Vercel:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

Keep the existing `NEXT_PUBLIC_FIREBASE_*` browser variables configured.

## 2. Stripe

Add `STRIPE_SECRET_KEY` to Vercel. Signup uses Stripe Checkout in `setup` mode, so the card is securely stored with Stripe and the ARK OCM server never receives the card number.

Set `NEXT_PUBLIC_APP_URL` to the deployed site origin, for example `https://ark-websites-ocm.vercel.app`.

## 3. Admin account

Create the owner account in Firebase Authentication with an email and password. Add that email to `ADMIN_EMAILS` in Vercel. Multiple admin emails can be comma-separated.

On the next login, the server assigns the Firebase `admin` custom claim. The dashboard's **Current business/client ID** field becomes editable only for that account. Type a business name or client ID and press Enter or click **Open**.

## 4. Firestore rules

Deploy the included rules:

```bash
firebase deploy --only firestore:rules
```

Customers can access only the client ID in their signed Firebase token. Admin accounts can access every registered business.

## 5. Signup behavior

1. Customer enters business name, owner name, account email, phone, and password.
2. Stripe Checkout collects and verifies the card.
3. The server verifies the completed Stripe SetupIntent.
4. Only then does the server create the Firebase Auth user and Firestore business records.
5. The customer is signed in and routed to their own dashboard.
