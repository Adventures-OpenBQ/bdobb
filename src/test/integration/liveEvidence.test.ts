// Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { liveTurnEvidence, numericClaims, numericValues, rowCountAnswer, widgetReadEvidence } from "./liveEvidence";

describe("live qualification evidence", () => {
  it("projects a data callback before it can reach an assertion diff", () => {
    const raw = { ok: false, rows: 0, url: "https://example.invalid/?key=SECRET_SENTINEL", params: { token: "SECRET_SENTINEL" }, error: "SECRET_SENTINEL" };
    expect(widgetReadEvidence(raw)).toEqual({ ok: false, rows: 0 });
    expect(JSON.stringify(widgetReadEvidence(raw))).not.toContain("SECRET_SENTINEL");
  });

  it("reports turn outcomes without copying model, status or argument text", () => {
    const result = liveTurnEvidence("SECRET_SENTINEL", [{ message: "SECRET_SENTINEL" }], [
      { tool: "remove_widget", args: { url: "SECRET_SENTINEL" }, result: { error: "SECRET_SENTINEL" } },
    ], "remove_widget");
    expect(result).toEqual({ has_reply: true, status_count: 1, tool_rounds: 1, expected_tool_calls: 1 });
    expect(JSON.stringify(result)).not.toContain("SECRET_SENTINEL");
  });

  it("keeps signs, Unicode minus, commas and scientific notation", () => {
    expect(numericClaims("East +360; West -615; loss −210; 1,234.50; -2e3")).toEqual([360, -615, -210, 1234.5, -2000]);
  });

  it("does not accept the opposite sign of an actual group total", () => {
    const actual = new Set(numericValues([{ region: "West", total: 615 }]));
    expect(numericClaims("West: -615").every(value => actual.has(value))).toBe(false);
  });

  it("excludes structural ordered-list labels while keeping the claims in them", () => {
    expect(numericClaims("**1. Table unavailable**\n**2. Cannot sum text**")).toEqual([]);
    expect(numericClaims("1. East: 360\n2) West: -615\n   3. Missing: 9")).toEqual([360, -615, 9]);
  });

  it("reads engine numbers, not digits from keys or string labels", () => {
    expect(numericValues([{ "2026": "Region 12", amount: -615, nested: [360, null, "210"] }])).toEqual([-615, 360]);
  });

  it("keeps unsupported counts visible to the refusal oracle", () => {
    expect(numericClaims("1. North has 999 rows; East has 13.")).toEqual([999, 13]);
  });

  it("requires one final explicit row-count answer", () => {
    expect(rowCountAnswer("Reading the widget.\n\nROWS=2")).toBe(2);
    expect(rowCountAnswer("ROWS=999")).not.toBe(2);
    expect(rowCountAnswer("I could not tell.")).toBeUndefined();
    expect(rowCountAnswer("ROWS=2\nROWS=999")).toBeUndefined();
    expect(rowCountAnswer("ROWS=2\nMore text")).toBeUndefined();
  });
});
