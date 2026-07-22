import { access, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function exists(relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function replaceExact(relativePath, oldText, newText, expectedCount = 1) {
  const filePath = path.join(root, relativePath);
  const source = await readFile(filePath, "utf8");
  const count = source.split(oldText).length - 1;
  if (count !== expectedCount) {
    throw new Error(`${relativePath}: expected ${expectedCount} occurrence(s), found ${count}: ${oldText.slice(0, 100)}`);
  }
  await writeFile(filePath, source.replaceAll(oldText, newText), "utf8");
}

async function removePath(relativePath) {
  const filePath = path.join(root, relativePath);
  if (await exists(relativePath)) await rm(filePath, { recursive: true, force: true });
}

async function textFiles(directory) {
  const output = [];
  if (!(await exists(directory))) return output;
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await textFiles(relativePath));
    else if (/\.(?:js|mjs|cjs|ts|tsx|jsx|json|md|yml|yaml|html|css|java|swift|xml)$/i.test(entry.name)) output.push(relativePath);
  }
  return output;
}

await removePath("app/advertising");
await removePath("app/components/AdvertisingClients.js");

await replaceExact(
  "app/components/AppShell.js",
  'const DEFAULT_CLIENT_ID = "tabor-painting";\n',
  ""
);
await replaceExact(
  "app/components/AppShell.js",
  "  const selectedClientId = profile?.clientId || DEFAULT_CLIENT_ID;",
  '  const selectedClientId = profile?.clientId || "";'
);
await replaceExact(
  "app/components/AppShell.js",
  "        <NativeAppSetup />\n        {children}",
  "        {children}"
);
await replaceExact(
  "app/components/AppShell.js",
  '  const accountLabel = profile?.businessName || "Tabor Painting";',
  '  const accountLabel = profile?.businessName || "Your Business";'
);

await replaceExact(
  "app/components/HelpCenter.js",
  "export default function HelpCenter({ isAdmin = false }) {",
  "export default function HelpCenter() {"
);
await replaceExact(
  "app/components/HelpCenter.js",
  '  const positionClass = isAdmin ? "top-32 sm:top-24" : "top-20 sm:top-24";\n\n',
  ""
);
await replaceExact(
  "app/components/HelpCenter.js",
  '        <div className={`fixed right-3 ${positionClass} z-50 sm:right-5 md:right-8`}>',
  '        <div className="fixed right-3 top-20 z-50 sm:right-5 sm:top-24 md:right-8">'
);

await replaceExact(
  "app/components/ReviewClientsNative.js",
  'const ACCEPTED_COLLECTIONS = ["preClients", "clients", "postClients"];',
  'const ACCEPTED_COLLECTIONS = ["clients"];'
);
await replaceExact(
  "app/components/ClientStats.js",
  'const ACCEPTED_COLLECTIONS = ["preClients", "clients", "postClients"];',
  'const ACCEPTED_COLLECTIONS = ["clients"];'
);
await replaceExact(
  "app/api/intake/route.js",
  'const allowedSections = ["postClients", "clients", "preClients", "contactedMe"];',
  'const allowedSections = ["clients", "contactedMe"];'
);

await replaceExact(
  "app/api/receptionist/call-usage/route.js",
  '    if (action === "check") {\n      return Response.json({ ok: true, blocked: false });\n    }\n',
  ""
);

for (const relativePath of ["app/login/page.js", "app/forgot-password/page.js"]) {
  if (await exists(relativePath)) {
    const source = await readFile(path.join(root, relativePath), "utf8");
    await writeFile(path.join(root, relativePath), source.replaceAll("Tabor Painting", "Example Painting"), "utf8");
  }
}

const scanRoots = ["app", "scripts", "mobile-shell", ".github/workflows"];
const forbidden = [
  "preClients",
  "postClients",
  "/pre-clients",
  "/post-clients",
  "AdvertisingClients",
  "tabor-painting",
  "Tabor Painting",
];
const leftovers = [];
for (const directory of scanRoots) {
  for (const relativePath of await textFiles(directory)) {
    if (["scripts/remove-obsolete-code.mjs", ".github/workflows/remove-obsolete-code.yml"].includes(relativePath)) continue;
    const source = await readFile(path.join(root, relativePath), "utf8");
    for (const needle of forbidden) {
      if (source.includes(needle)) leftovers.push(`${relativePath}: ${needle}`);
    }
  }
}

if (leftovers.length) {
  throw new Error(`Obsolete references remain:\n${leftovers.join("\n")}`);
}

await removePath("scripts/remove-obsolete-code.mjs");
await removePath(".github/workflows/remove-obsolete-code.yml");

console.log("Obsolete and disconnected code removed successfully.");
