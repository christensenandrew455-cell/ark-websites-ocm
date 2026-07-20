# ARK Client Center mobile shell

This directory supplies the local fallback pages required by Capacitor.

The current Android test build loads the production OCM at `https://ark-websites-ocm.vercel.app` so the live login, Firebase data, and Next.js API routes continue to work while the native shell is tested on a physical phone.

The Android project is generated in GitHub Actions and is intentionally not committed. Before a Google Play production release, the mobile web interface should be bundled locally rather than relying on Capacitor's remote development URL setting.
