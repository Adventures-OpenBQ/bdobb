// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment node
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { capabilityFor, scopeFor } from "./generate-capabilities.mjs";

describe("scopeFor", () => {
  it("expands absolute folders to path and path/** and skips the rest", () => {
    expect(scopeFor("/a/b/, relative , /c")).toEqual({
      scope: [{ path: "/a/b" }, { path: "/a/b/**" }, { path: "/c" }, { path: "/c/**" }],
      skipped: ["relative"],
    });
    expect(scopeFor("")).toEqual({ scope: [], skipped: [] });
  });
});

describe("capabilityFor", () => {
  it("grants mkdir and write-text-file scoped to the folders on the main window", () => {
    const cap = capabilityFor([{ path: "/a" }]);
    expect(cap.identifier).toBe("share-folders");
    expect(cap.windows).toEqual(["main"]);
    expect(cap.permissions).toEqual([
      "fs:allow-mkdir",
      "fs:allow-write-text-file",
      { identifier: "fs:scope", allow: [{ path: "/a" }] },
    ]);
  });
});

describe("run as a script", () => {
  // Review S-nat-6: argv[1] is the path as typed, import.meta.url the
  // symlink-resolved one, so through any symlinked ancestor the old
  // comparison decided "not the entry point" and wrote nothing, exit 0.
  it("writes the capability when invoked through a symlinked path", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gen-cap-"));
    try {
      const real = join(tmp, "real");
      mkdirSync(join(real, "scripts"), { recursive: true });
      mkdirSync(join(real, "src-tauri", "capabilities"), { recursive: true });
      copyFileSync(fileURLToPath(new URL("./generate-capabilities.mjs", import.meta.url)), join(real, "scripts", "generate-capabilities.mjs"));
      symlinkSync(real, join(tmp, "link"));
      execFileSync(process.execPath, [join(tmp, "link", "scripts", "generate-capabilities.mjs")], {
        env: { ...process.env, VITE_SHARE_FOLDERS: "/a" },
      });
      const out = JSON.parse(readFileSync(join(real, "src-tauri", "capabilities", "share-folders.json"), "utf8"));
      expect(out.permissions[2].allow).toEqual([{ path: "/a" }, { path: "/a/**" }]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
