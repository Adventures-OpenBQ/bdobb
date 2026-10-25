#!/usr/bin/env node
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Writes the example dashboards into openbb-docker, each into the apps.json
 * of the backend that owns its widgets.
 *
 *   pnpm apps:sync                          into ~/Developer/openbb-docker
 *   OPENBB_DOCKER_DIR=/path pnpm apps:sync  into a checkout somewhere else
 *   EPISODE=9 pnpm apps:sync                only the examples of episodes <= 9
 *
 * docs/examples/*.apps.json stay the source, one file per version line,
 * each parsed by src/lib/appsJson.examples.test.ts exactly as the importer
 * would. openbb-docker serves apps per backend (its commit bee3e5f): every
 * backend answers GET /apps.json with the apps built on its own widgets,
 * read from a file its Dockerfile bakes into the image. OWNER names that
 * file for each example; a new example must be added here or the sync
 * refuses it, since an unrouted example is one nobody would ever see.
 *
 * EPISODE is for the per-episode tags: run on a tag's tree, it writes only
 * the examples that tag's stack can serve, so each episode image carries
 * the examples of its era. A target left with no apps is not written.
 *
 * Commit the diff in openbb-docker; it ships with that repo's next release.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OWNER = {
  // Both are built-ins/keyless-provider examples and need only openbb-api's
  // own /apps.json surface, which every install has -- the same reasoning
  // v8.0.0-news set the precedent for.
  "v3.1.0-builtins": "workspace_apps.json",
  "v3.1.0-demo-providers": "workspace_apps.json",
  // The Video Library card is openbb-api's own widget (openbb-docker's
  // openbb-videos extension), so openbb-api's /apps.json carries it.
  "v3.2.0-video-library": "workspace_apps.json",
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "docs", "examples");
const OUT = process.env.OPENBB_DOCKER_DIR ?? join(homedir(), "Developer", "openbb-docker");
const EPISODE = process.env.EPISODE ? Number(process.env.EPISODE) : Infinity;

const files = readdirSync(SRC)
  .filter((f) => f.endsWith(".apps.json"))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const byTarget = new Map();
for (const f of files) {
  const stem = f.slice(0, -".apps.json".length);
  const target = OWNER[stem];
  if (!target) throw new Error(`${f} has no owning backend in OWNER (scripts/apps-sync.mjs)`);
  if (Number(stem.slice(1).split(".")[0]) > EPISODE) continue;
  const apps = JSON.parse(readFileSync(join(SRC, f), "utf8"));
  byTarget.set(target, [...(byTarget.get(target) ?? []), ...apps]);
}
for (const [target, apps] of byTarget) {
  writeFileSync(join(OUT, target), `${JSON.stringify(apps, null, 2)}\n`);
  console.log(`wrote ${apps.length} app(s) to ${join(OUT, target)}`);
}
