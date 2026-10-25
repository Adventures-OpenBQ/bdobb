// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment node
//
// The app's version lives in THREE files, and nothing kept them in step. That
// is not hypothetical: the dmg labelled 3.0.0 was built from v4-cycle code,
// because the bump happens in each cycle's last task and every commit before
// it still read the old number. A release is tagged from these files, so a
// disagreement ships a build wearing the wrong version.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const at = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

/** The [package] version, not a dependency's — it is the first one in the file. */
function cargoVersion(toml: string): string | undefined {
  return /^version = "([^"]+)"/m.exec(toml)?.[1];
}

describe("the version is one number, in three files", () => {
  const pkg = JSON.parse(at("package.json")).version;

  it("package.json names a semver version", () => {
    expect(pkg).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("tauri.conf.json agrees with package.json", () => {
    expect(JSON.parse(at("src-tauri/tauri.conf.json")).version).toBe(pkg);
  });

  it("Cargo.toml agrees with package.json", () => {
    // Cargo.lock follows from `cargo check`; it is not asserted here because a
    // lock refresh is a separate step and would fail this for the wrong reason.
    expect(cargoVersion(at("src-tauri/Cargo.toml"))).toBe(pkg);
  });

  it("is the clean v8 development version", () => {
    expect(pkg).toBe("8.0.0");
    expect(at("src/help/guide/VERSION").trim()).toBe("v8.0.0 clean development candidate; qualification pending");
    expect(at("src-tauri/Cargo.lock")).toMatch(/name = "bdobb"\nversion = "8\.0\.0"/);
  });
});
