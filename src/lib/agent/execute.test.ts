// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";
import { backend, card, widget } from "../../test/fixtures";
import { callMcpTool } from "./mcp";
import { McpError } from "./mcpError";
import { __resetStatementYearEndsForTests } from "../../hooks/useStatementYearEnds";
import { keyMaintBackendIds } from "../providerKeys";
import { cardRequestSync } from "../../hooks/useCardRequest";
import { relabel } from "../periods";
import { wireParams } from "../params";
import type { BackendConfig, DashboardCard, WidgetDef } from "../types";
import type { AgentCall } from "./types";
import {
  MAX_RESULT_CHARS,
  buildWidgetRefs,
  capContent,
  executeFunction,
  makeWidgetDataFetcher,
  runAgentTool,
  type WidgetFetcher,
} from "./execute";

vi.mock("../logger", () => ({ logError: vi.fn(async () => {}), logOnce: vi.fn(async () => {}) }));
// Only the statement correction's year-end lookup; everything else is real.
const fetchFiscalYearEnd = vi.fn();
vi.mock("../dataClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../dataClient")>()),
  fetchFiscalYearEnd: (...a: unknown[]) => fetchFiscalYearEnd(...a),
}));
vi.mock("./mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mcp")>()),
  callMcpTool: vi.fn(async () => ({ ok: true })),
}));
vi.mock("./localTools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./localTools")>()),
  executeLocalTool: vi.fn(async (name: string) => ({ ran: name })),
}));

const UUID = "11111111-2222-3333-4444-555555555555";
const prices = widget({
  id: "historical_prices",
  backendId: "reference",
  name: "Historical Prices",
  description: "Daily OHLC",
  endpoint: "/historical",
  params: [{ paramName: "symbol", label: "Symbol", value: "SPY", description: "Ticker" }],
});
const cards = [card({ id: UUID, widgetId: "historical_prices", backendId: "reference", params: { symbol: "AAPL" } })];
const backends = [backend({ id: "reference", name: "Reference", baseUrl: "http://x/" })];
const findWidget = (backendId: string, widgetId: string) =>
  backendId === prices.backendId && widgetId === prices.id ? prices : undefined;
const signal = new AbortController().signal;

describe("buildWidgetRefs", () => {
  it("tells Rita a local file table is read with describe_table, not get_widget_data (which refuses it and ends her turn)", async () => {
    const { BUILTIN_WIDGETS, LOCAL_TABLE_ID } = await import("../builtins");
    const local = BUILTIN_WIDGETS.find(w => w.id === LOCAL_TABLE_ID)!;
    const [ref] = buildWidgetRefs([card({ id: "t", backendId: "builtin", widgetId: LOCAL_TABLE_ID, params: { file: "x.csv" } })], () => local, () => "Built-in", new Set());
    expect(ref.description).toMatch(/describe_table/);
    expect(ref.description).toMatch(/arrange_table/);
    expect(ref.description).toMatch(/not.*get_widget_data|get_widget_data cannot/);
  });
  it("describes each card as a Rita widget ref", () => {
    const refs = buildWidgetRefs(cards, findWidget, () => "Reference", new Set());
    expect(refs).toEqual([
      {
        uuid: UUID,
        origin: "reference",
        widget_id: "historical_prices",
        name: "Historical Prices",
        description: "Daily OHLC",
        metadata: { backend_name: "Reference" },
        params: [
          { name: "symbol", type: "text", description: "Ticker", current_value: "AAPL", default_value: "SPY" },
        ],
      },
    ]);
  });

  it("uses the card title when set and skips keys widgets and unresolved cards", () => {
    const keys = widget({ id: "k", backendId: "reference", type: "keys" });
    const lookup = (b: string, w: string) => (w === "k" ? keys : findWidget(b, w));
    const refs = buildWidgetRefs(
      [
        card({ id: "a", widgetId: "historical_prices", backendId: "reference", title: "My prices" }),
        card({ id: "b", widgetId: "k", backendId: "reference" }),
        card({ id: "c", widgetId: "missing", backendId: "reference" }),
      ],
      lookup,
      () => undefined,
      new Set(),
    );
    expect(refs.map((r) => r.uuid)).toEqual(["a"]);
    expect(refs[0].name).toBe("My prices");
    expect(refs[0].metadata).toEqual({ backend_name: "reference" });
  });
});

/** The card's own request on a dashboard with no groups, as chatStore builds it. */
const NO_GROUPS = { request: (c: DashboardCard, w: WidgetDef, b: BackendConfig) => cardRequestSync(c, w, b, undefined) };

