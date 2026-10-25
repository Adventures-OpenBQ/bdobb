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
 * file. An example's episode is the leading vN of its name. An entry
 * `{ also: "<path>" }` is served in the combined file like the rest and also
 * written, as it is, to that path in openbq-docker (v10's live-grid example,
 * whose live-grid service reads live-grid/apps.json).
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
  // Built-ins only (Markdown, Clock, Note).
  "v6.0.0-rita": true,
  // Built-ins only (Note, Clock, Markdown): the iPad touch sample.
  "v7.0.0-touch": true,
  // Built-in News card only (its feeds come from an rss-ticker server).
  "v8.0.0-news": true,
  // Built-ins only (Note, Markdown, Clock), two of them pinned. Never an
  // example with locked widgets -- importing one replaces the reader's.
  "v8.0.0-pinned": true,
  // Episode 9: the EODHD cards are the openbb-eodhd extension's mirror widgets
  // (eodhd_*_eodhd_obb) and the Treasury card is the keyless
  // ustreasury_auction_results widget; openbq-docker v9 serves all six card ids
  // (V9-P4, checked against claude/openbq-docker-v9 12aea38). Needs EODHD_API_KEY.
  "v9.0.0-calendars": true,
  // Episode 10: every card (live_grid, subscriptions, kdb_ticks, live_chart,
  // kdb_cache_chart) is the live-grid sidecar's own widget, which openbq-api
  // does not serve. It goes into the combined file like every example, and
  // `also` writes it, as it is, to live-grid/apps.json too: the live-grid
  // image bakes that file in and serves it at its own /apps.json (openbq-docker
  // v10's live-grid/app/main.py reads it; the opt-in `live` profile).
  "v10.0.0-live-grid": { also: "live-grid/apps.json" },
  // OpenBB Workspace's CFTC, BLS and IMF dashboards on openbq-docker's widget ids.
  "v3.1.0-openbb-workspace": true,
  // OpenBB Workspace's Analysis Dashboard on the openbq-eodhd extension's ids
  // (eodhd_equity_*_eodhd_obb). Needs EODHD_API_KEY.
  "v9.0.0-openbb-workspace-analysis": true,
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
const elsewhere = new Map();
const seen = new Set();
for (const rel of found) {
  const name = rel.endsWith("/apps.json") ? rel.slice(0, -"/apps.json".length) : rel.endsWith(".apps.json") ? rel.slice(0, -".apps.json".length) : rel;
  if (!(name in SERVED)) throw new Error(`docs/examples/${rel} is not listed in SERVED (scripts/apps-sync.mjs)`);
  const episode = /^v(\d+)[.-]/.exec(name);
  if (!episode) throw new Error(`docs/examples/${rel}: no leading vN episode in its name`);
  seen.add(name);
  if (Number(episode[1]) > EPISODE) continue;
  const parsed = JSON.parse(readFileSync(join(SRC, rel), "utf8"));
  const also = SERVED[name].also;
  if (also) elsewhere.set(also, [...(elsewhere.get(also) ?? []), ...parsed]);
  for (const app of parsed) {
    apps.push({ ...app, img: LOGO_PATH, img_dark: logoUri, img_light: logoUri });
  }
}
const missing = Object.keys(SERVED).filter((name) => !seen.has(name));
if (missing.length) throw new Error(`SERVED names examples with no file: ${missing.join(", ")}`);

// Non-ASCII as \uXXXX escapes, as openbq-docker's file has them, so a re-sync
// of unchanged examples writes an unchanged file.
const write = (target, list) => {
  mkdirSync(dirname(target), { recursive: true });
  const json = JSON.stringify(list, null, 2).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  writeFileSync(target, `${json}\n`);
  console.log(`wrote ${list.length} app(s) to ${target}: ${list.map((a) => a.name).join(" | ")}`);
};
write(join(OUT, "examples", "bdobb", "apps.json"), apps);
for (const [rel, list] of elsewhere) write(join(OUT, rel), list);
