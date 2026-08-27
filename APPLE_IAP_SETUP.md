# Apple In-App Purchase setup

The iOS app uses StoreKit 2 for the same four monthly call plans offered on web and Android. Every plan is an auto-renewable subscription. There are no usage-credit or consumable products.

## 1. Confirm the app identifier

In Apple Developer and App Store Connect, use bundle ID `com.arkwebsites.app` and enable In-App Purchase. The checked-in Capacitor configuration, Xcode project, URL scheme, release verifier, and iOS setup script use this identifier.

Changing an existing App Store app's bundle ID is not supported by Apple. If the old identifier already belongs to a submitted app, create or select the App Store record that matches `com.arkwebsites.app` before uploading a build.

## 2. Create one subscription group

Under **Monetization → Subscriptions**, create one subscription group such as `ARK Monthly Call Plans`. Add all four products to that group so a customer can move between plan levels from Apple's subscription-management screen.

| Product ID | Plan | Calls per billing month | Price |
| --- | --- | ---: | ---: |
| `com.arkwebsites.app.starter.monthly` | Starter | 50 | $49.99/month |
| `com.arkwebsites.app.standard.monthly` | Standard | 100 | $79.99/month |
| `com.arkwebsites.app.growth.monthly` | Growth | 250 | $149.99/month |
| `com.arkwebsites.app.pro.monthly` | Pro | 500 | $299.99/month |

Give each product a one-month duration, complete its localization, choose the matching price, and provide the required review screenshot. Product IDs cannot be renamed after creation.

Set the subscription levels in increasing order of service: Pro, Growth, Standard, Starter. Choose the upgrade/downgrade timing and proration behavior you want Apple to apply, then verify it in Sandbox.

## 3. Configure server notifications

In App Store Connect, set the App Store Server Notifications version 2 production and sandbox URL to:

`https://YOUR-APP-DOMAIN/api/billing/apple/notifications`

The endpoint verifies Apple's signed notification and transaction data, updates the active plan and billing period, resets the call allowance at renewal, and disables access when Apple reports that the subscription is no longer active.

## 4. Configure environment variables

Set `APPLE_IAP_APPLE_ID` to the app's numeric Apple ID from **App Information**. The following values match the checked-in defaults; set them explicitly in production if you want configuration drift to fail visibly:

```dotenv
APPLE_IAP_APPLE_ID=1234567890
APPLE_IAP_PLAN_PRODUCT_ID_STARTER=com.arkwebsites.app.starter.monthly
APPLE_IAP_PLAN_PRODUCT_ID_STANDARD=com.arkwebsites.app.standard.monthly
APPLE_IAP_PLAN_PRODUCT_ID_GROWTH=com.arkwebsites.app.growth.monthly
APPLE_IAP_PLAN_PRODUCT_ID_PRO=com.arkwebsites.app.pro.monthly
```

## 5. Sync and test

Run:

```bash
npm run mobile:ios:sync
npm run mobile:verify
```

Then test with Sandbox accounts or StoreKit testing:

1. Each of the four products loads with the expected localized price.
2. A new owner can select each plan and finish signup.
3. Restoring purchases activates the product currently entitled to that Apple Account.
4. Upgrading and downgrading updates the plan shown in Payment.
5. A renewal begins a new call period with the full selected allowance.
6. The Payment screen shows calls used, calls remaining, and the next reset date.
7. Cancellation, expiration, billing retry, grace-period, refund, and revocation notifications produce the expected account state.

For the first submission containing these subscriptions, attach all four products to the app version before App Review. In Review Notes, explain that iOS billing uses StoreKit 2, web and Android use Stripe, and every plan includes a fixed number of completed AI receptionist calls per monthly billing period.
