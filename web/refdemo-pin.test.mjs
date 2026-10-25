// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// The reference-demo image must build the SAME upstream commit the CI
// conformance job pins, not whatever `main` is today.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = rel => readFileSync(new URL(rel, import.meta.url), "utf8");
const dockerfile = read("../deploy/reference-demo/reference-backend/Dockerfile");
const commands = dockerfile.replace(/^\s*#.*$/gm, ""); // comments may name git clone --branch
const ci = read("../.github/workflows/ci.yml");

test("reference-demo Dockerfile defaults REF_BACKEND_REF to ci.yml's 40-hex pin", () => {
  const pin = ci.match(/^\s*REF_BACKEND_REF:\s*([0-9a-f]{40})\s*$/m)?.[1];
  assert.ok(pin, "ci.yml carries a 40-hex REF_BACKEND_REF");
  // The build-arg override stays: the ARG is still declared, only its default is pinned.
  assert.equal(dockerfile.match(/^ARG REF_BACKEND_REF=(\S+)$/m)?.[1], pin);
});

test("reference-demo Dockerfile fetches the ref, because git clone --branch rejects a SHA", () => {
  assert.doesNotMatch(commands, /git clone[^\n]*--branch/);
  assert.match(commands, /git -C \S+ fetch[^\n]*--depth 1[^"]*"\$\{REF_BACKEND_REF\}"/);
  assert.match(commands, /git -C \S+ checkout[^\n]*FETCH_HEAD/);
});
