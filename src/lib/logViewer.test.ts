// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: () => Promise.resolve("/fake/appdata"),
  join: (...parts: string[]) => Promise.resolve(parts.join("/")),
}));

import { __reset, __seed } from "../test/memfs";
import { readLogTail } from "./logViewer";

beforeEach(() => {
  __reset();
});

describe("readLogTail", () => {
  it("returns an empty tail and the resolved path when the log file is absent", async () => {
    const result = await readLogTail();
    expect(result.lines).toEqual([]);
    expect(result.path).toBe("/fake/appdata/logs/bdobb.log");
  });

  it("returns every line when the file has fewer than 100", async () => {
    __seed("logs/bdobb.log", "line1\nline2\nline3\n");
    const result = await readLogTail();
    expect(result.lines).toEqual(["line1", "line2", "line3"]);
  });

  it("returns only the last 100 lines of a longer file", async () => {
    const allLines = Array.from({ length: 150 }, (_, i) => `line${i + 1}`);
    __seed("logs/bdobb.log", allLines.join("\n") + "\n");
    const result = await readLogTail();
    expect(result.lines).toHaveLength(100);
    expect(result.lines[0]).toBe("line51");
    expect(result.lines.at(-1)).toBe("line150");
  });

  it("drops only the trailing empty line produced by a final newline", async () => {
    __seed("logs/bdobb.log", "line1\nline2\n");
    const result = await readLogTail();
    expect(result.lines).toEqual(["line1", "line2"]);
  });

  it("preserves an interior blank line", async () => {
    __seed("logs/bdobb.log", "a\n\nb\n");
    const result = await readLogTail();
    expect(result.lines).toEqual(["a", "", "b"]);
  });

  it("returns all 100 lines when the file has exactly 100", async () => {
    const allLines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`);
    __seed("logs/bdobb.log", allLines.join("\n") + "\n");
    const result = await readLogTail();
    expect(result.lines).toHaveLength(100);
    expect(result.lines[0]).toBe("line1");
    expect(result.lines.at(-1)).toBe("line100");
  });

  it("returns an empty tail for a zero-byte existing file", async () => {
    __seed("logs/bdobb.log", "");
    const result = await readLogTail();
    expect(result.lines).toEqual([]);
  });
});
