import { mkdir, readFile, writeFile } from "node:fs/promises";

const manifestPath = "android/app/src/main/AndroidManifest.xml";
const javaDirectory = "android/app/src/main/java/com/arkwebsites/clientcenter";
const mainActivityPath = `${javaDirectory}/MainActivity.java`;
const pluginSourcePath = "mobile-shell/android/PhonePermissionsPlugin.java";
const pluginTargetPath = `${javaDirectory}/PhonePermissionsPlugin.java`;
const notificationPermission = "android.permission.POST_NOTIFICATIONS";

await mkdir(javaDirectory, { recursive: true });

let manifest = await readFile(manifestPath, "utf8");
if (!manifest.includes(`android:name=\"${notificationPermission}\"`)) {
  manifest = manifest.replace(
    /<application\b/,
    `    <uses-permission android:name=\"${notificationPermission}\" />\n\n    <application`
  );
  await writeFile(manifestPath, manifest, "utf8");
  console.log("[Android permissions] Added notification permission to the manifest.");
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

console.log("[Android permissions] Native phone permission checker registered.");
