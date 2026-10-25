// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { shippedCrates } from "./cargo-closure.mjs";

// Native binaries ship a different normal-dependency closure from the desktop app.
// Generate their full license texts from the exact Cargo.lock-resolved sources.
const output = resolve(process.argv[2] ?? "/runtime/licenses/rust");
const target = process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : process.arch === "x64" ? "x86_64-unknown-linux-gnu" : null;
if (!target) throw new Error("Unsupported native runtime architecture");
const packages = new Map();
for (const manifest of ["crates/table-service/Cargo.toml", "crates/pivot-native-worker/Cargo.toml"]) {
  for (const pkg of shippedCrates(manifest, ["--filter-platform", target])) packages.set(`${pkg.name}-${pkg.version}`, pkg);
}
mkdirSync(output, { recursive: true });
const index = [];
for (const [name, pkg] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const directory = dirname(pkg.manifest_path);
  const files = new Set(readdirSync(directory).filter(file => /^(?:licen[cs]e|copying|notice|copyright)(?:[._-]|$)/i.test(file)));
  if (pkg.license_file) files.add(pkg.license_file);
  if (!files.size) throw new Error(`No license text found for ${name}`);
  const texts = [...files].sort().map(file => `## ${file}\n\n${readFileSync(join(directory, file), "utf8")}`).join("\n\n");
  writeFileSync(join(output, `${name}.txt`), `${name}\n${pkg.license ?? "See license text"}\n${pkg.repository ?? ""}\n\n${texts}\n`);
  index.push({ name: pkg.name, version: pkg.version, license: pkg.license, file: `${name}.txt` });
}
writeFileSync(join(output, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`Preserved full license texts for ${index.length} native runtime dependencies.`);
