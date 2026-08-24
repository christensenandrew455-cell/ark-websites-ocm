# Apple in-app purchase setup

The iOS app uses StoreKit 2. Web and Android continue to use Stripe. Apple does not provide a subscription that renews whenever an internal usage meter reaches a value, so ARK uses:

- One **auto-renewable monthly subscription** for the $50 base plan.
- One **consumable 20-credit purchase** whenever usage reaches 20 points. The purchase sheet always requires the customer to confirm with Apple.
- Six consumable product variants so the existing 0%–50% referral savings remain available.

The server verifies every Apple-signed JWS transaction against Apple's certificate chain, bundle ID, environment, product ID, ARK account token, expiration, and revocation state before it activates an account or grants credits. The native app finishes a StoreKit transaction only after that verification succeeds.

## 1. Agreements and capability

In App Store Connect, finish the Paid Apps Agreement, tax, and banking setup. Confirm the app bundle ID is `com.arkwebsites.clientcenter` and that In-App Purchase is enabled for the identifier. The checked-in Xcode project and `scripts/configure-ios.mjs` already enable the matching capability.

## 2. Create the subscription

Under **Monetization → Subscriptions**, create a subscription group such as `ARK Client Center`, then create:

| Product ID | Type | US price | Duration |
|---|---|---:|---|
| `com.arkwebsites.clientcenter.base.monthly` | Auto-renewable subscription | $50.00 | 1 month |

Suggested display name: `ARK Monthly`. Explain that this unlocks the ARK Client Center service. Add the required localization and App Review screenshot.

## 3. Create usage consumables

Under **Monetization → In-App Purchases**, create these products as **Consumable** purchases. Each grants 20 ARK usage credits; the separate prices reflect earned referral savings.

| Product ID | Referral savings | US price |
|---|---:|---:|
| `com.arkwebsites.clientcenter.usage20.referral0` | 0% | $20.00 |
| `com.arkwebsites.clientcenter.usage20.referral10` | 10% | $18.00 |
| `com.arkwebsites.clientcenter.usage20.referral20` | 20% | $16.00 |
| `com.arkwebsites.clientcenter.usage20.referral30` | 30% | $14.00 |
| `com.arkwebsites.clientcenter.usage20.referral40` | 40% | $12.00 |
| `com.arkwebsites.clientcenter.usage20.referral50` | 50% | $10.00 |

Add localization, review screenshots, and a clear display name such as `20 Usage Credits` / `20 Usage Credits — 10% Referral Savings`. Configure equivalent localized prices for every storefront you plan to sell in. Product identifiers cannot be renamed after creation.

## 4. Configure server notifications

Under the app's App Store Server Notifications settings, set both Production and Sandbox version 2 URLs to:

`https://www.arkclientcenter.com/api/billing/apple/notifications`

Send Apple's test notification and confirm the endpoint returns HTTP 200 with `{ "received": true, "test": true }`.

## 5. Configure production environment variables

Set the variables listed in `.env.example`. `APPLE_IAP_APPLE_ID` must be the app's numeric Apple ID from **App Information**. Keep the default product identifiers unless App Store Connect products were created with different identifiers, in which case set the matching overrides exactly.

No App Store Connect API key or private signing key is required for this implementation. Transaction and notification authenticity comes from Apple's signed payloads and public root certificate chain.

## 6. Sync, test, and submit

Run:

```sh
npm run mobile:ios:sync
npm run mobile:verify
```

Test on a real device with an App Store sandbox account or TestFlight:

1. A new iOS signup shows `Subscribe with Apple`, Apple's localized monthly price, renewal terms, Terms of Use, Privacy Policy, and Restore Purchases. It must not show Stripe.
2. Canceling the Apple sheet leaves the temporary signup unchanged and makes no charge.
3. Completing the subscription activates the ARK account.
4. At 20 usage points, the app shows the correct referral-adjusted consumable and grants exactly 20 non-expiring usage credits after confirmation.
5. Replaying or restoring a transaction does not grant it twice.
6. Settings opens Apple's subscription-management sheet for Apple-billed accounts.

For the first submission containing these products, attach the subscription and all consumables to the app version before sending it to App Review. In Review Notes, explain that Stripe is used only on non-iOS platforms; iOS digital access and usage credits use StoreKit 2, and tell the reviewer how to reach the usage-purchase prompt.
