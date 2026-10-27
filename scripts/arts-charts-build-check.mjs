#!/usr/bin/env node
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

/**
 * Spec B2 / §8 "Build": greps a built dist/ for Art's Charts. --absent (VITE_ARTS_CHARTS=0)
 * fails on any marker; --present (the default build) fails unless every marker is there.
 * Markers: package code (host error text), the widget id (quoted, so part 3's
 * "arts_chart_snapshot" cannot match), the skill's heading, and the package stylesheet.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const MARKERS = {
  package: "Art's Charts has no host",
  widget: '"arts_chart"',
  skill: "# Art's Charts chart documents",
  css: ".chart-doc-bell",
};

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(js|mjs|css|html)$/.test(name)) yield p;
  }
}

export function scan(dist) {
  const found = Object.fromEntries(Object.keys(MARKERS).map((k) => [k, []]));
  for (const file of walk(dist)) {
    const text = readFileSync(file, "utf8");
    for (const [k, m] of Object.entries(MARKERS)) if (text.includes(m)) found[k].push(file);
  }
  return found;
}

if (process.argv[1]?.endsWith("arts-charts-build-check.mjs")) {
  const [dist = "dist", mode = "--absent"] = process.argv.slice(2);
  const found = scan(dist);
  const bad = Object.entries(found).filter(([, files]) => (mode === "--absent" ? files.length > 0 : files.length === 0));
  for (const [k, files] of bad) console.error(`${mode === "--absent" ? "present" : "missing"}: ${k} ${files.join(" ")}`);
  process.exit(bad.length ? 1 : 0);
}
