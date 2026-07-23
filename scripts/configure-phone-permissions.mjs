import { mkdir, readFile, writeFile } from "node:fs/promises";

const manifestPath = "android/app/src/main/AndroidManifest.xml";
const javaDirectory = "android/app/src/main/java/com/arkwebsites/clientcenter";
const mainActivityPath = `${javaDirectory}/MainActivity.java`;
const pluginSourcePath = "mobile-shell/android/PhonePermissionsPlugin.java";
const pluginTargetPath = `${javaDirectory}/PhonePermissionsPlugin.java`;
const permissions = [
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.READ_CALENDAR",
  "android.permission.WRITE_CALENDAR",
  "android.permission.READ_CONTACTS",
  "android.permission.WRITE_CONTACTS",
];

await mkdir(javaDirectory, { recursive: true });

let manifest = await readFile(manifestPath, "utf8");
const missingPermissions = permissions.filter((permission) => !manifest.includes(`android:name=\"${permission}\"`));
if (missingPermissions.length) {
  const permissionLines = missingPermissions
    .map((permission) => `    <uses-permission android:name=\"${permission}\" />`)
    .join("\n");
  manifest = manifest.replace(
    /<application\b/,
    `${permissionLines}\n\n    <application`
  );
  await writeFile(manifestPath, manifest, "utf8");
  console.log(`[Android permissions] Added ${missingPermissions.length} permission declaration(s) to the manifest.`);
}

const pluginSource = await readFile(pluginSourcePath, "utf8");
await writeFile(pluginTargetPath, pluginSource, "utf8");

let mainActivity = await readFile(mainActivityPath, "utf8");
const registration = "registerPlugin(PhonePermissionsPlugin.class);";
if (!mainActivity.includes(registration)) {
  const contactRegistration = "registerPlugin(ContactEditorPlugin.class);";
  if (mainActivity.includes(contactRegistration)) {
    mainActivity = mainActivity.replace(
      contactRegistration,
      `${contactRegistration}\n        ${registration}`
    );
  } else {
    mainActivity = mainActivity.replace(
      "super.onCreate(savedInstanceState);",
      `${registration}\n        super.onCreate(savedInstanceState);`
    );
  }
  await writeFile(mainActivityPath, mainActivity, "utf8");
}

console.log("[Android permissions] Notifications, contacts, and calendar permission checker registered.");
