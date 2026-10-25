// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { readFile, writeFile, mkdir, rename, rm, mkdtemp } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
export async function vendorCalendarContract(source, target) {
  source = resolve(source);
  target = resolve(target);
  const manifestBytes = await readFile(join(source, "manifest.json"));
  const m = JSON.parse(manifestBytes);
  if (m.artifactVersion !== 1 || m.contractVersion !== 1 || !Array.isArray(m.files) || m.files.length > 200)
    throw Error("Invalid calendar artifact");
  const files = new Map();
  let size = 0;
  for (const f of m.files) {
    if (
      typeof f.path !== "string" ||
      !/^[-A-Za-z0-9_./]+$/.test(f.path) ||
      f.path.split("/").some((x) => x === ".." || x === "") ||
      f.path.startsWith("/") ||
      files.has(f.path) ||
      f.path === "manifest.json"
    )
      throw Error("Invalid artifact path");
    if (!Number.isSafeInteger(f.bytes) || f.bytes < 0 || (size += f.bytes) > 16 * 1024 * 1024)
      throw Error("Artifact resource limit");
    const body = await readFile(join(source, f.path));
    if (body.length !== f.bytes || createHash("sha256").update(body).digest("hex") !== f.sha256)
      throw Error("Calendar artifact hash mismatch");
    files.set(f.path, body);
  }
  if (!files.has("calendar-v1.schema.json")) throw Error("Missing calendar schema");
  await mkdir(dirname(target), { recursive: true });
  const stage = await mkdtemp(join(dirname(target), ".calendar-stage-"));
  const backup = stage + "-old";
  let moved = false;
  try {
    for (const [name, body] of files) {
      await mkdir(dirname(join(stage, name)), { recursive: true });
      await writeFile(join(stage, name), body);
    }
    await writeFile(join(stage, "manifest.json"), manifestBytes);
    try {
      await rename(target, backup);
      moved = true;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    try {
      await rename(stage, target);
    } catch (e) {
      if (moved) await rename(backup, target);
      throw e;
    }
    if (moved) await rm(backup, { recursive: true });
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw Error("Pass an exported calendar artifact directory");
  await vendorCalendarContract(
    process.argv[2],
    process.argv[3] ?? new URL("../src/lib/calendars/vendor", import.meta.url).pathname,
  );
}
