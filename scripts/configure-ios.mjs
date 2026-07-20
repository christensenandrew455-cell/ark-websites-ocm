import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const plistPath = path.join(projectRoot, "ios", "App", "App", "Info.plist");
const appDelegatePath = path.join(projectRoot, "ios", "App", "App", "AppDelegate.swift");

function requireFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required iOS file was not generated: ${path.relative(projectRoot, filePath)}`);
  }
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function addPlistString(plist, key, value) {
  if (plist.includes(`<key>${key}</key>`)) return plist;
  const addition = `\n\t<key>${key}</key>\n\t<string>${escapeXml(value)}</string>`;
  const closing = "\n</dict>\n</plist>";
  if (!plist.includes(closing)) throw new Error("Info.plist has an unexpected format.");
  return plist.replace(closing, `${addition}${closing}`);
}

requireFile(plistPath);
requireFile(appDelegatePath);

let plist = fs.readFileSync(plistPath, "utf8");
plist = addPlistString(
  plist,
  "NSContactsUsageDescription",
  "ARK Client Center uses contacts only when you choose to add or match a customer contact.",
);
plist = addPlistString(
  plist,
  "NSCalendarsUsageDescription",
  "ARK Client Center uses your calendar to manage customer appointments you choose to add.",
);
plist = addPlistString(
  plist,
  "NSCalendarsWriteOnlyAccessUsageDescription",
  "ARK Client Center can add customer appointments to your calendar when you choose.",
);
plist = addPlistString(
  plist,
  "NSCalendarsFullAccessUsageDescription",
  "ARK Client Center can read and manage customer appointments in your calendar when you choose.",
);
fs.writeFileSync(plistPath, plist);

let appDelegate = fs.readFileSync(appDelegatePath, "utf8");
if (!appDelegate.includes("capacitorDidRegisterForRemoteNotifications")) {
  const closingBrace = appDelegate.lastIndexOf("\n}");
  if (closingBrace === -1) throw new Error("AppDelegate.swift has an unexpected format.");

  const pushCallbacks = `

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
`;

  appDelegate = `${appDelegate.slice(0, closingBrace)}${pushCallbacks}${appDelegate.slice(closingBrace)}`;
  fs.writeFileSync(appDelegatePath, appDelegate);
}

const plistCheck = spawnSync("/usr/bin/plutil", ["-lint", plistPath], { encoding: "utf8" });
if (plistCheck.status !== 0) {
  throw new Error(plistCheck.stderr || plistCheck.stdout || "Info.plist validation failed.");
}

console.log("Configured iOS contacts, calendar, and push-notification support.");
