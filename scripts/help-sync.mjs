#!/usr/bin/env node
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Vendors the BDOBB-V2 Help guide into src/help/guide/.
 *
 *   pnpm help:sync                      copy the snapshot for this app's major.minor
 *   BDOBB_HELP_DIR=/path pnpm help:sync  from a checkout somewhere else
 *
 * The guide lives in its own repository (artcashin/bdobb-v2-help), one
 * self-contained folder per app release line -- `v12.1/`, `v13.0/` -- and the
 * app's Help dialog shows it beside the in-repo reference manual. The copy is
 * committed, so a build needs no network and `pnpm test:run` stays offline; run
 * this again whenever the guide changes, then commit the diff.
 *
 * Pages are copied VERBATIM and flattened to one directory (slugs are unique
 * within a snapshot; the section each page belongs to is read from home.md's
 * index at load time, see src/help/guide.ts). Everything the dialog needs
 * rewritten -- frontmatter, wikilinks, image paths -- is rewritten at load
 * time too, so the vendored file and the vault file diff clean.
 *
 * Screenshots: the guide's attachments are the reference manual's own shots,
 * which already exist here in both themes under src/help/shots/. Only an
 * attachment with no such shot is copied, into guide/attachments/, where
 * shots.ts falls back to it.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = process.env.BDOBB_HELP_DIR ?? join(homedir(), "Tolaria", "BDOBB-V2 Help");
const OUT = join(ROOT, "src", "help", "guide");
const SHOTS = join(ROOT, "src", "help", "shots");

const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const [major, minor] = version.split(".");
const folder = `v${major}.${minor}`;
const from = join(SRC, folder);

if (!existsSync(from)) {
  console.error(`help-sync: no ${folder}/ in ${SRC} -- cut that snapshot in the help repo first, or point BDOBB_HELP_DIR elsewhere.`);
  process.exit(1);
}

/** Every .md under `dir`, recursively, skipping attachments and dotfiles. */
function pages(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((rel) => extname(rel) === ".md")
    .filter((rel) => !rel.split(sep).some((seg) => seg === "attachments" || seg.startsWith(".")))
    .sort()
    .map((rel) => join(dir, rel));
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const seen = new Map();
for (const file of pages(from)) {
  const name = basename(file);
  if (seen.has(name)) {
    console.error(`help-sync: slug collision: ${name} is both ${seen.get(name)} and ${file}`);
    process.exit(1);
  }
  seen.set(name, file);
  copyFileSync(file, join(OUT, name));
}

let copiedAttachments = 0;
const attachments = join(from, "attachments");
if (existsSync(attachments)) {
  for (const entry of readdirSync(attachments)) {
    if (extname(entry) !== ".png") continue;
    const slug = entry.slice(0, -".png".length);
    if (existsSync(join(SHOTS, `${slug}-light.png`))) continue;
    mkdirSync(join(OUT, "attachments"), { recursive: true });
    copyFileSync(join(attachments, entry), join(OUT, "attachments", entry));
    copiedAttachments++;
  }
}

let sha = "unknown";
try {
  sha = execFileSync("git", ["-C", SRC, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  // Not a git checkout, or git missing: the version line still names the folder.
}
writeFileSync(join(OUT, "VERSION"), `${folder} ${sha}\n`);

console.log(`help-sync: ${seen.size} pages from ${from} (${sha}); ${copiedAttachments} attachment(s) without a themed shot copied.`);
