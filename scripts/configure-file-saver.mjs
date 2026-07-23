import { mkdir, readFile, writeFile } from "node:fs/promises";

const javaDirectory = "android/app/src/main/java/com/arkwebsites/clientcenter";
const mainActivityPath = `${javaDirectory}/MainActivity.java`;
const pluginSourcePath = "mobile-shell/android/FileSaverPlugin.java";
const pluginTargetPath = `${javaDirectory}/FileSaverPlugin.java`;

await mkdir(javaDirectory, { recursive: true });

const pluginSource = await readFile(pluginSourcePath, "utf8");
await writeFile(pluginTargetPath, pluginSource, "utf8");

let mainActivity = await readFile(mainActivityPath, "utf8");
const registration = "registerPlugin(FileSaverPlugin.class);";
if (!mainActivity.includes(registration)) {
  const phoneRegistration = "registerPlugin(PhonePermissionsPlugin.class);";
  const contactRegistration = "registerPlugin(ContactEditorPlugin.class);";

  if (mainActivity.includes(phoneRegistration)) {
    mainActivity = mainActivity.replace(phoneRegistration, `${phoneRegistration}\n        ${registration}`);
  } else if (mainActivity.includes(contactRegistration)) {
    mainActivity = mainActivity.replace(contactRegistration, `${contactRegistration}\n        ${registration}`);
  } else {
    mainActivity = mainActivity.replace(
      "super.onCreate(savedInstanceState);",
      `${registration}\n        super.onCreate(savedInstanceState);`,
    );
  }

  await writeFile(mainActivityPath, mainActivity, "utf8");
}

const verifiedActivity = await readFile(mainActivityPath, "utf8");
if (!verifiedActivity.includes(registration)) {
  throw new Error("Android FileSaverPlugin registration is missing from MainActivity.java.");
}

console.log("[Android file saver] System document save picker registered and verified without storage permission.");
