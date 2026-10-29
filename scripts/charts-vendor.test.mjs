// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectFiles, treeHash } from "./charts-vendor.mjs";

test("selectFiles keeps the package's shipped files and the skill, drops tests, render, dev and lockfiles", () => {
  const picked = selectFiles([
    "client/package.json", "client/LICENSE", "client/ARTS_CHARTS_TERMS.md", "client/THIRD_PARTY_NOTICES.md",
    "client/src/index.ts", "client/src/arts-charts.css", "client/src/a.test.ts", "client/src/b.test.tsx",
    "client/src/test/setup.ts", "client/render/main.tsx", "client/pnpm-lock.yaml", "client/vite.config.ts",
    "skills/arts-charts/SKILL.md", "server/arts_charts/app.py", "dev/serve.py",
  ]);
  assert.deepEqual(picked, [
    "client/ARTS_CHARTS_TERMS.md", "client/LICENSE", "client/THIRD_PARTY_NOTICES.md", "client/package.json",
    "client/src/arts-charts.css", "client/src/index.ts", "skills/arts-charts/SKILL.md",
  ]);
});

test("treeHash is order-independent and changes when one byte changes", () => {
  const root = mkdtempSync(join(tmpdir(), "charts-vendor-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "a.txt"), "a");
  writeFileSync(join(root, "src", "b.ts"), "b");
  const one = treeHash(root, ["a.txt", "src/b.ts"]);
  assert.equal(treeHash(root, ["src/b.ts", "a.txt"]), one);
  writeFileSync(join(root, "src", "b.ts"), "c");
  assert.notEqual(treeHash(root, ["a.txt", "src/b.ts"]), one);
});

test("the committed lock matches the committed tree", () => {
  const lock = JSON.parse(readFileSync(new URL("../vendor/arts-charts.lock.json", import.meta.url), "utf8"));
  assert.match(lock.commit, /^[0-9a-f]{40}$/);
  assert.ok(lock.tag === null || /^v\d+\.\d+\.\d+$/.test(lock.tag));
  const root = new URL("../vendor/arts-charts/", import.meta.url).pathname;
  const files = JSON.parse(readFileSync(new URL("../vendor/arts-charts/.files.json", import.meta.url), "utf8"));
  assert.equal(treeHash(root, files), lock.sha256);
});
