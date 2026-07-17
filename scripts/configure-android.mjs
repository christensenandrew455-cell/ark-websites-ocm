import { readFile, writeFile } from "node:fs/promises";

const manifestPath = "android/app/src/main/AndroidManifest.xml";
const permissions = [
  "android.permission.READ_CALENDAR",
  "android.permission.WRITE_CALENDAR",
  "android.permission.READ_CONTACTS",
  "android.permission.WRITE_CONTACTS",
];

let manifest = await readFile(manifestPath, "utf8");
const missing = permissions.filter((permission) => !manifest.includes(`android:name=\"${permission}\"`));

if (missing.length) {
  const permissionLines = missing
    .map((permission) => `    <uses-permission android:name=\"${permission}\" />`)
    .join("\n");
  manifest = manifest.replace(/<application\b/, `${permissionLines}\n\n    <application`);
  await writeFile(manifestPath, manifest, "utf8");
  console.log(`[Android configuration] Added ${missing.length} native permission(s).`);
} else {
  console.log("[Android configuration] Native permissions already present.");
}
