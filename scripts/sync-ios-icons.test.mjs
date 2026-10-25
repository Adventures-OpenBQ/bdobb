// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncIosIcons } from "./sync-ios-icons.mjs";

const roots = [];
const catalogPath = "src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bdobb-icon-sync-"));
  roots.push(root);
  return root;
}
function artwork(root, filename = "AppIcon-120.png") {
  const source = join(root, "src-tauri/icons/apple/AppIcon.appiconset");
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "Contents.json"), JSON.stringify({ images: [{ filename }] }));
  writeFileSync(join(source, "AppIcon-120.png"), "new opaque icon");
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Apple icon sync", () => {
  it("does nothing on desktop-only checkouts", () => {
    expect(syncIosIcons(fixture())).toBe(false);
  });

  it("refreshes an existing project without touching signing or desktop assets", () => {
    const root = fixture();
    const target = join(root, catalogPath);
    mkdirSync(target, { recursive: true });
    artwork(root);
    writeFileSync(join(target, "AppIcon-120.png"), "old");
    writeFileSync(join(target, "developer-file.txt"), "keep");
    const project = join(root, "src-tauri/gen/apple/project.yml");
    writeFileSync(project, "private signing state");
    const desktop = join(root, "src-tauri/icons/icon.png");
    copyFileSync("src-tauri/icons/icon.png", desktop);
    const before = readFileSync(desktop);
    expect(syncIosIcons(root)).toBe(true);
    expect(readFileSync(join(target, "AppIcon-120.png"), "utf8")).toBe("new opaque icon");
    expect(JSON.parse(readFileSync(join(target, "Contents.json"), "utf8")).images).toEqual([
      { filename: "AppIcon-120.png" },
    ]);
    expect(readFileSync(project, "utf8")).toBe("private signing state");
    expect(readFileSync(join(target, "developer-file.txt"), "utf8")).toBe("keep");
    expect(readFileSync(desktop)).toEqual(before);
    expect(syncIosIcons(root)).toBe(true); // Idempotent.
  });

  it("does not silently skip an initialized project with a missing catalog", () => {
    const root = fixture();
    mkdirSync(join(root, "src-tauri/gen/apple"), { recursive: true });
    expect(() => syncIosIcons(root)).toThrow(/ios:init/);
  });

  it.each(["../outside.png", "AppIcon-999.png"])("rejects bad source reference %s before copying", filename => {
    const root = fixture();
    mkdirSync(join(root, catalogPath), { recursive: true });
    artwork(root, filename);
    writeFileSync(join(root, catalogPath, "Contents.json"), "old catalog");
    expect(() => syncIosIcons(root)).toThrow(/Invalid or missing/);
    expect(readFileSync(join(root, catalogPath, "Contents.json"), "utf8")).toBe("old catalog");
  });

  it("runs at init and in both native lifecycle hooks, without replacing other setup", () => {
    const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
    for (const name of ["beforeBuildCommand", "beforeDevCommand"]) {
      expect(config.build[name]).toContain("node scripts/sync-ios-icons.mjs");
      expect(config.build[name]).toContain("node scripts/generate-capabilities.mjs");
    }
    const init = readFileSync("scripts/ios.sh", "utf8");
    expect(init).toContain('node "$SCRIPT_DIR/sync-ios-icons.mjs"');
    expect(init).not.toContain("pnpm tauri icon src-tauri/icons/icon.png");
  });
});
