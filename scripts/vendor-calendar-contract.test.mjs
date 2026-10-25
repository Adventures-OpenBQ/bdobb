// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { vendorCalendarContract } from "./vendor-calendar-contract.mjs";
test("verifies bytes before replacing the old artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "calendar-vendor-"));
  try {
    const body = "{}";
    await writeFile(join(root, "calendar-v1.schema.json"), body);
    await writeFile(
      join(root, "manifest.json"),
      JSON.stringify({
        artifactVersion: 1,
        contractVersion: 1,
        files: [{ path: "calendar-v1.schema.json", bytes: 2, sha256: createHash("sha256").update(body).digest("hex") }],
      }),
    );
    const target = join(root, "output");
    await vendorCalendarContract(root, target);
    assert.equal(await readFile(join(target, "calendar-v1.schema.json"), "utf8"), "{}");
    await writeFile(join(root, "calendar-v1.schema.json"), "tampered");
    await assert.rejects(() => vendorCalendarContract(root, target));
    assert.equal(await readFile(join(target, "calendar-v1.schema.json"), "utf8"), "{}");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
