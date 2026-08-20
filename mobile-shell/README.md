# ARK Client Center mobile shell

This directory supplies the local fallback pages required by Capacitor.

The iOS and Android builds load ARK Client Center at `https://www.arkclientcenter.com` so the live login, Firebase data, and Next.js API routes work inside the native shell.

The Android project is generated in GitHub Actions and is intentionally not committed. Before a Google Play production release, the mobile web interface should be bundled locally rather than relying on Capacitor's remote development URL setting.
