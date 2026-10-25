// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from "vitest";
import {
  streamOf,
  initializeResult,
  rawTools,
  initializeSse,
  toolsListSse,
} from "./mcp-fixtures";

describe("mcp fixtures", () => {
  it("carries the captured initialize reply verbatim", () => {
    expect(initializeSse.length).toBe(347);
    expect(initializeResult.protocolVersion).toBe("2025-06-18");
    expect(initializeResult.serverInfo).toEqual({
      name: "stores",
      version: "3.4.0",
    });
  });

  it("carries the six ArcticDB/kdb tools", () => {
    expect(toolsListSse.length).toBe(3606);
    expect(rawTools.map((t) => t.name)).toEqual([
      "arctic_list_libraries",
      "arctic_list_symbols",
      "arctic_read",
      "kdb_tables",
      "kdb_table_schema",
      "kdb_select",
    ]);
  });

  it("streamOf slices bytes, not characters", async () => {
    const text = "héllo";
    const reader = streamOf(text, 2).getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    // "héllo" is 6 bytes (é is two), so 2-byte chunks give 3 reads.
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length <= 2)).toBe(true);
  });
});
