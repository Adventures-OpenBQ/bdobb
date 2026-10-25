// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// Generates src-tauri/capabilities/share-folders.json from VITE_SHARE_FOLDERS
// (env, else .env.local) so "file" share targets may write under those
// folders. The output is gitignored: it names paths on this machine.
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OUT = new URL("../src-tauri/capabilities/share-folders.json", import.meta.url);
const ENV_LOCAL = new URL("../.env.local", import.meta.url);

function fromEnvLocal() {
  if (!existsSync(ENV_LOCAL)) return "";
  const m = readFileSync(ENV_LOCAL, "utf8").match(/^\s*VITE_SHARE_FOLDERS\s*=\s*(.*?)\s*$/m);
  return m ? m[1].replace(/^["']|["']$/g, "") : "";
}

/** Splits the raw setting into fs scope entries; non-absolute entries are skipped. */
export function scopeFor(raw) {
  const scope = [];
  const skipped = [];
  for (const entry of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!isAbsolute(entry)) {
      skipped.push(entry);
      continue;
    }
    const path = entry.replace(/\/+$/, "");
    scope.push({ path }, { path: `${path}/**` });
  }
  return { scope, skipped };
}

export function capabilityFor(scope) {
  return {
    $schema: "../gen/schemas/desktop-schema.json",
    identifier: "share-folders",
    description: "Write exported chats under the folders named by VITE_SHARE_FOLDERS",
    windows: ["main"],
    permissions: ["fs:allow-mkdir", "fs:allow-write-text-file", { identifier: "fs:scope", allow: scope }],
  };
}

function main() {
  const raw = process.env.VITE_SHARE_FOLDERS ?? fromEnvLocal();
  const { scope, skipped } = scopeFor(raw);
  for (const s of skipped) console.warn(`generate-capabilities: skipping non-absolute share folder "${s}"`);
  if (scope.length === 0) {
    rmSync(OUT, { force: true });
    return;
  }
  writeFileSync(OUT, `${JSON.stringify(capabilityFor(scope), null, 2)}\n`);
}

// realpathSync, not the path as typed: `import.meta.url` is already
// symlink-resolved, so comparing it against an unresolved argv[1] silently
// decides "not the entry point" and `pnpm capabilities` becomes a no-op that
// still exits 0. Any symlinked ancestor does it -- on macOS /tmp and /var are
// themselves symlinks into /private (review S-nat-6).
const entry = process.argv[1] ? pathToFileURL(realpathSync(resolve(process.argv[1]))).href : "";
if (import.meta.url === entry) main();
