# ARK Client Center

ARK Client Center is a Next.js application with Firebase authentication and data storage, Stripe billing, administrator workflows, customer lead management, and Capacitor mobile projects.

## Project structure

```text
app/
  api/                 Server routes grouped by feature and access level
    account/           Signed-in customer account actions
    admin/             Administrator-only actions
    auth/              Authentication endpoints
    billing/           Stripe billing and webhook endpoints
    notifications/     Device and notification endpoints
    public/            Public support endpoints
    signup/            Account application and setup endpoints
  components/          Reusable client-side UI and providers
  lib/                 Shared client/server utilities and service modules
  about/               Public app overview
  docs/                Public product documentation
  login/               Business login
  messages/            Customer requests and administrator messages
  payment/             Administrator payment review
  privacy/             Public privacy policy
  settings/            Customer account settings
  signup/              Account application flow
  support/             Public support form
  terms/               Public terms of use
android/                Generated Capacitor Android project
  app/src/main/         Native Android app resources and source
  app/src/main-native/  Custom native source copied during setup
  scripts/              Android project setup helpers

ios/                    Capacitor iOS project and native resources
scripts/                 Cross-platform mobile setup and asset generators
.github/workflows/       Build, deployment, and enforcement workflows
```

## File conventions

- Keep page entry files in `app/<route>/page.js` focused on layout and orchestration.
- Put reusable UI in `app/components`.
- Put shared formatting, identifiers, authentication helpers, and service logic in `app/lib` rather than copying functions into routes.
- Group API routes by audience: customer actions under `api/account`, administrator actions under `api/admin`, and unauthenticated actions under `api/public`.
- Keep Firebase Admin code server-only. Do not import `firebase-admin` modules into client components.
- Use `normalizeClientId` from `app/lib/valueUtils.js` whenever a business or client identifier becomes a Firestore document ID.
- Use `toIsoString` or `serializeFirestoreValue` from `app/lib/valueUtils.js` when returning Firestore timestamps through an API.
- Keep Terms, Privacy, Docs, About, and Support publicly accessible for customers and app-store review.
- Do not commit secrets, Firebase private keys, Stripe secrets, signing keys, or production environment files.

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Mobile projects

Android setup and synchronization:

```bash
npm run mobile:android:sync
```

iOS setup and synchronization:

```bash
npm run mobile:ios:sync
```

The setup scripts regenerate required native configuration and app assets. Make source changes in the maintained scripts or source directories rather than editing generated output without updating its generator.

## Deployment checks

Changes pushed to `main` run the production smoke test, Vercel deployment status, and Android build workflow. Treat a change as complete only after the relevant checks pass.
