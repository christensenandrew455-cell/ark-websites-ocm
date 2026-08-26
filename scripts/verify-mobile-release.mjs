import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const expectedAndroidAppId = "com.arkwebsites.app";
const expectedIosBundleId = "com.arkwebsites.clientcenter";
const expectedAppName = "ARK Client Center";
const expectedUrl = "https://www.arkclientcenter.com";
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const checks = [];

function fail(message) {
  throw new Error(`[Mobile release verification] ${message}`);
}

function check(condition, message) {
  if (!condition) fail(message);
  checks.push(message);
}

function file(relativePath) {
  return path.join(root, relativePath);
}

function read(relativePath) {
  return fs.readFileSync(file(relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function pngMetadata(relativePath) {
  const data = fs.readFileSync(file(relativePath));
  check(data.length >= 26, `${relativePath} is a complete PNG file`);
  check(data.subarray(0, 8).equals(pngSignature), `${relativePath} has a valid PNG signature`);
  check(data.toString("ascii", 12, 16) === "IHDR", `${relativePath} starts with a PNG IHDR chunk`);
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    bitDepth: data[24],
    colorType: data[25],
  };
}

function plistArrayValues(plist, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = plist.match(new RegExp(`<key>${escapedKey}<\\/key>\\s*<array>([\\s\\S]*?)<\\/array>`));
  if (!match) return [];
  return [...match[1].matchAll(/<string>([^<]+)<\/string>/g)].map((entry) => entry[1]);
}

function verifyCapacitorConfig(config, label, expectedAppId, { requireBuildOptions = false } = {}) {
  check(config.appId === expectedAppId, `${label} uses bundle/package ID ${expectedAppId}`);
  check(config.appName === expectedAppName, `${label} uses the ARK Client Center app name`);
  check(config.webDir === "mobile-shell", `${label} includes the offline mobile shell`);
  check(config.server?.url === expectedUrl, `${label} loads exactly ${expectedUrl}`);
  check(config.server?.androidScheme === "https", `${label} uses HTTPS on Android`);
  check(config.server?.iosScheme === "https", `${label} uses HTTPS on iOS`);
  check(config.server?.cleartext === false, `${label} blocks cleartext network traffic`);
  check(config.server?.errorPath === "offline.html", `${label} includes the offline error page`);
  check(config.loggingBehavior === "none", `${label} disables Capacitor logging in release builds`);
  check(config.android?.loggingBehavior === "none", `${label} disables Android release logging`);
  check(config.android?.webContentsDebuggingEnabled === false, `${label} disables Android WebView debugging`);
  if (requireBuildOptions) {
    check(config.android?.buildOptions?.releaseType === "AAB", `${label} defaults Android releases to an App Bundle`);
  }
  check(config.ios?.loggingBehavior === "none", `${label} disables iOS release logging`);
  check(config.ios?.webContentsDebuggingEnabled === false, `${label} disables iOS WebView debugging`);
}

const rootConfig = readJson("capacitor.config.json");
verifyCapacitorConfig(rootConfig, "capacitor.config.json", expectedAndroidAppId, { requireBuildOptions: true });

if (fs.existsSync(file("ios/App/App/capacitor.config.json"))) {
  const iosConfig = readJson("ios/App/App/capacitor.config.json");
  verifyCapacitorConfig(iosConfig, "the generated iOS configuration", expectedIosBundleId);

  const project = read("ios/App/App.xcodeproj/project.pbxproj");
  check(
    project.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${expectedIosBundleId};`),
    "the Xcode project uses the correct bundle ID",
  );
  check(project.includes("IPHONEOS_DEPLOYMENT_TARGET = 15.0;"), "the Xcode project targets iOS 15 or newer");
  check(project.includes("com.apple.InAppPurchase = { enabled = 1; };"), "the Xcode project enables in-app purchases");
  check(/CURRENT_PROJECT_VERSION = \d+;/.test(project), "the Xcode project has a numeric build number");
  check(/MARKETING_VERSION = \d+(?:\.\d+){1,2};/.test(project), "the Xcode project has a valid release version");

  const plist = read("ios/App/App/Info.plist");
  const iphoneOrientations = plistArrayValues(plist, "UISupportedInterfaceOrientations");
  const ipadOrientations = plistArrayValues(plist, "UISupportedInterfaceOrientations~ipad");
  check(iphoneOrientations.length === 1 && iphoneOrientations[0] === "UIInterfaceOrientationPortrait", "the iPhone app is locked to portrait");
  for (const orientation of [
    "UIInterfaceOrientationPortrait",
    "UIInterfaceOrientationPortraitUpsideDown",
    "UIInterfaceOrientationLandscapeLeft",
    "UIInterfaceOrientationLandscapeRight",
  ]) {
    check(ipadOrientations.includes(orientation), `the iPad app supports ${orientation}`);
  }
  check(plist.includes(`<string>${expectedIosBundleId}</string>`), "the iOS URL type uses the iOS bundle ID");
  check(plist.includes("<string>arkclientcenter</string>"), "the iOS signup return URL scheme is registered");

  check(iosConfig.packageClassList?.includes("AppleIAPPlugin"), "the generated iOS configuration registers the Apple purchase bridge");
  const appleIapPlugin = read("ios/App/CapApp-SPM/Sources/AppleIAPPlugin/AppleIAPPlugin.swift");
  check(appleIapPlugin.includes("import StoreKit"), "the iOS purchase bridge uses StoreKit");
  check(appleIapPlugin.includes("product.purchase(options: [.appAccountToken(accountToken)])"), "Apple purchases are tied to the signed-in ARK account");
  check(appleIapPlugin.includes("result.jwsRepresentation"), "Apple transactions are sent to the server as signed JWS data");
  const swiftPackage = read("ios/App/CapApp-SPM/Package.swift");
  check(swiftPackage.includes('name: "AppleIAPPlugin"'), "the self-contained Swift package includes the Apple purchase bridge");

  const iosIcon = pngMetadata("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png");
  check(iosIcon.width === 1024 && iosIcon.height === 1024, "the App Store icon is exactly 1024 by 1024 pixels");
  check(iosIcon.bitDepth === 8 && iosIcon.colorType === 2, "the App Store icon is an alpha-free 8-bit RGB PNG");
}

if (fs.existsSync(file("android/app/build.gradle"))) {
  const androidConfig = readJson("android/app/src/main/assets/capacitor.config.json");
  verifyCapacitorConfig(androidConfig, "the generated Android configuration", expectedAndroidAppId);

  const build = read("android/app/build.gradle");
  check(build.includes(`namespace = "${expectedAndroidAppId}"`), "the Android namespace is correct");
  check(build.includes(`applicationId "${expectedAndroidAppId}"`), "the Android application ID is correct");
  check(/versionCode\s+[1-9]\d*/.test(build), "the Android app has a positive version code");
  check(/versionName\s+"\d+(?:\.\d+){1,2}"/.test(build), "the Android app has a valid release version");

  const variables = read("android/variables.gradle");
  check(variables.includes("compileSdkVersion = 36"), "Android compiles against API level 36");
  check(variables.includes("targetSdkVersion = 36"), "Android targets API level 36 for Google Play");

  const manifest = read("android/app/src/main/AndroidManifest.xml");
  check(manifest.includes('android:scheme="arkclientcenter"'), "the Android signup return URL scheme is registered");
  check(manifest.includes("android.permission.INTERNET"), "the Android app can reach the secure production site");
  check(manifest.includes("android.permission.POST_NOTIFICATIONS"), "the Android notification permission is declared");
  check(manifest.includes('android:usesCleartextTraffic="false"'), "the Android manifest blocks cleartext traffic on every supported OS version");
  check(manifest.includes('android:allowBackup="false"'), "the Android manifest disables backups of customer app data");

  const densitySizes = new Map([
    ["mipmap-mdpi", 48],
    ["mipmap-hdpi", 72],
    ["mipmap-xhdpi", 96],
    ["mipmap-xxhdpi", 144],
    ["mipmap-xxxhdpi", 192],
  ]);
  for (const [directory, expectedSize] of densitySizes) {
    const icon = pngMetadata(`android/app/src/main/res/${directory}/ic_launcher.png`);
    check(icon.width === expectedSize && icon.height === expectedSize, `${directory} has the correct launcher icon size`);
    check(icon.colorType === 2, `${directory} contains the generated ARK launcher artwork`);
  }
}

console.log(`[Mobile release verification] Passed ${checks.length} checks.`);
console.log(`[Mobile release verification] Production URL: ${expectedUrl}`);
console.log(`[Mobile release verification] Android App ID: ${expectedAndroidAppId}`);
console.log(`[Mobile release verification] iOS Bundle ID: ${expectedIosBundleId}`);
