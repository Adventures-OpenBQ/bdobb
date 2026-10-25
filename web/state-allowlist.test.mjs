// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stateFile } from "./policy.mjs";

// The page (src/browser-shim/fs.ts) keeps its own copy of the /state allow-list,
// since policy.mjs is Node-only. When the copies drifted, the page saved
// workspaces/ and layouts/ files the server refused, and a signed-in preview
// user lost them on reload. The two patterns must be the same text.
const pattern = (path) => /const STATE_FILE_RE = (\/.+\/);/.exec(readFileSync(new URL(path, import.meta.url), "utf8"))?.[1];

test("the page's /state allow-list is the vendored policy's", () => {
  assert.ok(pattern("./policy.mjs"));
  assert.equal(pattern("../src/browser-shim/fs.ts"), pattern("./policy.mjs"));
});

test("/state keeps workspaces/ and layouts/ files", () => {
  const id = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  for (const ok of [`dashboards/${id}.json`, `workspaces/${id}.json`, `layouts/${id}.json`]) assert.equal(stateFile(ok), true, ok);
  for (const bad of ["workspaces/a/b.json", "layouts/../settings.json", "workspace/a.json"]) assert.equal(stateFile(bad), false, bad);
});
