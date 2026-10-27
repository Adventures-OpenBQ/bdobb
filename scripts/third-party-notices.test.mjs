// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { owners } from "./third-party-notices.mjs";

test("a BUSL licence's owner is its Licensed Work line, not a (c) list item", () => {
  const text = readFileSync(new URL("../vendor/arts-charts/LICENSE", import.meta.url), "utf8");
  assert.deepEqual(owners({ license: "BUSL-1.1", texts: [text] }), ["(c) 2026 SecretoftheUniverse.com LLC"]);
});

test("the generated notices carry the vendored package and its own notices", () => {
  const out = readFileSync(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");
  assert.match(out, /\| @adventures-openbq\/arts-charts \| 0\.1\.0 \| BUSL-1\.1 \| \(c\) 2026 SecretoftheUniverse\.com LLC \|/);
  assert.match(out, /## Notices carried by @adventures-openbq\/arts-charts/);
  assert.match(out, /Rendered by TradingView|Lightweight Charts™ by TradingView/);
});

test("the rendered BUSL text keeps the grant line that starts with (c)", () => {
  const out = readFileSync(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");
  assert.match(out, /Assets Under Management are less than/);
});
