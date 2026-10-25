// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { parseOmniResponse } from "./omni";

const envelope = (parse_as: string, content: unknown, extra_citations: unknown = []) => ({
  content,
  data_format: { data_type: "object", parse_as },
  extra_citations,
  citable: false,
});

describe("parseOmniResponse", () => {
  it("returns the parseAs and content for each of text, table, chart", () => {
    expect(parseOmniResponse(envelope("text", "hello"))).toMatchObject({ parseAs: "text", content: "hello" });
    expect(parseOmniResponse(envelope("table", [{ a: 1 }]))?.parseAs).toBe("table");
    const chart = { data: [], layout: {} };
    expect(parseOmniResponse(envelope("chart", chart))?.content).toEqual(chart);
  });

  it("returns null when the body is not an omni envelope", () => {
    expect(parseOmniResponse(null)).toBeNull();
    expect(parseOmniResponse("nope")).toBeNull();
    expect(parseOmniResponse({ content: "x" })).toBeNull(); // no data_format
    expect(parseOmniResponse(envelope("pie", "x"))).toBeNull(); // unknown parse_as
  });

  it("normalizes citations from source_info and drops entries with no source_info", () => {
    const r = parseOmniResponse(
      envelope("text", "hi", [
        { source_info: { type: "web", name: "OpenBB", origin: "https://openbb.co", description: "docs" } },
        { source_info: { type: "widget" } },
        { details: [{ page: 2 }] }, // no source_info -> dropped
        "garbage", // -> dropped
      ]),
    );
    expect(r?.citations).toEqual([
      { type: "web", name: "OpenBB", origin: "https://openbb.co", description: "docs" },
      { type: "widget" },
    ]);
  });

  it("returns an empty citation list when extra_citations is absent or not an array", () => {
    expect(parseOmniResponse(envelope("text", "hi"))?.citations).toEqual([]);
    expect(parseOmniResponse(envelope("text", "hi", "nope"))?.citations).toEqual([]);
  });
});
