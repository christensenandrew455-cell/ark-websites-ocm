import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function configureAndroid() {
  const manifestPath = path.join(root, "android", "app", "src", "main", "AndroidManifest.xml");
  if (!fs.existsSync(manifestPath)) return false;

  let manifest = fs.readFileSync(manifestPath, "utf8");
  const activityPattern = /<activity\b(?=[^>]*android:name=["']\.MainActivity["'])[^>]*>/;
  const activity = manifest.match(activityPattern)?.[0];
  if (!activity) throw new Error("AndroidManifest.xml does not contain .MainActivity.");

  const nextActivity = /android:screenOrientation=/.test(activity)
    ? activity.replace(/android:screenOrientation=["'][^"']+["']/, 'android:screenOrientation="portrait"')
    : activity.replace(/>$/, ' android:screenOrientation="portrait">');

  if (activity !== nextActivity) {
    manifest = manifest.replace(activityPattern, nextActivity);
    fs.writeFileSync(manifestPath, manifest, "utf8");
  }
  console.log("[Orientation] Android locked to portrait.");
  return true;
}

function plistArray(key, values) {
  return `\n\t<key>${key}</key>\n\t<array>\n${values.map((value) => `\t\t<string>${value}</string>`).join("\n")}\n\t</array>`;
}

function setPlistArray(plist, key, values) {
  const block = plistArray(key, values);
  const pattern = new RegExp(`\\n?\\s*<key>${key}<\\/key>\\s*<array>[\\s\\S]*?<\\/array>`);
  if (pattern.test(plist)) return plist.replace(pattern, block);
  const closing = "\n</dict>\n</plist>";
  if (!plist.includes(closing)) throw new Error("Info.plist has an unexpected format.");
  return plist.replace(closing, `${block}${closing}`);
}

function configureIos() {
  const plistPath = path.join(root, "ios", "App", "App", "Info.plist");
  if (!fs.existsSync(plistPath)) return false;

  let plist = fs.readFileSync(plistPath, "utf8");
  const portraitOnly = ["UIInterfaceOrientationPortrait"];
  plist = setPlistArray(plist, "UISupportedInterfaceOrientations", portraitOnly);
  plist = setPlistArray(plist, "UISupportedInterfaceOrientations~ipad", portraitOnly);
  fs.writeFileSync(plistPath, plist, "utf8");
  console.log("[Orientation] iOS locked to portrait.");
  return true;
}

const configured = [configureAndroid(), configureIos()].some(Boolean);
if (!configured) console.log("[Orientation] No generated native project was found yet.");
