#!/usr/bin/env node
// Writes the licenses of every library shipped with Sourcebook (production dependencies of all packages, direct
// and indirect) into one text file: name, version, license, homepage and the license text found in the package.
//
//   node scripts/third-party-licenses.mjs [output]     (default: packages/client/dist/THIRD_PARTY_LICENSES.txt)
//
// Run by `pnpm build`, so the file is served with the web client and included in the Docker image.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, process.argv[2] ?? "packages/client/dist/THIRD_PARTY_LICENSES.txt");

const json = execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const byLicense = JSON.parse(json);

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;
const texts = (dir) => {
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort();
  } catch {
    return [];
  }
  return files.map((f) => readFileSync(join(dir, f), "utf8").trim());
};

const packages = Object.values(byLicense)
  .flat()
  .flatMap((p) => p.versions.map((version, i) => ({ ...p, version, path: p.paths?.[i] })))
  .filter((p) => !p.name.startsWith("@sourcebook/"))
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true }));

const rule = "-".repeat(78);
const parts = [
  "Sourcebook — third-party software",
  "",
  "Sourcebook is distributed under the MIT License (see LICENSE). It includes the following libraries, each under",
  "its own license. Libraries offered under a choice of licenses (e.g. \"MIT OR GPL-3.0-or-later\") are used under",
  "the permissive option. elkjs (Eclipse Public License 2.0) is included unmodified; its source code is available at",
  "https://github.com/kieler/elkjs.",
  "",
  `${packages.length} packages.`,
];
for (const p of packages) {
  parts.push("", rule, `${p.name} ${p.version}`, `License: ${p.license}`);
  if (p.homepage) parts.push(`Homepage: ${p.homepage}`);
  if (p.author) parts.push(`Author: ${p.author}`);
  const found = p.path ? texts(p.path) : [];
  parts.push("", ...(found.length ? found.flatMap((t) => [t, ""]) : [`(No license file in the package; license: ${p.license}.)`, ""]));
}
writeFileSync(out, parts.join("\n").trimEnd() + "\n");
console.log(`Wrote ${packages.length} third-party licenses to ${out}`);
