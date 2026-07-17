# Native notification setup

The app code, Android plugins, immediate new-lead push path, unread tracking, hourly reminder workflow, calendar access, and contact access are already implemented.

Two account-level configurations are still required before push notifications and hourly reminders can deliver.

## 1. Connect the Android app to Firebase Cloud Messaging

1. Open the Firebase project used by ARK OCM.
2. Add an Android app with package name:

   `com.arkwebsites.clientcenter`

3. Download the generated `google-services.json` file.
4. Convert the file to Base64 on Windows PowerShell:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Downloads\google-services.json")) | Set-Clipboard
   ```

5. In the GitHub repository, open **Settings → Secrets and variables → Actions**.
6. Add a repository secret named:

   `FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_BASE64`

7. Paste the Base64 value as the secret.
8. Run the **Android Test APK** workflow again and install the newly generated APK.

Do not commit `google-services.json` directly to the repository.

## 2. Enable hourly unread-lead reminders

Create one long random secret value. The exact same value must be stored in both places below.

### Vercel environment variable

Name:

`OCM_REMINDER_SECRET`

Add it to the production environment, then redeploy.

### GitHub Actions secret

Name:

`OCM_REMINDER_SECRET`

Add it under **Settings → Secrets and variables → Actions**.

The **Hourly Lead Reminders** workflow runs near the seventh minute of each hour. It calls the protected production reminder endpoint. A reminder is sent only when a registered device still has unread leads and has not received another reminder within roughly the previous hour.

## App behavior

- A new lead saved to `contactedMe` triggers an immediate push notification.
- Tapping the notification opens the **Clients → Contacted Me** list.
- Opening **Contacted Me** marks the current user's registered devices as viewed and clears delivered lead notifications on Android.
- Calendar permission is requested only when accepting a lead into the calendar.
- Contacts permission is requested only when using **Accept + Contact**.
- Lead acceptance is not rolled back if calendar or contacts permission is denied.

## Testing order

1. Install the newly built APK.
2. Sign in with a customer account, not the administrator account.
3. Enable notifications when prompted.
4. Submit a real or controlled test lead through the protected intake webhook.
5. Confirm the immediate notification opens Contacted Me.
6. Leave another lead unread and manually run **Hourly Lead Reminders** to test without waiting an hour.
