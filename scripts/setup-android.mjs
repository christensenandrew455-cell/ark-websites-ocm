import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const EXPECTED_APP_ID = "com.arkwebsites.clientcenter";
const root = process.cwd();
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const nodeCommand = process.execPath;

async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
}

async function verifyCapacitorConfig() {
  const configPath = path.join(root, "capacitor.config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));

  if (config.appId !== EXPECTED_APP_ID) {
    throw new Error(
      `capacitor.config.json has appId \"${config.appId}\", but Google Play needs \"${EXPECTED_APP_ID}\".`,
    );
  }

  console.log(`[Android setup] Capacitor appId verified: ${config.appId}`);
}

async function ensureDependencies() {
  const cliPath = path.join(root, "node_modules", "@capacitor", "cli", "package.json");
  if (await exists(cliPath)) return;

  console.log("[Android setup] JavaScript dependencies are missing. Running npm install...");
  run(npmCommand, ["install"]);
}

async function createOrSyncAndroidProject() {
  const settingsGradle = path.join(root, "android", "settings.gradle");
  const settingsGradleKts = path.join(root, "android", "settings.gradle.kts");
  const androidExists = (await exists(settingsGradle)) || (await exists(settingsGradleKts));

  if (androidExists) {
    console.log("[Android setup] Existing Android project found. Syncing it...");
    run(npxCommand, ["cap", "sync", "android"]);
  } else {
    console.log("[Android setup] Android project is missing. Creating it now...");
    run(npxCommand, ["cap", "add", "android"]);
    run(npxCommand, ["cap", "sync", "android"]);
  }
}

async function applyProjectConfiguration() {
  run(nodeCommand, ["scripts/configure-android.mjs"]);
  run(nodeCommand, ["scripts/configure-phone-permissions.mjs"]);
}

async function verifyGeneratedPackageName() {
  const groovyPath = path.join(root, "android", "app", "build.gradle");
  const kotlinPath = path.join(root, "android", "app", "build.gradle.kts");
  const buildFilePath = (await exists(groovyPath)) ? groovyPath : kotlinPath;

  if (!(await exists(buildFilePath))) {
    throw new Error(
      "Android was generated, but android/app/build.gradle (or build.gradle.kts) is still missing.",
    );
  }

  const buildFile = await readFile(buildFilePath, "utf8");
  const escapedId = EXPECTED_APP_ID.replaceAll(".", "\\.");
  const applicationIdPattern = new RegExp(
    `applicationId\\s*(?:=\\s*)?[\"']${escapedId}[\"']`,
  );
  const namespacePattern = new RegExp(
    `namespace\\s*(?:=\\s*)?[\"']${escapedId}[\"']`,
  );

  if (!applicationIdPattern.test(buildFile)) {
    throw new Error(
      `${path.relative(root, buildFilePath)} does not contain applicationId \"${EXPECTED_APP_ID}\".`,
    );
  }

  if (!namespacePattern.test(buildFile)) {
    throw new Error(
      `${path.relative(root, buildFilePath)} does not contain namespace \"${EXPECTED_APP_ID}\".`,
    );
  }

  console.log(`[Android setup] Generated applicationId verified: ${EXPECTED_APP_ID}`);
  console.log(`[Android setup] Generated namespace verified: ${EXPECTED_APP_ID}`);
}

async function main() {
  try {
    await verifyCapacitorConfig();
    await ensureDependencies();
    await createOrSyncAndroidProject();
    await applyProjectConfiguration();
    await verifyGeneratedPackageName();

    console.log("\n[Android setup] Android project is ready.");
    console.log("[Android setup] Open this folder in Android Studio: android");
    console.log("[Android setup] Or run: npm run mobile:android:open");
  } catch (error) {
    console.error(`\n[Android setup] FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}

await main();
