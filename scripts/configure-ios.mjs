import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const iosRoot = path.join(projectRoot, "ios", "App");
const appRoot = path.join(iosRoot, "App");
const iosBundleId = "com.arkwebsites.app";
const capacitorConfigPath = path.join(appRoot, "capacitor.config.json");
const xcodeProjectPath = path.join(iosRoot, "App.xcodeproj", "project.pbxproj");
const plistPath = path.join(appRoot, "Info.plist");
const appDelegatePath = path.join(appRoot, "AppDelegate.swift");
const swiftPackageRoot = path.join(iosRoot, "CapApp-SPM");
const swiftSourcesRoot = path.join(swiftPackageRoot, "Sources");

function requireFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required iOS file was not generated: ${path.relative(projectRoot, filePath)}`);
  }
}

function requireDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    throw new Error(`Required iOS plugin source was not installed: ${path.relative(projectRoot, directoryPath)}`);
  }
}

function copyDirectory(source, destination) {
  requireDirectory(source);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
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

function addPlistUrlScheme(plist, scheme) {
  if (plist.includes(`<string>${scheme}</string>`)) {
    const urlNamePattern = /(<key>CFBundleURLName<\/key>\s*<string>)[^<]*(<\/string>)/;
    if (!urlNamePattern.test(plist)) throw new Error("Info.plist URL type has an unexpected format.");
    return plist.replace(urlNamePattern, (_, prefix, suffix) => `${prefix}${escapeXml(iosBundleId)}${suffix}`);
  }
  const addition = `
	<key>CFBundleURLTypes</key>
	<array>
		<dict>
			<key>CFBundleURLName</key>
			<string>${escapeXml(iosBundleId)}</string>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>${escapeXml(scheme)}</string>
			</array>
		</dict>
	</array>`;
  const closing = "\n</dict>\n</plist>";
  if (!plist.includes(closing)) throw new Error("Info.plist has an unexpected format.");
  return plist.replace(closing, `${addition}${closing}`);
}

function configureBundleIdentifier() {
  requireFile(capacitorConfigPath);
  const capacitorConfig = JSON.parse(fs.readFileSync(capacitorConfigPath, "utf8"));
  capacitorConfig.appId = iosBundleId;
  capacitorConfig.packageClassList = [...new Set([...(capacitorConfig.packageClassList || []), "AppleIAPPlugin"])];
  fs.writeFileSync(capacitorConfigPath, `${JSON.stringify(capacitorConfig, null, "\t")}\n`);

  requireFile(xcodeProjectPath);
  let xcodeProject = fs.readFileSync(xcodeProjectPath, "utf8");
  const bundleIdentifierPattern = /PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g;
  if (!bundleIdentifierPattern.test(xcodeProject)) {
    throw new Error("The Xcode project does not contain a product bundle identifier.");
  }
  xcodeProject = xcodeProject.replace(
    bundleIdentifierPattern,
    `PRODUCT_BUNDLE_IDENTIFIER = ${iosBundleId};`,
  );
  if (!xcodeProject.includes("com.apple.InAppPurchase")) {
    const capabilityAnchor = "\t\t\t\t\t\tProvisioningStyle = Automatic;";
    if (!xcodeProject.includes(capabilityAnchor)) throw new Error("The Xcode project target attributes have an unexpected format.");
    xcodeProject = xcodeProject.replace(capabilityAnchor, `${capabilityAnchor}\n\t\t\t\t\t\tSystemCapabilities = {\n\t\t\t\t\t\t\tcom.apple.InAppPurchase = { enabled = 1; };\n\t\t\t\t\t\t};`);
  }
  fs.writeFileSync(xcodeProjectPath, xcodeProject);
}

function vendorNativePluginSources() {
  const pluginSources = [
    {
      source: path.join(projectRoot, "node_modules", "@capacitor", "app", "ios", "Sources", "AppPlugin"),
      destination: path.join(swiftSourcesRoot, "AppPlugin"),
    },
    {
      source: path.join(projectRoot, "node_modules", "@capacitor", "push-notifications", "ios", "Sources", "PushNotificationsPlugin"),
      destination: path.join(swiftSourcesRoot, "PushNotificationsPlugin"),
    },
    {
      source: path.join(projectRoot, "node_modules", "@capacitor-community", "contacts", "ios", "Sources", "ContactsPlugin"),
      destination: path.join(swiftSourcesRoot, "ContactsPlugin"),
    },
    {
      source: path.join(projectRoot, "node_modules", "@ebarooni", "capacitor-calendar", "ios", "Plugin"),
      destination: path.join(swiftSourcesRoot, "CapacitorCalendarPlugin"),
    },
    {
      source: path.join(projectRoot, "native-plugins", "ios", "AppleIAPPlugin"),
      destination: path.join(swiftSourcesRoot, "AppleIAPPlugin"),
    },
  ];

  fs.rmSync(swiftSourcesRoot, { recursive: true, force: true });
  fs.mkdirSync(swiftSourcesRoot, { recursive: true });
  for (const plugin of pluginSources) copyDirectory(plugin.source, plugin.destination);

  const wrapperSource = path.join(swiftSourcesRoot, "CapAppSPM", "CapAppSPM.swift");
  fs.mkdirSync(path.dirname(wrapperSource), { recursive: true });
  fs.writeFileSync(wrapperSource, "// Native Capacitor plugins are linked through this self-contained Swift package.\n");

  const packageManifest = `// swift-tools-version: 5.9
import PackageDescription

// This file is generated by scripts/configure-ios.mjs.
// Native plugin source is checked into the repository so Xcode can build a fresh clone
// without requiring Node, npm, or a node_modules directory on the Mac.
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "CapApp-SPM", targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.4.2")
    ],
    targets: [
        .target(
            name: "AppPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm")
            ],
            path: "Sources/AppPlugin"
        ),
        .target(
            name: "PushNotificationsPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "Sources/PushNotificationsPlugin"
        ),
        .target(
            name: "ContactsPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "Sources/ContactsPlugin"
        ),
        .target(
            name: "CapacitorCalendarPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "Sources/CapacitorCalendarPlugin"
        ),
        .target(
            name: "AppleIAPPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm")
            ],
            path: "Sources/AppleIAPPlugin"
        ),
        .target(
            name: "CapApp-SPM",
            dependencies: [
                "AppPlugin",
                "PushNotificationsPlugin",
                "ContactsPlugin",
                "CapacitorCalendarPlugin",
                "AppleIAPPlugin"
            ],
            path: "Sources/CapAppSPM"
        )
    ]
)
`;

  fs.writeFileSync(path.join(swiftPackageRoot, "Package.swift"), packageManifest);
}

requireFile(plistPath);
requireFile(appDelegatePath);
configureBundleIdentifier();

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
plist = addPlistUrlScheme(plist, "arkclientcenter");
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

vendorNativePluginSources();

if (fs.existsSync("/usr/bin/plutil")) {
  const plistCheck = spawnSync("/usr/bin/plutil", ["-lint", plistPath], { encoding: "utf8" });
  if (plistCheck.status !== 0) throw new Error(plistCheck.stderr || plistCheck.stdout || "Info.plist validation failed.");
}

console.log(
  `Configured the self-contained iOS project as ${iosBundleId} with contacts, calendar, push notifications, and StoreKit purchases.`,
);
