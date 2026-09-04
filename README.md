# ARK Client Center

ARK Client Center is the customer application for Firebase-backed account access, Apple in-app purchases on iOS, Stripe billing on other platforms, lead management, and Capacitor mobile projects. Private operations live in the separate ARK Admin repository.

## Project structure

```text
app/
  api/                 Server routes grouped by feature and access level
    account/           Signed-in customer account actions
    auth/              Authentication endpoints
    billing/           Apple and Stripe billing, transaction, and webhook endpoints
    notifications/     Device and notification endpoints
    support/           Public support endpoint
    signup/            Account application and setup endpoints
  components/          Reusable client-side UI and providers
  lib/                 Shared client/server utilities and service modules
  about/               Public app overview
  docs/                Public product documentation
  login/               Business login
  messages/            Customer help requests and replies
  privacy/             Public privacy policy
  settings/            Customer account settings
  signup/              Account application flow
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
- Keep signed-in customer actions under `api/account` and public submissions under their feature-specific routes. Do not add private operations routes or screens to this repository.
- Send account, lead, support, receptionist, and successful-payment events to ARK Admin through the signed event webhook.
- Write every successful Stripe or Apple payment to the shared idempotent revenue ledger; the billing sync reconciles historical provider records so a missed webhook cannot erase revenue.
- Receive signed number assignments back from ARK Admin at `/api/webhooks/admin`, apply them to the account, and send the owner's Firebase app notification.
- Keep Firebase Admin code server-only. Do not import `firebase-admin` modules into client components.
- Use `normalizeClientId` from `app/lib/valueUtils.js` whenever a business or client identifier becomes a Firestore document ID.
- Use `toIsoString` or `serializeFirestoreValue` from `app/lib/valueUtils.js` when returning Firestore timestamps through an API.
- Keep Terms, Privacy, Docs, and About publicly accessible for customers and app-store review. Public support is hosted at `https://arkwebsites.com/support`.
- Do not commit secrets, Firebase private keys, Stripe secrets, signing keys, or production environment files.

## Messaging compliance flow

- The receptionist records verbal contact consent before a lead is saved.
- The first outbound chat sends an automatic consent confirmation before the owner's message.
- Telnyx profile keyword responses provide the configured STOP, START, and HELP confirmations.
- The inbound webhook mirrors those keywords into Firestore so STOP locks the ARK Client Center composer, START restores it, and HELP/REPORT creates a platform compliance event.
- The public reporting path is configured with `ARK_CLIENT_CENTER_SUPPORT_URL` and defaults to `https://arkwebsites.com/support`.
- Do not add a second application-level STOP or HELP autoresponse while Telnyx Advanced Opt-Out is enabled, because that would send duplicate replies.

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

Verify both store configurations after syncing:

```bash
npm run mobile:verify
```

Both native projects load the secure production app at `https://www.arkclientcenter.com`. Release builds disable Capacitor logging and WebView debugging. Android targets API level 36 and defaults to an Android App Bundle (`.aab`).

For Google Play, run the Android setup, open the generated `android` folder in Android Studio, then use **Build → Generate Signed Bundle / APK → Android App Bundle**. The GitHub Android workflow compiles the release App Bundle to catch release-only errors, but its downloadable debug APK is only for device testing and must not be uploaded to Google Play.

For the App Store, complete [APPLE_IAP_SETUP.md](APPLE_IAP_SETUP.md), sync iOS, open `ios/App/App.xcodeproj` in Xcode, select **Any iOS Device (arm64)**, and use **Product → Archive**. The checked-in icon is a 1024-by-1024 alpha-free RGB PNG, and the GitHub iOS workflow compiles the Release configuration from a clean clone.

The setup scripts regenerate required native configuration and app assets. Make source changes in the maintained scripts or source directories rather than editing generated output without updating its generator.

## Deployment checks

Changes pushed to `main` run the web build, production smoke test, Vercel deployment status, and Android build workflow. Treat a change as complete only after the relevant checks pass.
