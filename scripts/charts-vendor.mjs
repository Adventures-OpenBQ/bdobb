#!/usr/bin/env node
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * pnpm charts:vendor: copies the Art's Charts client package and its Rita skill from
 * an arts-charts-openbq commit or tag into vendor/arts-charts/ (spec B1), and writes
 * vendor/arts-charts.lock.json {tag, commit, sha256}. Read-only on the source checkout:
 * every byte comes from `git show <commit>:<path>`, never from its working tree.
 *
 *   ARTS_CHARTS_DIR=<checkout> pnpm charts:vendor <tag | 40-hex commit>
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL = "skills/arts-charts/SKILL.md";
const ROOT_FILES = new Set(["package.json", "LICENSE", "ARTS_CHARTS_TERMS.md", "THIRD_PARTY_NOTICES.md"]);

/** What ships: the package's `files` (src without tests) plus the skill. Sorted. */
export function selectFiles(paths) {
  return paths.filter((p) => {
    if (p === SKILL) return true;
    if (!p.startsWith("client/")) return false;
    const rel = p.slice("client/".length);
    if (ROOT_FILES.has(rel)) return true;
    return rel.startsWith("src/") && !rel.startsWith("src/test/") && !/\.test\.tsx?$/.test(rel);
  }).sort();
}

/** sha256 over "path\0sha256(bytes)\n" lines, paths sorted: independent of listing order. */
export function treeHash(root, files) {
  const lines = [...files].sort().map((f) => `${f}\0${createHash("sha256").update(readFileSync(join(root, f))).digest("hex")}\n`);
  return createHash("sha256").update(lines.join("")).digest("hex");
}

/** Where a source path lands under vendor/arts-charts/: client/x → x, the skill keeps its path. */
const target = (p) => (p === SKILL ? p : p.slice("client/".length));

function main() {
  const [ref] = process.argv.slice(2);
  const dir = process.env.ARTS_CHARTS_DIR;
  if (!dir || !ref) throw new Error("Use ARTS_CHARTS_DIR=<checkout> pnpm charts:vendor <tag | 40-hex commit>");
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "buffer", maxBuffer: 1 << 28 });
  const commit = git("rev-parse", `${ref}^{commit}`).toString().trim();
  const tag = /^v\d+\.\d+\.\d+$/.test(ref) ? ref : null;
  const listed = git("ls-tree", "-r", "--name-only", commit).toString().split("\n").filter(Boolean);
  const files = selectFiles(listed);
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const out = join(repo, "vendor/arts-charts");
  rmSync(out, { recursive: true, force: true });
  for (const p of files) {
    const dest = join(out, target(p));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, git("show", `${commit}:${p}`));
  }
  const shipped = files.map(target).sort();
  writeFileSync(join(out, ".files.json"), JSON.stringify(shipped, null, 2) + "\n");
  const sha256 = treeHash(out, shipped);
  writeFileSync(join(repo, "vendor/arts-charts.lock.json"), JSON.stringify({ tag, commit, sha256 }, null, 2) + "\n");
  console.log(`vendored arts-charts ${tag ?? commit} (${shipped.length} files) sha256:${sha256}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
