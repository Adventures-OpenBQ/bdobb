#!/usr/bin/env node
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Writes every BDOBB example dashboard into openbq-docker's one combined
 * examples/bdobb/apps.json, which its API image serves on /apps.json next to
 * the provider apps (the lanes hook appends it to the built catalog).
 *
 *   pnpm apps:sync                          into ~/Developer/openbq-docker
 *   OPENBQ_DOCKER_DIR=/path pnpm apps:sync  into a checkout somewhere else
 *   EPISODE=4 pnpm apps:sync                only the examples of episodes <= 4
 *
 * BDOBB vN pairs with openbq-docker vN (package.json's `openbqDocker`), and
 * openbq-docker vN serves every BDOBB example from v3 through vN in that one
 * file; run this on BDOBB vN's tree with EPISODE=N for the vN stack.
 *
 * docs/examples stays the source, each file parsed by
 * src/lib/appsJson.examples.test.ts exactly as the importer would. SERVED
 * names every example: a top-level <name>.apps.json by <name>, a
 * <dir>/apps.json by <dir>. The scan takes every file under docs/examples
 * whose name ends in apps.json, and refuses one SERVED does not name (an
 * unrouted example is one nobody would ever see), and a SERVED entry with no
 * file. An example's episode is the leading vN of its name.
 *
 * Each app gets the BDOBB logo: `img` is the path openbq-docker's lanes hook
 * serves without Basic auth (BDOBB shows only http(s) card images, resolved
 * against the backend URL), and `img_dark`/`img_light` embed the same SVG as a
 * data URI for clients that take one.
 *
 * Commit the diff in openbq-docker.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SERVED = {
  // Built-ins only.
  "v3.1.0-builtins": true,
  // openbq-docker v3's keyless BLS, CFTC, EconDB, Nasdaq and Videos widgets,
  // and EIA and Congress.gov on credentials.demo.env's public demo keys.
  "v3.1.0-demo-providers": true,
  // The Videos card (the openbb-videos extension openbq-docker v3 adds).
  "v3.2.0-video-library": true,
  // Built-ins only (the v4 date-expression and period cards among them).
  "v4.0.0-builtins": true,
  "v4.0.0-parameters": true,
  // The synthetic Statement fixture widget, synthetic_cash_flow, which
  // openbq-docker v5+ serves under the same id; its fixture (widgets.json,
  // cash-flow.json) sits beside it in docs/examples/v5-financial-demo/.
  "v5-financial-demo": true,
  // openbq-docker's own keyless Treasury auction widgets.
  "v5.0.0-treasury-calendar": true,
  // OpenBB Workspace's CFTC, BLS and IMF dashboards on openbq-docker's widget ids.
  "v3.1.0-openbb-workspace": true,
};

const LOGO_PATH = "/openbq/bdobb-logo.svg";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "docs", "examples");
const OUT = process.env.OPENBQ_DOCKER_DIR ?? join(homedir(), "Developer", "openbq-docker");
const EPISODE = process.env.EPISODE ? Number(process.env.EPISODE) : Infinity;
if (!(EPISODE === Infinity || Number.isInteger(EPISODE))) throw new Error(`EPISODE must be a whole number, not ${process.env.EPISODE}`);

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const found = walk(SRC)
  .map((path) => relative(SRC, path).split(sep).join("/"))
  .filter((rel) => rel.endsWith("apps.json"))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const logo = readFileSync(join(OUT, "examples", "episode3", "assets", "bdobb-logo.svg"));
const logoUri = `data:image/svg+xml;base64,${logo.toString("base64")}`;

const apps = [];
const seen = new Set();
for (const rel of found) {
  const name = rel.endsWith("/apps.json") ? rel.slice(0, -"/apps.json".length) : rel.endsWith(".apps.json") ? rel.slice(0, -".apps.json".length) : rel;
  if (!(name in SERVED)) throw new Error(`docs/examples/${rel} is not listed in SERVED (scripts/apps-sync.mjs)`);
  const episode = /^v(\d+)[.-]/.exec(name);
  if (!episode) throw new Error(`docs/examples/${rel}: no leading vN episode in its name`);
  seen.add(name);
  if (Number(episode[1]) > EPISODE) continue;
  for (const app of JSON.parse(readFileSync(join(SRC, rel), "utf8"))) {
    apps.push({ ...app, img: LOGO_PATH, img_dark: logoUri, img_light: logoUri });
  }
}
const missing = Object.keys(SERVED).filter((name) => !seen.has(name));
if (missing.length) throw new Error(`SERVED names examples with no file: ${missing.join(", ")}`);

// Non-ASCII as \uXXXX escapes, as openbq-docker's file has them, so a re-sync
// of unchanged examples writes an unchanged file.
const target = join(OUT, "examples", "bdobb", "apps.json");
mkdirSync(dirname(target), { recursive: true });
const json = JSON.stringify(apps, null, 2).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
writeFileSync(target, `${json}\n`);
console.log(`wrote ${apps.length} app(s) to ${target}: ${apps.map((a) => a.name).join(" | ")}`);