describe("makeWidgetDataFetcher", () => {
  const source = { widget_uuid: UUID, origin: "reference", id: "historical_prices", input_args: { symbol: "MSFT" } };

  it("reads keyMaintBackends at each fetch, so a backend that turns out to serve key-maint mid-turn is refused", async () => {
    const fetchData = vi.fn(async () => []);
    let live: ReadonlySet<string> = new Set();
    const fetcher = makeWidgetDataFetcher(
      {
        cards,
        backends,
        findWidget,
        get keyMaintBackends() {
          return live;
        },
        ...NO_GROUPS,
      },
      fetchData,
    );
    await fetcher(source, signal);
    live = new Set(["reference"]);
    await expect(fetcher(source, signal)).rejects.toThrow(`unknown widget ${UUID}`);
    expect(fetchData).toHaveBeenCalledTimes(1);
  });

  // v4: Rita's fetch resolves through sendParams on calendars chosen with her input_args, and a value the resolver
  // refuses refuses the whole fetch -- nothing reaches the backend.
  it("chooses calendars with input_args and refuses an unknown (MIC) before anything is sent", async () => {
    const dated = widget({ ...prices, params: [{ paramName: "symbol", type: "text" }, { paramName: "start_date", type: "date" }] });
    const request = vi.fn((c: DashboardCard, w: WidgetDef, b: BackendConfig, o: Record<string, string>) =>
      cardRequestSync(c, w, b, undefined, undefined, new Date(), o),
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const fetcher = makeWidgetDataFetcher({ cards, backends, findWidget: () => dated, keyMaintBackends: new Set(), request });
      await expect(fetcher({ ...source, input_args: { start_date: "T-1bd(XNYZ)" } }, signal)).rejects.toThrow(
        "start_date: Unknown calendar XNYZ",
      );
      expect(request).toHaveBeenCalledWith(cards[0], dated, backends[0], { start_date: "T-1bd(XNYZ)" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  // Ruling RW6: a legacy calendar no mounted card has loaded would resolve on weekdays -- a UK holiday sent as a
  // trading day. Rita's fetch refuses it as not loaded instead, and nothing is sent.
  it("refuses an override whose calendar the cache has not loaded, before anything is sent", async () => {
    const dated = widget({ ...prices, params: [{ paramName: "symbol", type: "text" }, { paramName: "start_date", type: "date" }] });
    const request = (c: DashboardCard, w: WidgetDef, b: BackendConfig, o: Record<string, string>) =>
      cardRequestSync(c, w, b, undefined, undefined, new Date("2026-08-31T12:00:00Z"), o);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const fetcher = makeWidgetDataFetcher({ cards, backends, findWidget: () => dated, keyMaintBackends: new Set(), request });
      await expect(fetcher({ ...source, input_args: { symbol: "VOD.L", start_date: "T-1bd" } }, signal)).rejects.toThrow(
        "XLON calendar not loaded",
      );
      await expect(fetcher({ ...source, input_args: { start_date: "T-1bd(XLON)" } }, signal)).rejects.toThrow(
        "XLON calendar not loaded",
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("fetches with card params overlaid by input_args and reports a clean ledger url", async () => {
    const fetchData = vi.fn(async () => [{ close: 1 }]);
    const fetcher = makeWidgetDataFetcher({ cards, backends, findWidget, keyMaintBackends: new Set(), ...NO_GROUPS }, fetchData);
    const result = await fetcher(source, signal);
    expect(fetchData).toHaveBeenCalledWith(backends[0], prices, { symbol: "MSFT" }, { fiscalYearEnd: {}, calendars: {} }, signal);
    expect(result).toEqual({ data: [{ close: 1 }], url: "http://x/historical?symbol=MSFT", params: { symbol: "MSFT" } });
  });

  // Back-port of dev da6f4bb (#91): input_args come from the model, whose
  // context can carry injected text; an undeclared key would reach the
  // backend as a query parameter the user never set.
  it("drops input_args keys the widget does not declare", async () => {
    const fetchData = vi.fn(async () => []);
    const fetcher = makeWidgetDataFetcher({ cards, backends, findWidget, keyMaintBackends: new Set(), ...NO_GROUPS }, fetchData);
    const result = await fetcher({ ...source, input_args: { symbol: "MSFT", api_key: "x", callback: "https://evil" } }, signal);
    expect(fetchData).toHaveBeenCalledWith(backends[0], prices, { symbol: "MSFT" }, { fiscalYearEnd: {}, calendars: {} }, signal);
    expect(result.url).toBe("http://x/historical?symbol=MSFT");
  });

  it("refuses unknown cards, foreign origins and keys widgets with one message", async () => {
    const fetchData = vi.fn(async () => []);
    const fetcher = makeWidgetDataFetcher({ cards, backends, findWidget, keyMaintBackends: new Set(), ...NO_GROUPS }, fetchData);
    await expect(fetcher({ ...source, widget_uuid: "nope" }, signal)).rejects.toThrow("unknown widget nope");
    await expect(fetcher({ ...source, origin: "other" }, signal)).rejects.toThrow(`unknown widget ${UUID}`);
    const keysFetcher = makeWidgetDataFetcher(
      { cards, backends, findWidget: () => widget({ id: "historical_prices", backendId: "reference", type: "keys" }), keyMaintBackends: new Set(), ...NO_GROUPS },
      fetchData,
    );
    await expect(keysFetcher(source, signal)).rejects.toThrow(`unknown widget ${UUID}`);
    expect(fetchData).not.toHaveBeenCalled();
  });
});

/** The result item's JSON of an execute_agent_tool reply, `[{ items: [..., { text }] }]` (last, after any typed error). */
function itemJson(msg: unknown): unknown {
  const data = (msg as { data: Array<{ items: Array<{ text: string }> }> }).data;
  return JSON.parse(data[0].items.at(-1)!.text);
}

/** The items' JSON of an execute_agent_tool reply. */
function itemsJson(msg: unknown): unknown[] {
  const data = (msg as { data: Array<{ items: Array<{ text: string }> }> }).data;
  return data[0].items.map((i) => JSON.parse(i.text));
}

// Dev 191610b01, carried at v6 (user ruling 2026-10-15): Rita reads the rows the card shows, fiscal labels corrected.
describe("makeWidgetDataFetcher on a statement widget", () => {
  beforeEach(() => { fetchFiscalYearEnd.mockReset(); __resetStatementYearEndsForTests(); });
  const income = widget({
    id: "income", backendId: "reference", endpoint: "/income",
    params: [
      { paramName: "symbol", label: "Symbol", value: "WMT" },
      { paramName: "period", label: "Period", options: [{ label: "annual", value: "annual" }, { label: "quarter", value: "quarter" }] },
    ],
  });
  const wmt = [card({ id: UUID, widgetId: "income", backendId: "reference", params: { symbol: "WMT", period: "quarter" } })];
  const src = { widget_uuid: UUID, origin: "reference", id: "income" };
  const raw = () => [{ period_ending: "2026-07-31", fiscal_period: "quarter", fiscal_year: 2026, revenue: 1 }];
  const make = (cs: DashboardCard[], fetchData: () => Promise<unknown>) =>
    makeWidgetDataFetcher({ cards: cs, backends, findWidget: () => income, keyMaintBackends: new Set(), ...NO_GROUPS }, fetchData);

  it("hands back the corrected rows, asking the year end once per symbol", async () => {
    fetchFiscalYearEnd.mockResolvedValue({ fiscalYearEnd: "January" });
    const fetcher = make(wmt, async () => raw());
    expect((await fetcher(src, signal)).data).toEqual([{ period_ending: "2026-07-31", fiscal_period: "FQ2", fiscal_year: "FY2027", revenue: 1 }]);
    await fetcher(src, signal);
    expect(fetchFiscalYearEnd).toHaveBeenCalledTimes(1);
    expect(fetchFiscalYearEnd).toHaveBeenCalledWith(backends[0], "WMT");
  });
  it("leaves the rows as reported when the year end is unknown", async () => {
    fetchFiscalYearEnd.mockResolvedValue(null);
    expect((await make(wmt, async () => raw())(src, signal)).data).toEqual(raw());
  });
  it("asks nothing for a statement widget with no symbol", async () => {
    const none = [card({ id: UUID, widgetId: "income", backendId: "reference", params: { symbol: "", period: "quarter" } })];
    expect((await make(none, async () => raw())(src, signal)).data).toEqual(raw());
    expect(fetchFiscalYearEnd).not.toHaveBeenCalled();
  });
  // v5.0.0's fiscal fixes (2c761ba, 2cd529e) reach Rita through the same relabel.
  it("relabels yfinance long rows from their date column", async () => {
    fetchFiscalYearEnd.mockResolvedValue({ fiscalYearEnd: "January" });
    const long = [{ symbol: "WMT", date: "2026-07-31", line_item: "Revenue", value: 1 }];
    expect((await make(wmt, async () => long)(src, signal)).data).toEqual([{ ...long[0], fiscal_period: "FQ2", fiscal_year: "FY2027" }]);
  });
  it("keeps every company of a multi-symbol fetch, each on its own year end", async () => {
    fetchFiscalYearEnd.mockImplementation(async (_b: unknown, s: string) => ({ fiscalYearEnd: s === "WMT" ? "January" : "December" }));
    const both = [card({ id: UUID, widgetId: "income", backendId: "reference", params: { symbol: "WMT,MSFT", period: "quarter" } })];
    const rows = [{ symbol: "WMT", date: "2026-07-31", line_item: "Revenue", value: 1 }, { symbol: "MSFT", date: "2026-06-30", line_item: "Revenue", value: 2 }];
    expect((await make(both, async () => rows)(src, signal)).data).toEqual([
      { ...rows[0], fiscal_period: "FQ2", fiscal_year: "FY2027" },
      { ...rows[1], fiscal_period: "Q2", fiscal_year: "2026" },
    ]);
  });
});

describe("executeFunction", () => {
  const payload = {
    function: "get_widget_data",
    input_arguments: { data_sources: [{ widget_uuid: UUID, origin: "reference", id: "historical_prices", input_args: {} }] },
    extra_state: { copilot_function_call_arguments: { widget_queries: [] } },
  };

  it("returns a tool message with the widget data and records a widget_data call", async () => {
    const calls: AgentCall[] = [];
    const fetchWidget: WidgetFetcher = async () => ({ data: [{ a: 1 }, { a: 2 }], url: "http://x/historical", params: {} });
    const msg = await executeFunction(payload, { fetchWidget, runAgentTool: async () => null, onCall: (c) => calls.push(c) }, signal);
    expect(msg.role).toBe("tool");
    const tool = msg as { function: unknown; input_arguments: unknown; extra_state: unknown; data: unknown };
    expect(tool.function).toBe("get_widget_data");
    expect(tool.input_arguments).toBe(payload.input_arguments);
    expect(tool.extra_state).toBe(payload.extra_state);
    expect(tool.data).toEqual([
      {
        items: [
          { content: JSON.stringify([{ a: 1 }, { a: 2 }]), data_format: { data_type: "object", parse_as: "table" }, citable: true },
        ],
      },
    ]);
    expect(calls).toEqual([expect.objectContaining({ kind: "widget_data", url: "http://x/historical", ok: true, rows: 2 })]);
    // Contract: a tool message's fields sit at the top level, beside `role` —
    // that is the shape agent-rita's ToolMessage type declares and reads; a
    // `content` wrapper (the pre-fix shape) is silently ignored by Rita.
    expect(msg).not.toHaveProperty("content");
  });

  it("turns a failed fetch into fetch_failed and a failed ledger entry", async () => {
    const calls: AgentCall[] = [];
    const fetchWidget: WidgetFetcher = async () => {
      throw new Error("unknown widget " + UUID);
    };
    const msg = await executeFunction(payload, { fetchWidget, runAgentTool: async () => null, onCall: (c) => calls.push(c) }, signal);
    expect((msg as { data: unknown[] }).data).toEqual([{ error_type: "fetch_failed", message: `unknown widget ${UUID}` }]);
    expect(calls[0]).toMatchObject({ kind: "widget_data", ok: false, error: `unknown widget ${UUID}`, rows: 0 });
  });

  it("routes execute_agent_tool through runAgentTool, reading the input from `parameters` as agent-rita sends it", async () => {
    const runTool = vi.fn(async () => ({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }));
    const fetchWidget: WidgetFetcher = async () => ({ data: null, url: "", params: {} });
    const msg = await executeFunction(
      { function: "execute_agent_tool", input_arguments: { server_id: "s1", tool_name: "search", parameters: { q: "x" } } },
      { fetchWidget, runAgentTool: runTool },
      signal,
    );
    expect(runTool).toHaveBeenCalledWith("s1", "search", { q: "x" }, signal);
    // One entry, whose items are the result's content[] — the list Rita's
    // processMcpResult iterates (for entry of data; for item of entry.items).
    expect((msg as { data: unknown }).data).toEqual([{ items: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }]);
  });

  it("wraps a local tool's object, array and null results as one JSON text item (#322)", async () => {
    const fetchWidget: WidgetFetcher = async () => ({ data: null, url: "", params: {} });
    for (const result of [{ total: 1, widgets: [{ id: "w" }] }, [1, 2], {}]) {
      const msg = await executeFunction(
        { function: "execute_agent_tool", input_arguments: { server_id: "bdobb", tool_name: "search_widgets", parameters: {} } },
        { fetchWidget, runAgentTool: async () => result },
        signal,
      );
      expect((msg as { data: unknown }).data).toEqual([{ items: [{ type: "text", text: JSON.stringify(result) }] }]);
    }
  });

  it("still reads the older `input` and `args` keys", async () => {
    const runTool = vi.fn(async () => ({ content: [] }));
    const fetchWidget: WidgetFetcher = async () => ({ data: null, url: "", params: {} });
    await executeFunction({ function: "execute_agent_tool", input_arguments: { server_id: "s1", tool_name: "t", input: { q: 1 } } }, { fetchWidget, runAgentTool: runTool }, signal);
    await executeFunction({ function: "execute_agent_tool", input_arguments: { server_id: "s1", tool_name: "t", args: { q: 2 } } }, { fetchWidget, runAgentTool: runTool }, signal);
    expect(runTool).toHaveBeenNthCalledWith(1, "s1", "t", { q: 1 }, signal);
    expect(runTool).toHaveBeenNthCalledWith(2, "s1", "t", { q: 2 }, signal);
  });

  it("reports unsupported tools and unknown functions", async () => {
    const fetchWidget: WidgetFetcher = async () => ({ data: null, url: "", params: {} });
    const deps = { fetchWidget, runAgentTool: async () => null };
    const a = await executeFunction({ function: "execute_agent_tool", input_arguments: { server_id: "zz", tool: "t" } }, deps, signal);
    // An unsupported tool is a not-completed call (bdobb#43): Rita's typed error leads.
    expect((a as { data: unknown }).data).toEqual([
      {
        items: [
          { type: "text", text: JSON.stringify({ $rita_kind: "error", error: { code: "unsupported", message: "unsupported" } }) },
          { type: "text", text: JSON.stringify({ error_type: "unsupported" }) },
        ],
      },
    ]);
    const b = await executeFunction({ function: "mystery", input_arguments: {} }, deps, signal);
    expect((b as { data: unknown }).data).toEqual({ error_type: "unsupported" });
  });

  it("reports a throwing tool as tool_failed, after Rita's typed error item", async () => {
    const fetchWidget: WidgetFetcher = async () => ({ data: null, url: "", params: {} });
    const runTool = async () => {
      throw new Error("boom");
    };
    const msg = await executeFunction(
      { function: "execute_agent_tool", input_arguments: { server_id: "s1", tool_name: "t", input: {} } },
      { fetchWidget, runAgentTool: runTool },
      signal,
    );
    expect(itemsJson(msg)).toEqual([
      { $rita_kind: "error", error: { code: "transport", message: "boom" } },
      { error_type: "tool_failed", code: "transport", server: "s1", tool: "t", message: "boom" },
    ]);
  });

  it("gives the agent a coded tool_failed result and reports it once", async () => {
    const fetchWidget: WidgetFetcher = async () => ({ data: null, url: "", params: {} });
    const onToolError = vi.fn();
    const msg = await executeFunction(
      { function: "execute_agent_tool", input_arguments: { server_id: "s1", tool_name: "quote", input: {} } },
      { fetchWidget, runAgentTool: async () => { throw new McpError("timeout", "MCP tools/call timed out after 10000 ms"); }, onToolError },
      signal,
    );
    expect(itemJson(msg)).toEqual({
      error_type: "tool_failed",
      code: "timeout",
      server: "s1",
      tool: "quote",
      message: "MCP tools/call timed out after 10000 ms",
    });
    expect(onToolError).toHaveBeenCalledWith({ server: "s1", tool: "quote", code: "timeout", message: "MCP tools/call timed out after 10000 ms" });
  });

  it("classifies an uncoded failure as transport", async () => {
    const fetchWidget: WidgetFetcher = async () => ({ data: null, url: "", params: {} });
    const msg = await executeFunction(
      { function: "execute_agent_tool", input_arguments: { server_id: "s1", tool_name: "q" } },
      { fetchWidget, runAgentTool: async () => { throw new TypeError("Failed to fetch"); } },
      signal,
    );
    expect((itemJson(msg) as { code: string }).code).toBe("transport");
  });

  // bdobb#43 (and #39's class): every not-completed shape is classified once.
  // Client: user_declined (Deny), unsupported (no route), tool_failed (thrown),
  // fetch_failed; any status refused / unavailable / error; an { error }; and
  // agent-rita's own typed error, a `$rita_kind: "error"` content item.
  describe("classifies every not-completed tool result (bdobb#43)", () => {
    const fetchWidget: WidgetFetcher = async () => ({ data: null, url: "", params: {} });
    const call = { function: "execute_agent_tool", input_arguments: { server_id: "s1", tool_name: "q" } };
    const ritaError = { content: [{ type: "text", text: JSON.stringify({ $rita_kind: "error", error: { code: "RATE_LIMITED", message: "slow down" } }) }] };
    it.each([
      ["user_declined", { error_type: "user_declined", message: "The user declined to run q on S1." }, "user_declined", "The user declined to run q on S1."],
      ["unsupported", null, "unsupported", "unsupported"],
      ["fetch_failed", { error_type: "fetch_failed", message: "HTTP 500" }, "fetch_failed", "HTTP 500"],
      ["status refused", { status: "refused", reason: "stale", message: "revision moved" }, "stale", "revision moved"],
      ["status unavailable", { status: "unavailable", message: "no table" }, "unavailable", "no table"],
      ["status error", { status: "error", message: "boom" }, "error", "boom"],
      ["{ error }", { error: { code: "TOOL_DISABLED", message: "off" } }, "TOOL_DISABLED", "off"],
      ["agent-rita $rita_kind error", ritaError, "RATE_LIMITED", "slow down"],
    ])("%s counts as one failed call", async (_name, result, code, message) => {
      const onToolError = vi.fn();
      await executeFunction(call, { fetchWidget, runAgentTool: async () => result, onToolError }, signal);
      expect(onToolError).toHaveBeenCalledTimes(1);
      expect(onToolError).toHaveBeenCalledWith(expect.objectContaining({ server: "s1", tool: "q", code, message }));
    });
    it("a thrown tool_failed counts once, not twice", async () => {
      const onToolError = vi.fn();
      await executeFunction(call, { fetchWidget, runAgentTool: async () => { throw new McpError("http_500", "boom"); }, onToolError }, signal);
      expect(onToolError).toHaveBeenCalledTimes(1);
    });
    it.each([
      ["MCP content", { content: [{ type: "text", text: "fine" }] }],
      ["a local tool's object", { updated: true }],
      ["status ok", { status: "ok" }],
    ])("%s is a completed call", async (_name, result) => {
      const onToolError = vi.fn();
      await executeFunction(call, { fetchWidget, runAgentTool: async () => result, onToolError }, signal);
      expect(onToolError).not.toHaveBeenCalled();
    });
    it("Stop mid-call is reported as stopped, not as a failure, and ends the turn", async () => {
      const stop = new AbortController();
      const onToolError = vi.fn();
      const onToolStopped = vi.fn();
      const run = executeFunction(
        call,
        {
          fetchWidget,
          runAgentTool: (_s, _t, _a, sig) => new Promise((_resolve, reject) => sig.addEventListener("abort", () => reject(new DOMException("BodyStreamBuffer was aborted", "AbortError")))),
          onToolError,
          onToolStopped,
        },
        stop.signal,
      );
      stop.abort();
      await expect(run).rejects.toMatchObject({ name: "AbortError" });
      expect(onToolError).not.toHaveBeenCalled();
      expect(onToolStopped).toHaveBeenCalledWith(expect.objectContaining({ server: "s1", tool: "q" }));
    });
  });

  it("passes a 200 carrying {error} through to the agent, and reports it as a failed call", async () => {
    const fetchWidget: WidgetFetcher = async () => ({ data: null, url: "", params: {} });
    const onToolError = vi.fn();
    const msg = await executeFunction(
      { function: "execute_agent_tool", input_arguments: { server_id: "s1", tool_name: "q" } },
      { fetchWidget, runAgentTool: async () => ({ error: "params refused", problems: ['unknown param "x"'] }), onToolError },
      signal,
    );
    // Rita's typed error first (her status then reads "returned an error"),
    // the result itself after it, untouched.
    expect(itemsJson(msg)).toEqual([
      { $rita_kind: "error", error: { code: "refused", message: 'params refused: unknown param "x"' } },
      { error: "params refused", problems: ['unknown param "x"'] },
    ]);
    expect(onToolError).toHaveBeenCalledWith({ server: "s1", tool: "q", code: "refused", message: 'params refused: unknown param "x"' });
  });

  it("reports a local tool's coded refusal with its code, and a success not at all", async () => {
    const fetchWidget: WidgetFetcher = async () => ({ data: null, url: "", params: {} });
    const onToolError = vi.fn();
    const refusal = { error: { code: "PARAMS_NOT_NESTED", message: "params must be nested", retry_with: {} } };
    const refusedMsg = await executeFunction(
      { function: "execute_agent_tool", input_arguments: { server_id: "bdobb-local", tool_name: "set_widget_params", parameters: {} } },
      { fetchWidget, runAgentTool: async () => refusal, onToolError },
      signal,
    );
    expect(itemsJson(refusedMsg)).toEqual([{ $rita_kind: "error", error: { code: "PARAMS_NOT_NESTED", message: "params must be nested" } }, refusal]);
    const okMsg = await executeFunction(
      { function: "execute_agent_tool", input_arguments: { server_id: "bdobb-local", tool_name: "set_widget_params", parameters: {} } },
      { fetchWidget, runAgentTool: async () => ({ updated: true }), onToolError },
      signal,
    );
    expect(itemsJson(okMsg)).toEqual([{ updated: true }]);
    expect(onToolError).toHaveBeenCalledTimes(1);
    expect(onToolError).toHaveBeenCalledWith({ server: "bdobb-local", tool: "set_widget_params", code: "PARAMS_NOT_NESTED", message: "params must be nested" });
  });

  // Verbatim tool results from the live v6 565d3c6 Rita run (V6-008,
  // transcripts/v6-008-r1.jsonl). They went to Rita untyped, so she narrated
  // "arrange_table completed" and the trail read "22 steps · 0 errors" (#39).
  it("counts the table tools' {status: refused | unavailable} as failed calls, and previewed as a success (#39)", async () => {
    const fetchWidget: WidgetFetcher = async () => ({ data: null, url: "", params: {} });
    const onToolError = vi.fn();
    const run = (tool: string, result: unknown) =>
      executeFunction(
        { function: "execute_agent_tool", input_arguments: { server_id: "bdobb-local", tool_name: tool, parameters: { card_id: "c-prices" } } },
        { fetchWidget, runAgentTool: async () => result, onToolError },
        signal,
      );
    const refused = JSON.parse(
      '{"status":"refused","code":"invalid-arrangement","message":"the arrangement is not a valid table-model/1 request; nothing was changed","errors":[{"code":"invalid-field","operation_index":0,"path":"operations[0].name","message":"name is required"}]}',
    );
    const unavailable = JSON.parse('{"status":"unavailable","reason":"unknown","message":"unknown card 00000000-dead-beef-0000-000000000000","alternatives":[]}');
    const refusedMsg = await run("arrange_table", refused);
    expect(itemsJson(refusedMsg)).toEqual([
      { $rita_kind: "error", error: { code: "invalid-arrangement", message: "the arrangement is not a valid table-model/1 request; nothing was changed" } },
      refused,
    ]);
    const unavailableMsg = await run("describe_table", unavailable);
    expect(itemsJson(unavailableMsg)[0]).toEqual({ $rita_kind: "error", error: { code: "unknown", message: "unknown card 00000000-dead-beef-0000-000000000000" } });
    const previewed = { status: "previewed", committed: false, card_id: "c-prices", revision: "tm1-w4l9cb", preview: { columns: [], rows: [], total: 0, truncated: false, completeness: null }, warnings: [] };
    expect(itemsJson(await run("arrange_table", previewed))).toEqual([previewed]);
    expect(onToolError.mock.calls.map(([e]) => [e.tool, e.code])).toEqual([
      ["arrange_table", "invalid-arrangement"],
      ["describe_table", "unknown"],
    ]);
  });
});

describe("runAgentTool", () => {
  const servers = [
    { id: "s1", url: "https://mcp.example/mcp", enabled: true },
    { id: "off", url: "https://mcp.example/off", enabled: false },
  ];
  // chatStore's caller, without the auth wrapper.
  const viaMcp = async (_s: unknown, url: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal) =>
    (await import("./mcp")).callMcpTool(url, tool, args, undefined, undefined, signal);

  it("routes bdobb-local to executeLocalTool", async () => {
    expect(await runAgentTool("bdobb-local", "add_widget", { widget_id: "w" }, servers, [], viaMcp)).toEqual({ ran: "add_widget" });
  });

  it("routes an enabled MCP server to callMcpTool", async () => {
    const { callMcpTool } = await import("./mcp");
    expect(await runAgentTool("s1", "search", { q: 1 }, servers, [], viaMcp)).toEqual({ ok: true });
    expect(callMcpTool).toHaveBeenCalledWith("https://mcp.example/mcp", "search", { q: 1 }, undefined, undefined, undefined);
  });

  it("throws unknown_server for disabled or unmatched servers", async () => {
    await expect(runAgentTool("off", "t", {}, servers, [], viaMcp)).rejects.toMatchObject({ code: "unknown_server" });
    await expect(runAgentTool("nope", "t", {}, servers, [], viaMcp)).rejects.toMatchObject({ code: "unknown_server" });
  });

  it("refuses an unmatched MCP server id with unknown_server", async () => {
    await expect(runAgentTool("nope", "t", {}, [], [], viaMcp)).rejects.toMatchObject({ code: "unknown_server" });
  });

  it("routes a widget-derived server id (its URL) only when that URL is on the active dashboard", async () => {
    await runAgentTool("http://m.example/mcp/", "t", {}, [], ["http://m.example/mcp"], viaMcp);
    expect(callMcpTool).toHaveBeenLastCalledWith("http://m.example/mcp", "t", {}, undefined, undefined, undefined);
    vi.mocked(callMcpTool).mockClear();
    await expect(runAgentTool("http://evil.example/mcp", "t", {}, [], ["http://m.example/mcp"], viaMcp)).rejects.toMatchObject({ code: "unknown_server" });
    expect(callMcpTool).not.toHaveBeenCalled();
  });

  it("hands the call to the injected caller with the Settings entry", async () => {
    const call = vi.fn(async () => ({ ok: 1 }));
    const s = { id: "s1", url: "https://m.example/mcp", enabled: true };
    expect(await runAgentTool("s1", "t", { a: 1 }, [s], [], call)).toEqual({ ok: 1 });
    expect(call).toHaveBeenCalledWith(s, "https://m.example/mcp", "t", { a: 1 }, undefined);
  });

  // Back-port of dev b1e6612 (#91): an external server can place an order or
  // write a note, and injected text in widget data can talk the model into
  // such a call, so each one waits for the user. The local tools do not ask.
  describe("asks before an external call", () => {
    const s = { id: "s1", url: "https://m.example/mcp", enabled: true, name: "Mine" };
    it("runs a local tool without asking", async () => {
      const confirm = vi.fn(async () => false);
      expect(await runAgentTool("bdobb-local", "add_widget", { widget_id: "w" }, servers, [], viaMcp, { confirm })).toEqual({ ran: "add_widget" });
      expect(confirm).not.toHaveBeenCalled();
    });
    it("waits for approval, then calls the server", async () => {
      const call = vi.fn(async () => ({ ok: 1 }));
      let approve!: (run: boolean) => void;
      const confirm = vi.fn(() => new Promise<boolean>((resolve) => (approve = resolve)));
      const pending = runAgentTool("s1", "t", { a: 1 }, [s], [], call, { confirm });
      await vi.waitFor(() => expect(confirm).toHaveBeenCalledWith({ label: "Mine", url: "https://m.example/mcp", tool: "t", args: { a: 1 } }));
      expect(call).not.toHaveBeenCalled();
      approve(true);
      expect(await pending).toEqual({ ok: 1 });
      expect(call).toHaveBeenCalledTimes(1);
    });
    it("asks for a widget-derived server too, named by its host", async () => {
      const call = vi.fn(async () => ({ ok: 1 }));
      const confirm = vi.fn(async () => true);
      await runAgentTool("http://m.example/mcp/", "t", {}, [], ["http://m.example/mcp"], call, { confirm });
      expect(confirm).toHaveBeenCalledWith({ label: "m.example", url: "http://m.example/mcp", tool: "t", args: {} });
    });
    it("a denied call returns a declined result and never reaches the server", async () => {
      const call = vi.fn(async () => ({ ok: 1 }));
      const result = await runAgentTool("s1", "t", { a: 1 }, [s], [], call, { confirm: async () => false });
      expect(result).toEqual({ error_type: "user_declined", message: "The user declined to run t on Mine." });
      expect(call).not.toHaveBeenCalled();
    });
    it("refuses a turned-off tool before asking", async () => {
      const confirm = vi.fn(async () => true);
      const result = await runAgentTool("s1", "t", {}, [s], [], vi.fn(), { confirm, disabledTools: { "https://m.example/mcp": ["t"] } });
      expect(result).toMatchObject({ error: { code: "TOOL_DISABLED" } });
      expect(confirm).not.toHaveBeenCalled();
    });
  });

  // Back-port of dev 5c05aa5: the turn's signal reaches the MCP call itself.
  it("hands the turn's signal to the call, so Stop reaches a call already running", async () => {
    const call = vi.fn(async () => ({ ok: 1 }));
    const s = { id: "s1", url: "https://m.example/mcp", enabled: true };
    const signal = new AbortController().signal;
    await runAgentTool("s1", "t", { a: 1 }, [s], [], call, { signal });
    expect(call).toHaveBeenCalledWith(s, "https://m.example/mcp", "t", { a: 1 }, signal);
  });
});

describe("proxied MCP tool names (user-approved scope beyond the donor)", () => {
  const url = "https://mcp.example/mcp";
  const servers = [{ id: "s1", url, enabled: true }];
  const off = (...names: string[]) => ({ disabledTools: { [url]: names } });

  it("refuses a disabled call_tool target before anything is sent", async () => {
    const call = vi.fn(async () => ({ ok: 1 }));
    const r = await runAgentTool("s1", "call_tool", { name: "equity_price_historical" }, servers, [], call, off("equity_price_historical"));
    expect(r).toEqual({ error: { code: "TOOL_DISABLED", message: expect.stringContaining("equity_price_historical") } });
    expect((r as { error: { message: string } }).error.message).toMatch(/not sent/);
    expect(call).not.toHaveBeenCalled();
  });

  it("refuses a whole pipeline when one of three steps is disabled", async () => {
    const call = vi.fn(async () => ({ ok: 1 }));
    const args = { steps: [{ tool: "a" }, { tool: "b" }, { tool: "c" }] };
    const r = await runAgentTool("s1", "run_pipeline", args, servers, [], call, off("b"));
    expect(r).toMatchObject({ error: { code: "TOOL_DISABLED", message: expect.stringContaining("b") } });
    expect(call).not.toHaveBeenCalled();
  });

  it("refuses every call_tool call when call_tool itself is disabled", async () => {
    const call = vi.fn(async () => ({ ok: 1 }));
    const r = await runAgentTool("s1", "call_tool", { name: "x" }, servers, [], call, off("call_tool"));
    expect(r).toMatchObject({ error: { code: "TOOL_DISABLED" } });
    expect(call).not.toHaveBeenCalled();
  });

  it("refuses a malformed proxy call and forwards nothing", async () => {
    const call = vi.fn(async () => ({ ok: 1 }));
    const r = await runAgentTool("s1", "call_tool", { arguments: {} }, servers, [], call, off());
    expect(r).toEqual({ error: { code: "INVALID_PROXY_CALL", message: expect.stringContaining("name") } });
    expect(call).not.toHaveBeenCalled();
  });

  it("forwards an enabled proxied call and reports the effective names once", async () => {
    const call = vi.fn(async () => ({ ok: 1 }));
    const onEffective = vi.fn();
    const r = await runAgentTool("s1", "call_tool", { name: "ok_tool" }, servers, [], call, { ...off("other"), onEffective });
    expect(r).toEqual({ ok: 1 });
    expect(onEffective).toHaveBeenCalledTimes(1);
    expect(onEffective).toHaveBeenCalledWith(url, ["ok_tool"]);
  });

  it("does not report names for a call that answered with an error or isError result", async () => {
    const onEffective = vi.fn();
    for (const answer of [{ error: { code: "X", message: "no" } }, { isError: true, content: [] }]) {
      await runAgentTool("s1", "call_tool", { name: "typo_tool" }, servers, [], vi.fn(async () => answer), { ...off(), onEffective });
    }
    expect(onEffective).not.toHaveBeenCalled();
  });

  it("does not report names for a refused call", async () => {
    const onEffective = vi.fn();
    await runAgentTool("s1", "call_tool", { name: "x" }, servers, [], vi.fn(), { ...off("x"), onEffective });
    expect(onEffective).not.toHaveBeenCalled();
  });

  it("counts a malformed proxy call once and leads with the typed error item", async () => {
    const fetchWidget: WidgetFetcher = async () => ({ data: null, url: "", params: {} });
    const call = vi.fn();
    const onToolError = vi.fn();
    const msg = await executeFunction(
      { function: "execute_agent_tool", input_arguments: { server_id: "s1", tool_name: "call_tool", parameters: {} } },
      { fetchWidget, runAgentTool: (id, tool, args) => runAgentTool(id, tool, args, servers, [], call, off()), onToolError },
      signal,
    );
    expect(itemsJson(msg)[0]).toMatchObject({ $rita_kind: "error", error: { code: "INVALID_PROXY_CALL" } });
    expect(onToolError).toHaveBeenCalledTimes(1);
    expect(onToolError).toHaveBeenCalledWith(expect.objectContaining({ code: "INVALID_PROXY_CALL", tool: "call_tool", input: {} }));
    expect(call).not.toHaveBeenCalled();
  });
});

describe("executeFunction get_skill_content", () => {
  const deps = {
    fetchWidget: (async () => ({ data: [], url: "", params: {} })) as WidgetFetcher,
    runAgentTool: async () => null,
    readSkill: (slug: string) =>
      slug === "openbb-html-table"
        ? { slug, description: "Tables.", content: "# Table rules", enabled: true, updated: "", extra: {} }
        : undefined,
  };

  it("answers with the skill body in Rita's success shape", async () => {
    const msg = await executeFunction(
      { function: "get_skill_content", input_arguments: { slug: "openbb-html-table", reason: "tables" }, extra_state: { k: 1 } },
      deps,
      signal,
    );
    expect(msg).toEqual({
      role: "tool",
      function: "get_skill_content",
      input_arguments: { slug: "openbb-html-table", reason: "tables" },
      data: [{ status: "success", data: { skill: { slug: "openbb-html-table", description: "Tables.", contentMarkdown: "# Table rules" } } }],
      extra_state: { k: 1 },
    });
  });

  it("answers an unknown or disabled slug with Rita's error shape", async () => {
    const msg = await executeFunction({ function: "get_skill_content", input_arguments: { slug: "nope" } }, deps, signal);
    expect((msg as { data: unknown }).data).toEqual([{ status: "error", message: 'Skill "nope" not found' }]);
  });

  it("is an error, not unsupported, when no reader was wired", async () => {
    const msg = await executeFunction({ function: "get_skill_content", input_arguments: { slug: "x" } }, { ...deps, readSkill: undefined }, signal);
    expect((msg as { data: unknown }).data).toEqual([{ status: "error", message: 'Skill "x" not found' }]);
  });
});

// The rule isAgentOffLimits enforces: every widget on a backend that serves a
// key-maint widget ("km" here -- the panel, the table, the markdown summary on
// the same /keys, and anything key-maint adds later), and every settings
// widget wherever it is served. A normal backend's widgets stay visible.
const keyMaintWidgets = [
  widget({ id: "provider_api_keys_panel", name: "Provider API Keys (panel)", backendId: "km", type: "keys", endpoint: "keys", params: [{ paramName: "run_tests" }] }),
  widget({ id: "provider_api_keys", name: "Provider API Keys", backendId: "km", type: "table", endpoint: "keys", params: [{ paramName: "run_tests" }] }),
  widget({ id: "provider_api_keys_summary", name: "Provider API Keys (summary)", backendId: "km", type: "markdown", endpoint: "keys", params: [{ paramName: "run_tests" }] }),
  widget({ id: "key_rotation_report", name: "Key rotation report", backendId: "km", type: "chart", endpoint: "rotation", params: [{ paramName: "run_tests" }] }),
];
const offLimits = [
  ...keyMaintWidgets,
  widget({ id: "svc_settings", name: "Service settings", backendId: "svc", type: "settings", endpoint: "settings", params: [{ paramName: "run_tests" }] }),
];
const visible = widget({ id: "historical_prices", name: "Historical Prices", backendId: "reference", params: [{ paramName: "symbol" }] });
const registryWidgets = [...offLimits, visible];

describe("the agent never reaches a key-maint backend's widgets or any settings widget", () => {
  const keyMaintBackends = keyMaintBackendIds(registryWidgets);
  const allBackends = [...backends, backend({ id: "km", name: "key-maint", baseUrl: "http://km/" }), backend({ id: "svc", name: "svc", baseUrl: "http://svc/" })];

  for (const def of offLimits) {
    it(`buildWidgetRefs never describes, and get_widget_data never fetches, ${def.id} (${def.type})`, async () => {
      const find = () => def;
      const c = card({ id: UUID, widgetId: def.id, backendId: def.backendId });
      expect(buildWidgetRefs([c], find, () => "x", keyMaintBackends)).toEqual([]);
      const fetchData = vi.fn(async () => []);
      const fetcher = makeWidgetDataFetcher({ cards: [c], backends: allBackends, findWidget: find, keyMaintBackends, ...NO_GROUPS }, fetchData);
      await expect(fetcher({ widget_uuid: UUID, origin: def.backendId, id: def.id }, signal)).rejects.toThrow(`unknown widget ${UUID}`);
      expect(fetchData).not.toHaveBeenCalled();
    });
  }

  it("a normal backend's widget is still described and fetched", async () => {
    const c = card({ id: UUID, widgetId: visible.id, backendId: "reference" });
    expect(buildWidgetRefs([c], () => visible, () => "Reference", keyMaintBackends)).toHaveLength(1);
    const fetchData = vi.fn(async () => []);
    const fetcher = makeWidgetDataFetcher({ cards: [c], backends: allBackends, findWidget: () => visible, keyMaintBackends, ...NO_GROUPS }, fetchData);
    await fetcher({ widget_uuid: UUID, origin: "reference", id: visible.id }, signal);
    expect(fetchData).toHaveBeenCalledTimes(1);
  });
});

describe("a linked table built on an off-limits card is off limits too (C1)", () => {
  const keysTable = keyMaintWidgets[1];
  const linked = widget({ id: "linked_table", name: "Linked table", backendId: "builtin", type: "linked_table", endpoint: "", params: [] });
  const defs = [...registryWidgets, linked];
  const find = (b: string, w: string) => defs.find((d) => d.backendId === b && d.id === w);
  const keyMaintBackends = keyMaintBackendIds(defs);
  const allBackends = [...backends, backend({ id: "km", name: "key-maint", baseUrl: "http://km/" }), backend({ id: "builtin", name: "builtin", baseUrl: "http://builtin/" })];
  const src = card({ id: "keys-card", widgetId: keysTable.id, backendId: "km" });
  const child = card({ id: UUID, widgetId: "linked_table", backendId: "builtin", linkedSource: { kind: "widget", sourceWidgetId: "keys-card" } });
  const grandchild = card({ id: "gc", widgetId: "linked_table", backendId: "builtin", linkedSource: { kind: "widget", sourceWidgetId: UUID } });

  it("buildWidgetRefs leaves out the linked table and the linked table of a linked table", () => {
    expect(buildWidgetRefs([src, child, grandchild], find, () => "x", keyMaintBackends)).toEqual([]);
  });

  it("get_widget_data refuses the linked table before fetching", async () => {
    const fetchData = vi.fn(async () => []);
    const fetcher = makeWidgetDataFetcher({ cards: [src, child], backends: allBackends, findWidget: find, keyMaintBackends, ...NO_GROUPS }, fetchData);
    await expect(fetcher({ widget_uuid: UUID, origin: "builtin", id: "linked_table" }, signal)).rejects.toThrow(`unknown widget ${UUID}`);
    expect(fetchData).not.toHaveBeenCalled();
  });

  it("a linked table on an ordinary card is still described, and a source cycle ends", () => {
    const prices = card({ id: "p", widgetId: visible.id, backendId: "reference" });
    const ok = card({ id: UUID, widgetId: "linked_table", backendId: "builtin", linkedSource: { kind: "widget", sourceWidgetId: "p" } });
    expect(buildWidgetRefs([prices, ok], find, () => "x", keyMaintBackends)).toHaveLength(2);
    const a = card({ id: "a", widgetId: "linked_table", backendId: "builtin", linkedSource: { kind: "widget", sourceWidgetId: "b" } });
    const b = card({ id: "b", widgetId: "linked_table", backendId: "builtin", linkedSource: { kind: "widget", sourceWidgetId: "a" } });
    expect(buildWidgetRefs([a, b], find, () => "x", keyMaintBackends)).toHaveLength(2);
  });
});

describe("get_widget_data sends the card's effective inputs (adaptation 2)", () => {
  it("uses the group's value, not the card's stale own param", async () => {
    const widget = { id: "q", backendId: "be", name: "Quote", description: "", type: "table", endpoint: "/q", category: "", subCategory: "", source: [], gridData: { w: 1, h: 1 }, params: [{ paramName: "symbol", label: "Symbol", type: "text", value: "AAPL" }] } as unknown as WidgetDef;
    const card = { id: "c1", backendId: "be", widgetId: "q", params: { symbol: "AAPL" }, bindings: [{ paramName: "symbol", groupId: "g1" }], layout: { x: 0, y: 0, w: 1, h: 1 } } as unknown as DashboardCard;
    const seen: Record<string, string>[] = [];
    const fetch = makeWidgetDataFetcher(
      { cards: [card], backends: [{ id: "be", name: "B", baseUrl: "http://127.0.0.1:1" } as BackendConfig], findWidget: () => widget, keyMaintBackends: new Set(),
        request: (c, w, b) => cardRequestSync(c, w, b, { groups: [{ id: "g1", name: "G", paramName: "symbol", groupType: "symbol", value: "MSFT" }] }) },
      async (_b, _w, params) => { seen.push(params); return []; },
    );
    await fetch({ widget_uuid: "c1", origin: "be" }, new AbortController().signal);
    expect(seen[0].symbol).toBe("MSFT");
  });

  it("relabels a grouped fiscal value by fiscalYearEnd and passes the map as the 4th argument", async () => {
    const widget = { id: "q", backendId: "be", name: "Q", description: "", type: "table", endpoint: "/q", category: "", subCategory: "", source: [], gridData: { w: 1, h: 1 }, params: [{ paramName: "quarter", label: "Quarter", type: "quarter", value: "2025-Q1" }] } as unknown as WidgetDef;
    const card = { id: "c1", backendId: "be", widgetId: "q", params: { quarter: "2025-Q1" }, bindings: [{ paramName: "quarter", groupId: "g1" }], layout: { x: 0, y: 0, w: 1, h: 1 } } as unknown as DashboardCard;
    const seen: { params: Record<string, string>; ctx: unknown }[] = [];
    const fetch = makeWidgetDataFetcher(
      { cards: [card], backends: [{ id: "be", name: "B", baseUrl: "http://127.0.0.1:1" } as BackendConfig], findWidget: () => widget, keyMaintBackends: new Set(),
        request: (c, w, b) => cardRequestSync({ ...c, fiscalYearEnd: 9 }, w, b, { groups: [{ id: "g1", name: "G", paramName: "quarter", groupType: "quarter", value: "2025-Q1" }] }) },
      async (_b, _w, params, ctx) => { seen.push({ params, ctx }); return []; },
    );
    await fetch({ widget_uuid: "c1", origin: "be" }, new AbortController().signal);
    expect(seen[0].params.quarter).toBe(relabel("2025-Q1", 12, 9));
    expect(seen[0].params.quarter).not.toBe("2025-Q1");
    expect(seen[0].ctx).toMatchObject({ fiscalYearEnd: { quarter: 9 } });
  });
});

describe("get_widget_data resolves dates on the card's trading calendar (bdobb-lib I2)", () => {
  it("sends T-1bd with the calendars, so the day after Labor Day 2026 reads Friday, not the holiday", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-08T15:00:00Z"));
    try {
      const eod = widget({ id: "eod", backendId: "reference", endpoint: "/eod", params: [{ paramName: "date", type: "date" }] });
      const c = card({ id: UUID, widgetId: "eod", backendId: "reference", params: { date: "T-1bd" } });
      const sent: string[] = [];
      const fetcher = makeWidgetDataFetcher({ cards: [c], backends, findWidget: () => eod, keyMaintBackends: new Set(), ...NO_GROUPS },
        async (_b, w, params, ctx) => { sent.push(wireParams(w, params, ctx).date); return []; });
      await fetcher({ widget_uuid: UUID, origin: "reference" }, signal);
      expect(sent).toEqual(["2026-09-04"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("tool result extra_state round trip (adaptation 7)", () => {
  it("echoes extra_state unchanged into the next request", async () => {
    const { buildQueryRequest } = await import("./request");
    const extra_state = { turn_usage: { input: 1 } };
    const msg = await executeFunction(
      { function: "get_skill_content", input_arguments: { slug: "nope" }, extra_state },
      { fetchWidget: async () => ({ data: [], url: "", params: {} }), runAgentTool: async () => null, onCall: () => {} },
      signal,
    );
    const body = buildQueryRequest([{ role: "human", content: "hi" }, msg]);
    expect((body.messages.at(-1) as { extra_state: unknown }).extra_state).toEqual(extra_state);
  });
});

describe("tool results are capped (review A6)", () => {
  const rows = Array.from({ length: 5000 }, (_, i) => ({ i, text: "x".repeat(40) }));
  it("keeps the leading rows that fit and says how many there were", () => {
    const out = capContent(rows);
    expect(out.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    const parsed = JSON.parse(out);
    expect(parsed).toMatchObject({ truncated: true, total_rows: 5000 });
    expect(parsed.rows).toEqual(rows.slice(0, parsed.returned_rows));
    expect(parsed.returned_rows).toBeGreaterThan(1000);
  });
  it("cuts other content with a marker the model reads, and leaves small content alone", () => {
    const out = capContent("y".repeat(MAX_RESULT_CHARS * 2));
    expect(out.length).toBe(MAX_RESULT_CHARS);
    expect(out).toMatch(/\[truncated: showing 100000 of 200000 characters\]$/);
    expect(capContent([{ a: 1 }])).toBe('[{"a":1}]');
  });
  it("caps get_widget_data and MCP results", async () => {
    const fetchWidget: WidgetFetcher = async () => ({ data: rows, url: "u", params: {} });
    const wd = await executeFunction({ function: "get_widget_data", input_arguments: { data_sources: [{ widget_uuid: "w" }] } }, { fetchWidget, runAgentTool: async () => null }, new AbortController().signal);
    const content = (((wd as { data: unknown }).data as Array<{ items: Array<{ content: string }> }>)[0].items[0].content);
    expect(content.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(JSON.parse(content).truncated).toBe(true);
    const mcp = await executeFunction(
      { function: "execute_agent_tool", input_arguments: { server_id: "s", tool_name: "t", parameters: {} } },
      { fetchWidget, runAgentTool: async () => ({ content: [{ type: "text", text: JSON.stringify(rows) }] }) },
      new AbortController().signal,
    );
    const text = ((mcp as { data: unknown }).data as Array<{ items: Array<{ text: string }> }>)[0].items[0].text;
    expect(text.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(JSON.parse(text)).toMatchObject({ truncated: true, total_rows: 5000 });
  });
});

describe("PDF cards in get_widget_data", () => {
  const PDF_CARD = card({ id: "7d3e9f10-2b4c-4e5a-8f60-1a2b3c4d5e6f", widgetId: "report", backendId: "reference", title: "Annual Report" });
  const report = widget({ id: "report", backendId: "reference", name: "Report", type: "pdf", params: [] });
  const run = (data: unknown) =>
    executeFunction(
      { function: "get_widget_data", input_arguments: { data_sources: [{ widget_uuid: PDF_CARD.id, origin: "reference" }] } },
      { fetchWidget: async () => ({ data, url: "", params: {}, pdf: true, name: "Annual Report" }), runAgentTool: async () => null },
      signal,
    );
  const items = async (data: unknown) => ((await run(data)) as { data: Array<{ items?: unknown[]; message?: string }> }).data[0];

  it("sends a base64 PDF as a pdf file item, not as a table", async () => {
    expect((await items({ content: "JVBERi0=", data_format: { data_type: "pdf", filename: "ar.pdf" } })).items).toEqual([
      { content: "JVBERi0=", data_format: { data_type: "pdf", filename: "ar.pdf" }, citable: true },
    ]);
  });

  it("keeps a backend's PDF link as a url item", async () => {
    expect((await items({ url: "https://example.com/ar.pdf", data_format: { data_type: "pdf", filename: "ar.pdf" } })).items).toEqual([
      { url: "https://example.com/ar.pdf", data_format: { data_type: "pdf", filename: "ar.pdf" }, citable: true },
    ]);
  });

  it("names the file after the card when the backend gave no filename", async () => {
    expect((await items({ content: "JVBERi0=", data_format: { data_type: "pdf" } })).items).toEqual([
      { content: "JVBERi0=", data_format: { data_type: "pdf", filename: "Annual Report.pdf" }, citable: true },
    ]);
  });

  it("is an error naming the card and the limit when the base64 is over the cap, never a truncated PDF", async () => {
    const result = await items({ content: "A".repeat(MAX_RESULT_CHARS + 1), data_format: { data_type: "pdf", filename: "big.pdf" } });
    expect(result.items).toBeUndefined();
    expect(result.message).toContain("Annual Report");
    expect(result.message).toContain(String(MAX_RESULT_CHARS));
  });

  it("marks a pdf widget's fetch as a PDF named after the card", async () => {
    const fetcher = makeWidgetDataFetcher(
      { cards: [PDF_CARD], backends, findWidget: () => report, keyMaintBackends: new Set(), ...NO_GROUPS },
      vi.fn(async () => ({ content: "JVBERi0=", data_format: { data_type: "pdf" } })) as never,
    );
    expect(await fetcher({ widget_uuid: PDF_CARD.id, origin: "reference" }, signal)).toMatchObject({ pdf: true, name: "Annual Report" });
  });
});
