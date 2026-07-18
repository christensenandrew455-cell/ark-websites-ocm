import { readFile, writeFile } from "node:fs/promises";

const path = "app/components/ReviewClientsNative.js";
const original = await readFile(path, "utf8");
const before = '    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;';
const after = `    if (!window.confirm(\`Delete \${label}? This permanently removes the client record and cannot be undone.\`)) return;\n    if (!window.confirm(\`Final warning: permanently delete \${label}?\`)) return;`;

if (!original.includes(before)) {
  throw new Error("The expected client delete confirmation was not found.");
}

await writeFile(path, original.replace(before, after), "utf8");
console.log("Added a second permanent-delete confirmation.");
