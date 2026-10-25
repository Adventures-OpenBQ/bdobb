// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { disabledEffective, displayToolName, effectiveToolNames, PROXY_TOOLS } from "./proxiedTools";

const pipeline = {
  steps: [{ tool: "a", arguments: { x: 1 } }, { tool: "b", id: "s2" }, { tool: "c", inputs: {} }],
};

describe("effectiveToolNames", () => {
  it("refuses call_tool naming a proxy, so a nested pipeline cannot hide a disabled tool", () => {
    for (const name of PROXY_TOOLS) expect(effectiveToolNames("call_tool", { name, arguments: { steps: [{ tool: "off" }] } })).toMatchObject({ ok: false });
    expect(disabledEffective("u", "call_tool", { name: "run_pipeline", arguments: { steps: [{ tool: "off" }] } }, { u: ["off"] })).toHaveProperty("malformed");
  });

  it("refuses a run_pipeline step that is itself a proxy (review A9)", () => {
    for (const tool of PROXY_TOOLS) {
      expect(effectiveToolNames("run_pipeline", { steps: [{ tool: "a" }, { tool, arguments: { name: "place_order" } }] })).toMatchObject({ ok: false });
    }
    // So a disabled tool cannot hide behind a nested call_tool.
    expect(disabledEffective("u", "run_pipeline", { steps: [{ tool: "call_tool", arguments: { name: "off" } }] }, { u: ["off"] })).toHaveProperty("malformed");
  });

  it("names the proxies", () => {
    expect(PROXY_TOOLS).toEqual(["call_tool", "run_pipeline"]);
  });

  it("reads call_tool's name argument", () => {
    expect(effectiveToolNames("call_tool", { name: "equity_price_historical", arguments: { symbol: "AAPL" } })).toEqual({
      ok: true,
      names: ["equity_price_historical"],
      via: "call_tool",
    });
  });

  it("reads every run_pipeline step, in order", () => {
    expect(effectiveToolNames("run_pipeline", pipeline)).toEqual({ ok: true, names: ["a", "b", "c"], via: "run_pipeline" });
  });

  it("leaves any other tool as itself", () => {
    expect(effectiveToolNames("search_tools", { query: "x" })).toEqual({ ok: true, names: ["search_tools"] });
  });

  it.each([
    ["call_tool with no name", "call_tool", { arguments: {} }, /name/],
    ["call_tool with a numeric name", "call_tool", { name: 7 }, /name/],
    ["call_tool with an empty name", "call_tool", { name: "" }, /name/],
    ["call_tool with string arguments", "call_tool", { name: "t", arguments: "x" }, /arguments/],
    ["run_pipeline with no steps", "run_pipeline", {}, /steps/],
    ["run_pipeline with steps as an object", "run_pipeline", { steps: {} }, /steps/],
    ["run_pipeline with empty steps", "run_pipeline", { steps: [] }, /steps/],
    ["a step with no tool", "run_pipeline", { steps: [{ arguments: {} }] }, /tool/],
    ["a step with a non-string tool", "run_pipeline", { steps: [{ tool: 3 }] }, /tool/],
  ])("refuses malformed input: %s", (_label, tool, args, message) => {
    const r = effectiveToolNames(tool, args);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(message);
  });
});

describe("displayToolName", () => {
  it("labels a call_tool call by its effective name", () => {
    expect(displayToolName("openbq-mcp", "call_tool", { name: "equity_price_historical" })).toBe(
      "openbq-mcp · equity_price_historical (via call_tool)",
    );
  });
  it("labels a pipeline by its step list", () => {
    expect(displayToolName("openbq-mcp", "run_pipeline", pipeline)).toBe("openbq-mcp · pipeline: a → b → c (via run_pipeline)");
  });
  it("labels any other tool plainly", () => {
    expect(displayToolName("openbq-mcp", "search_tools", {})).toBe("openbq-mcp · search_tools");
  });
  it("falls back to the advertised name for a malformed proxy call", () => {
    expect(displayToolName("openbq-mcp", "call_tool", {})).toBe("openbq-mcp · call_tool");
  });
});

describe("disabledEffective", () => {
  const A = "https://a.example/mcp";
  const B = "https://b.example/mcp";
  it("returns the disabled subset of a pipeline", () => {
    expect(disabledEffective(A, "run_pipeline", pipeline, { [A]: ["b", "zzz"] })).toEqual({ disabled: ["b"] });
  });
  it("blocks only the server that disabled the name", () => {
    const disabled = { [A]: ["equity_price_historical"] };
    expect(disabledEffective(B, "call_tool", { name: "equity_price_historical" }, disabled)).toBeNull();
    expect(disabledEffective(A, "call_tool", { name: "equity_price_historical" }, disabled)).toEqual({
      disabled: ["equity_price_historical"],
    });
  });
  it("reports the proxy itself when it is disabled", () => {
    expect(disabledEffective(A, "call_tool", { name: "x" }, { [A]: ["call_tool"] })).toEqual({ disabled: ["call_tool"] });
  });
  it("reports a malformed proxy call", () => {
    const r = disabledEffective(A, "call_tool", {}, undefined);
    expect(r).toEqual({ malformed: expect.stringMatching(/name/) });
  });
  it("returns null when nothing is disabled", () => {
    expect(disabledEffective(A, "call_tool", { name: "x" }, undefined)).toBeNull();
    expect(disabledEffective(A, "search_tools", {}, { [A]: ["other"] })).toBeNull();
  });
});
