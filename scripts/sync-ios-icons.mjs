// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// No Xcode dependency, including on Windows desktop builds. Only artwork is
// copied; generated signing/project state remains private and untouched.
import { existsSync, readFileSync, copyFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

export function syncIosIcons(root = ROOT) {
  const apple = join(root, "src-tauri/gen/apple");
  if (!existsSync(apple)) return false; // Desktop-only checkout.
  const source = join(root, "src-tauri/icons/apple/AppIcon.appiconset");
  const target = join(apple, "Assets.xcassets/AppIcon.appiconset");
  if (!existsSync(target)) {
    throw new Error("Apple icon catalog is missing; run 'pnpm ios:init' to regenerate the Xcode project.");
  }
  const catalog = JSON.parse(readFileSync(join(source, "Contents.json"), "utf8"));
  if (!Array.isArray(catalog.images) || catalog.images.length === 0) {
    throw new Error("Committed Apple icon catalog has no images.");
  }
  const filenames = [...new Set(catalog.images.map(image => image.filename))];
  // Validate all references before any copy. Filenames cannot escape the
  // catalog even if a future edit accidentally introduces a relative path.
  for (const filename of filenames) {
    if (typeof filename !== "string" || !/^AppIcon-[0-9]+\.png$/.test(filename) ||
        !existsSync(join(source, filename))) {
      throw new Error(`Invalid or missing Apple icon: ${filename}`);
    }
  }
  for (const filename of filenames) copyFileSync(join(source, filename), join(target, filename));
  // Old Tauri filenames may remain unreferenced. Do not delete developer files.
  copyFileSync(join(source, "Contents.json"), join(target, "Contents.json"));
  return true;
}

// realpathSync, not resolve: `import.meta.url` is already symlink-resolved, so
// comparing it against an unresolved argv[1] silently decides "not the entry
// point" and the sync becomes a no-op that still exits 0. Any symlinked
// ancestor does it -- on macOS /tmp and /var are themselves symlinks into
// /private, which is how the icon test caught it.
const entry = process.argv[1] ? pathToFileURL(realpathSync(resolve(process.argv[1]))).href : "";
if (import.meta.url === entry) {
  try {
    syncIosIcons();
  } catch (error) {
    console.error(`Icon sync (${ROOT}): ${error.message}`);
    process.exitCode = 1;
  }
}
