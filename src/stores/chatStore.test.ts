// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backend, card, widget } from "../test/fixtures";
import { __list, __read, __reset } from "../test/memfs";
import { normalizeAgentsJson } from "../lib/agent/agents-json";
import { LOCAL_TOOLS } from "../lib/agent/localTools";
import { assembleTools, callMcpTool } from "../lib/agent/mcp";
import { McpError } from "../lib/agent/mcpError";
import type { AgentTool } from "../lib/agent/types";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import type { Skill } from "../lib/skillsFiles";
import { __resetAgentDiscoveryForTests, useAgentDiscoveryStore } from "./agentDiscoveryStore";
import { useBackendsStore } from "./backendsStore";
import type { ChatMessage } from "./chatStore";
import { isArtifactMessage, useChatStore } from "./chatStore";
import { __primeFiscalYearEndCachesForTests, __resetFiscalYearEndCacheForTests } from "../hooks/useFiscalYearEnd";
import { useDashboardStore } from "./dashboardStore";
import { useMcpTokensStore } from "./mcpTokensStore";
import { useSettingsStore } from "./settingsStore";
import { useSkillsStore } from "./skillsStore";
import { useWidgetRegistryStore } from "./widgetRegistryStore";

// send() now starts agents.json discovery itself when nothing is known for
// the Rita URL (final review I1). Left on the real fetch, that request would
// go through route() below and consume one of replies()' streams; by default
// it never answers, so discovery stays "loading" and changes nothing.
const fetchAgentsJson = vi.fn((..._a: unknown[]): Promise<unknown> => new Promise(() => {}));
vi.mock("../lib/agent/agents-json", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/agent/agents-json")>()),
  fetchAgentsJson: (...a: unknown[]) => fetchAgentsJson(...a),
}));

vi.mock("../lib/agent/mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/agent/mcp")>()),
  assembleTools: vi.fn(async () => ({ tools: null, budgetExceeded: [], unreachable: [] })),
  callMcpTool: vi.fn(),
}));

// The widget-data round trip goes through dataClient's fetchWidgetData, which
// imports fetch from @tauri-apps/plugin-http, not the global. A dynamic
// wrapper (not `{ fetch: globalThis.fetch }`, which would capture today's
// reference once at module-mock time) forwards each call to whatever
// route()/replies() has currently stubbed onto globalThis.fetch.
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args),
}));

const fixture = (path: string) => readFileSync(`src/test/fixtures/${path}`, "utf8");
const sse = (text: string) => new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
const UUID = "11111111-2222-3333-4444-555555555555";

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;
const bodies: Array<Record<string, unknown>> = [];
function route(fn: Route) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/query")) bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return fn(url, init ?? {});
  });
}
function replies(...streams: string[]) {
  let n = 0;
  route(() => sse(streams[Math.min(n++, streams.length - 1)]));
}

// An external MCP call waits for Run or Deny (dev b1e6612). Tests about
// something else approve it as the user would; the confirmation tests turn
// this off and answer the prompt themselves.
let approveTools = true;
useChatStore.subscribe((state) => {
  if (approveTools && state.pendingTool !== null) queueMicrotask(() => useChatStore.getState().resolveTool(true));
});

beforeEach(() => {
  approveTools = true;
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  __resetAgentDiscoveryForTests();
  fetchAgentsJson.mockReset();
  fetchAgentsJson.mockImplementation(() => new Promise(() => {}));
  bodies.length = 0;
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example" } });
  useDashboardStore.setState({
    dashboards: [],
    activeId: null,
    previousId: null,
    activeTabIds: {},
    maximizedCardId: null,
    viewer: false,
  });
  useChatStore.setState({
    messages: [],
    calls: [],
    trail: [],
    citations: [],
    suggestions: [],
    running: false,
    error: null,
    hasUnread: false,
    paneOpen: true,
    pinned: false,
    sharedCardIds: [],
    pendingMessage: null,
  });
  // I1 coverage below reads/writes this directly; reset it so no token leaks
  // between tests (it is otherwise untouched by the rest of this suite).
  useMcpTokensStore.setState({ tokens: {} });
  useSkillsStore.setState({ skills: [] });
});
afterEach(() => vi.unstubAllGlobals());

describe("chatStore.send", () => {
  it("streams a plain answer into an ai message and saves chat.json once", async () => {
    replies(fixture("rita/simple-text.sse"));
    await useChatStore.getState().send("What is a ticker?");
    const { messages, running, error } = useChatStore.getState();
    expect(running).toBe(false);
    expect(error).toBeNull();
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "human", content: "What is a ticker?" });
    expect(messages[1].role).toBe("ai");
    expect(String((messages[1] as { content: unknown }).content).startsWith("A stock ticker symbol")).toBe(true);
    const saved = JSON.parse(__read("chat.json") ?? "{}");
    expect(saved.messages).toHaveLength(2);
    expect((bodies[0].messages as unknown[]).length).toBe(1);
    expect(bodies[0].widgets).toEqual({ primary: [], secondary: [], extra: [] });
  });

  it("sends workspace_options from the discovered agent's configurable features and the stored choices", async () => {
    const agents = normalizeAgentsJson(JSON.parse(fixture("rita/agents.json")));
    useAgentDiscoveryStore.setState({ url: "https://rita.example", discovery: { state: "online", agents } });
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        ritaUrl: "https://rita.example",
        agentOptions: { openbb_agent_rita: { "prompt-suggestions": false, ghost: true } },
      },
    });
    replies(fixture("rita/simple-text.sse"));
    await useChatStore.getState().send("hi");
    expect(bodies[0].workspace_options).toEqual({
      "prompt-suggestions": false,
      model: "openai:nemotron-3.5-lightning",
    });
  });

  // D-016a: turning off BDOBB's own "Follow-up suggestions" asks the agent not
  // to write suggestions, rather than only hiding the chips.
  it("sends prompt-suggestions false when BDOBB's follow-up suggestions are off (D-016a)", async () => {
    const agents = normalizeAgentsJson(JSON.parse(fixture("rita/agents.json")));
    useAgentDiscoveryStore.setState({ url: "https://rita.example", discovery: { state: "online", agents } });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", agentPromptSuggestions: false } });
    replies(fixture("rita/simple-text.sse"));
    await useChatStore.getState().send("hi");
    expect(bodies[0].workspace_options).toEqual({ "prompt-suggestions": false, model: "openai:nemotron-3.5-lightning" });
  });

  it("sends {} when no agent has been discovered for this URL", async () => {
    replies(fixture("rita/simple-text.sse"));
    await useChatStore.getState().send("hi");
    expect(bodies[0].workspace_options).toEqual({});
  });

  // final review I1 / live check LC1: discovery used to start only when the
  // chat pane or the Agents tab mounted, so a first message sent with the
  // pane closed carried {}.
  it("starts discovery for an idle Rita URL without waiting for it", async () => {
    replies(fixture("rita/simple-text.sse"));
    // fetchAgentsJson's default never answers: send() finishing at all is
    // the proof that it did not wait.
    await useChatStore.getState().send("hi");
    expect(fetchAgentsJson).toHaveBeenCalledWith("https://rita.example");
    expect(useAgentDiscoveryStore.getState()).toMatchObject({ url: "https://rita.example", discovery: { state: "loading" } });
    expect(bodies[0].workspace_options).toEqual({});
  });

  it("does not start a second discovery while one is loading or online", async () => {
    useAgentDiscoveryStore.setState({ url: "https://rita.example", discovery: { state: "loading" } });
    replies(fixture("rita/simple-text.sse"));
    await useChatStore.getState().send("hi");
    expect(fetchAgentsJson).not.toHaveBeenCalled();
  });

  it("sends the keyed options from a store-level discovery, with no pane ever mounted", async () => {
    fetchAgentsJson.mockResolvedValueOnce(normalizeAgentsJson(JSON.parse(fixture("rita/agents.json"))));
    await useAgentDiscoveryStore.getState().discover("https://rita.example");
    replies(fixture("rita/simple-text.sse"));
    void useChatStore.getState().send("Analyze ACME");
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].workspace_options).toEqual({
      "prompt-suggestions": true,
      model: "openai:nemotron-3.5-lightning",
    });
  });

  it("posts LOCAL_TOOLS plus assembled MCP tools, and turns assembly warnings into trail WARNINGs", async () => {
    const mcpTool: AgentTool = {
      server_id: "s1",
      name: "search",
      url: "https://mcp.example/mcp",
      endpoint: "",
      description: "Search",
      input_schema: {},
    };
    vi.mocked(assembleTools).mockResolvedValueOnce({
      tools: [mcpTool],
      budgetExceeded: [
        { serverId: "s2", url: "https://mcp.example/big", toolCount: 99, payloadChars: 999_999, message: "server s2 dropped" },
      ],
      unreachable: [{ serverId: "s3", url: "https://mcp.example/down", message: "server s3 unreachable" }],
    });
    replies(fixture("rita/simple-text.sse"));
    await useChatStore.getState().send("hi");
    expect(bodies[0].tools).toEqual([...LOCAL_TOOLS, mcpTool]);
    expect(useChatStore.getState().trail.filter((s) => s.eventType === "WARNING")).toHaveLength(2);
  });

  it("records an ERROR status in the trail without setting error", async () => {
    replies(fixture("rita/error-status.sse"));
    await useChatStore.getState().send("hi");
    const { trail, error } = useChatStore.getState();
    expect(trail.some((s) => s.eventType === "ERROR")).toBe(true);
    expect(error).toBeNull();
  });

  it("renders a network failure as Rita offline", async () => {
    route(() => {
      throw new TypeError("fetch failed");
    });
    await useChatStore.getState().send("hi");
    expect(useChatStore.getState().error).toBe("Rita offline. fetch failed (https://rita.example)");
    expect(useChatStore.getState().messages).toHaveLength(1);
  });

  it("surfaces an HTTP error message", async () => {
    route(() => new Response("bad", { status: 500 }));
    await useChatStore.getState().send("hi");
    expect(useChatStore.getState().error).toMatch(/^HTTP 500/);
  });

  it("abort leaves no error", async () => {
    route((_url, init) =>
      new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("x", "AbortError")))),
    );
    const turn = useChatStore.getState().send("hi");
    useChatStore.getState().abort();
    await turn;
    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().running).toBe(false);
  });

  it("publishes only copilotMessageArtifact events, not status-step artifacts", async () => {
    replies(fixture("rita-artifact-stream.sse"));
    await useChatStore.getState().send("chart it");
    const { messages, citations } = useChatStore.getState();
    const artifacts = messages.filter(
      (m): m is Extract<ChatMessage, { content: unknown }> => "content" in m && Array.isArray(m.content),
    );
    expect(artifacts).toHaveLength(1);
    expect((artifacts[0].content as Array<{ uuid: string }>).map((a) => a.uuid)).toEqual([
      "bf6eb9f1-0f02-48c0-88d1-8205b67e36bc",
    ]);
    expect(citations).toHaveLength(1);
  });

  it("executes a get_widget_data round trip against the dashboard", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", contextSharing: true } });
    useBackendsStore.setState({ backends: [backend({ id: "reference", name: "Reference", baseUrl: "http://x" })] });
    useWidgetRegistryStore.setState({
      // symbol is declared so the model's input_args may set it; undeclared keys are dropped.
      widgets: [
        widget({
          id: "historical_prices",
          backendId: "reference",
          name: "Historical Prices",
          endpoint: "/historical",
          params: [{ paramName: "symbol", label: "Symbol", value: "SPY" }],
        }),
      ],
    });
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "Main",
          tabs: [{ id: "t1", name: "Tab", cards: [card({ id: UUID, widgetId: "historical_prices", backendId: "reference" })] }],
        },
      ],
      activeId: "d1",
      activeTabIds: { d1: "t1" },
    });
    let n = 0;
    route((url) => {
      if (url.endsWith("/v1/query")) return sse(n++ === 0 ? fixture("rita/function-call.sse") : fixture("rita/roundtrip-answer.sse"));
      return new Response(JSON.stringify([{ close: 1 }]), { status: 200, headers: { "content-type": "application/json" } });
    });
    await useChatStore.getState().send("show AAPL");
    expect(bodies).toHaveLength(2);
    // Untagged, so it is "on the dashboard", not "added to context".
    expect(bodies[0].widgets).toMatchObject({ primary: [], secondary: [expect.objectContaining({ uuid: UUID })] });
    expect((bodies[1].messages as Array<{ role: string }>).some((m) => m.role === "tool")).toBe(true);
    const { calls, messages, error } = useChatStore.getState();
    expect(error).toBeNull();
    expect(calls).toEqual([expect.objectContaining({ kind: "widget_data", ok: true, url: "http://x/historical?symbol=AAPL" })]);
    expect(messages.some((m) => m.role === "tool")).toBe(true);
    expect(messages[messages.length - 1].role).toBe("ai");
  });

  describe("get_widget_data reads the turn's dashboard live (review A5, A8, U8)", () => {
    const reference = () => {
      useBackendsStore.setState({ backends: [backend({ id: "reference", name: "Reference", baseUrl: "http://x" })] });
      useWidgetRegistryStore.setState({
        widgets: [widget({ id: "historical_prices", backendId: "reference", name: "Historical Prices", endpoint: "/historical", params: [{ paramName: "symbol", label: "Symbol", value: "SPY" }] })],
      });
    };
    const withCard = () => [card({ id: UUID, widgetId: "historical_prices", backendId: "reference" })];
    const twoRounds = (beforeFirstReply?: () => void) => {
      let n = 0;
      route((url) => {
        if (url.endsWith("/v1/query")) {
          if (n === 0) beforeFirstReply?.();
          return sse(n++ === 0 ? fixture("rita/function-call.sse") : fixture("rita/roundtrip-answer.sse"));
        }
        return new Response(JSON.stringify([{ close: 1 }]), { status: 200, headers: { "content-type": "application/json" } });
      });
    };

    it("finds a card added after the turn started", async () => {
      useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", contextSharing: true } });
      reference();
      useDashboardStore.setState({ dashboards: [{ id: "d1", name: "Main", tabs: [{ id: "t1", name: "Tab", cards: [] }] }], activeId: "d1", activeTabIds: { d1: "t1" } });
      twoRounds(() =>
        useDashboardStore.setState((s) => ({ dashboards: s.dashboards.map((d) => ({ ...d, tabs: [{ ...d.tabs[0], cards: withCard() }] })) })),
      );
      await useChatStore.getState().send("show AAPL");
      expect(useChatStore.getState().calls).toEqual([expect.objectContaining({ kind: "widget_data", ok: true })]);
    });

    it("reads no card with Context sharing off, even by a known uuid", async () => {
      useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", contextSharing: false } });
      reference();
      useDashboardStore.setState({ dashboards: [{ id: "d1", name: "Main", tabs: [{ id: "t1", name: "Tab", cards: withCard() }] }], activeId: "d1", activeTabIds: { d1: "t1" } });
      twoRounds();
      await useChatStore.getState().send("show AAPL");
      expect(useChatStore.getState().calls).toEqual([expect.objectContaining({ kind: "widget_data", ok: false, error: `unknown widget ${UUID}` })]);
    });

    it("keeps the refreshed context on the turn's own dashboard after a mid-turn switch", async () => {
      useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", contextSharing: true } });
      reference();
      useDashboardStore.setState({
        dashboards: [{ id: "d1", name: "Main", tabs: [{ id: "t1", name: "Tab", cards: withCard() }] }, { id: "d2", name: "Other", tabs: [{ id: "t2", name: "T", cards: [] }] }],
        activeId: "d1",
        activeTabIds: { d1: "t1" },
      });
      twoRounds(() => useDashboardStore.setState({ activeId: "d2" }));
      await useChatStore.getState().send("show AAPL");
      expect(JSON.stringify(bodies[1])).toContain('dashboard \\"Main\\"');
    });
  });

  it("shows a failed MCP tool call as a tool-error artifact above the reply, and ledgers it", async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", mcpServers: [{ id: "s1", url: "https://mcp.example/mcp", enabled: true }] },
    });
    vi.mocked(callMcpTool).mockRejectedValueOnce(new McpError("http_500", "MCP tools/call failed: HTTP 500 boom", 500));
    const call =
      'event: copilotFunctionCall\ndata: {"function":"execute_agent_tool","input_arguments":{"server_id":"s1","tool_name":"quote","input":{}}}\n\n';
    replies(call, fixture("rita/simple-text.sse"));
    await useChatStore.getState().send("quote AAPL");
    const { messages, calls } = useChatStore.getState();
    const errIndex = messages.findIndex(
      (m) => "content" in m && Array.isArray(m.content) && (m.content as Array<{ type: string }>)[0]?.type === "tool-error",
    );
    expect(errIndex).toBeGreaterThan(0);
    expect(((messages[errIndex] as { content: unknown }).content as Array<{ content: unknown }>)[0].content).toEqual({
      server: "mcp.example",
      tool: "quote",
      code: "http_500",
      message: "MCP tools/call failed: HTTP 500 boom",
    });
    expect(messages[messages.length - 1].role).toBe("ai");
    expect(typeof (messages[messages.length - 1] as { content: unknown }).content).toBe("string");
    expect(calls).toContainEqual(expect.objectContaining({ kind: "agent_tool", server_id: "s1", tool: "quote", ok: false }));
  });

  // Back-port of dev 5c05aa5 (#91): the turn's signal reached runAgentTool but
  // not the MCP request, so Stop left a running tool call to its timeout.
  it("Stop while an MCP tool call is running aborts that call's request", async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", mcpServers: [{ id: "s1", url: "https://mcp.example/mcp", enabled: true }] },
    });
    // Other tests in this file also call callMcpTool; start the count here.
    vi.mocked(callMcpTool).mockClear();
    let seen: AbortSignal | undefined;
    vi.mocked(callMcpTool).mockImplementationOnce(
      (_url, _tool, _args, _fetch, _headers, signal) =>
        new Promise((_resolve, reject) => {
          seen = signal;
          signal?.addEventListener("abort", () => reject(new DOMException("x", "AbortError")));
        }),
    );
    replies(
      'event: copilotFunctionCall\ndata: {"function":"execute_agent_tool","input_arguments":{"server_id":"s1","tool_name":"quote","input":{}}}\n\n',
    );
    const turn = useChatStore.getState().send("quote AAPL");
    await vi.waitFor(() => expect(callMcpTool).toHaveBeenCalled());
    expect(seen?.aborted).toBe(false);
    useChatStore.getState().abort();
    await turn;
    expect(seen?.aborted).toBe(true);
    expect(useChatStore.getState().running).toBe(false);
    // bdobb#43: Stop reads "Stopped", not a red transport failure.
    const { trail, messages, error } = useChatStore.getState();
    expect(trail.filter((t) => t.eventType === "ERROR")).toEqual([]);
    expect(trail.map((t) => t.message)).toContain("quote — Stopped");
    expect(messages.some((m) => "content" in m && Array.isArray(m.content) && (m.content as Array<{ type: string }>)[0]?.type === "tool-error")).toBe(false);
    expect(error).toBeNull();
  });

  describe("external MCP tool confirmation (back-port of dev b1e6612)", () => {
    const mcpCall =
      'event: copilotFunctionCall\ndata: {"function":"execute_agent_tool","input_arguments":{"server_id":"s1","tool_name":"create_note","input":{"title":"Buy"}}}\n\n';
    beforeEach(() => {
      approveTools = false;
      vi.mocked(callMcpTool).mockClear();
      useSettingsStore.setState({
        settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", mcpServers: [{ id: "s1", name: "Notes", url: "https://mcp.example/notes", enabled: true }] },
      });
    });

    it("waits for Run before calling the server", async () => {
      vi.mocked(callMcpTool).mockResolvedValueOnce({ content: [{ type: "text", text: "ok" }] });
      replies(mcpCall, fixture("rita/simple-text.sse"));
      const turn = useChatStore.getState().send("note it");
      await vi.waitFor(() => expect(useChatStore.getState().pendingTool).toEqual({ label: "Notes", url: "https://mcp.example/notes", tool: "create_note", args: { title: "Buy" } }));
      expect(callMcpTool).not.toHaveBeenCalled();
      useChatStore.getState().resolveTool(true);
      await turn;
      expect(callMcpTool).toHaveBeenCalledTimes(1);
      expect(useChatStore.getState().pendingTool).toBeNull();
    });

    it("Deny never reaches the server and tells Rita the user declined", async () => {
      replies(mcpCall, fixture("rita/simple-text.sse"));
      const turn = useChatStore.getState().send("note it");
      await vi.waitFor(() => expect(useChatStore.getState().pendingTool).not.toBeNull());
      useChatStore.getState().resolveTool(false);
      await turn;
      expect(callMcpTool).not.toHaveBeenCalled();
      expect(JSON.stringify(bodies.at(-1))).toContain("user_declined");
      // bdobb#43: the trail shows the call as Denied and counts it as the one error.
      const { trail, calls } = useChatStore.getState();
      expect(trail.filter((t) => t.eventType === "ERROR").map((t) => t.message)).toEqual(["create_note — Denied"]);
      expect(calls).toContainEqual(expect.objectContaining({ kind: "agent_tool", tool: "create_note", ok: false, narrated: "Denied" }));
    });

    it("flags the closed pane when a prompt is waiting (review U5)", async () => {
      useChatStore.setState({ paneOpen: false });
      replies(mcpCall, fixture("rita/simple-text.sse"));
      const turn = useChatStore.getState().send("note it");
      await vi.waitFor(() => expect(useChatStore.getState().pendingTool).not.toBeNull());
      expect(useChatStore.getState().hasUnread).toBe(true);
      useChatStore.getState().resolveTool(false);
      await turn;
    });

    it("Stop while the prompt is open settles it as denied and ends the turn", async () => {
      replies(mcpCall, fixture("rita/simple-text.sse"));
      const turn = useChatStore.getState().send("note it");
      await vi.waitFor(() => expect(useChatStore.getState().pendingTool).not.toBeNull());
      useChatStore.getState().abort();
      await turn;
      expect(useChatStore.getState().pendingTool).toBeNull();
      expect(useChatStore.getState().running).toBe(false);
      expect(callMcpTool).not.toHaveBeenCalled();
    });
  });

  // final review T8b: the token map was snapshotted once per turn, so a token
  // forgotten after a 401 earlier in the turn was still sent by a later call.
  it("reads the stored token at each use, so one forgotten earlier in the turn is not sent", async () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        ritaUrl: "https://rita.example",
        mcpServers: [{ id: "s1", url: "https://mcp.example/mcp", enabled: true, authType: "token", source: { kind: "file" } }],
      },
    });
    useMcpTokensStore.setState({ tokens: { "https://mcp.example/mcp": { token: "t0ken" } } });
    vi.mocked(callMcpTool).mockClear();
    // Stands in for discovery's 401, which forgets the token mid-turn.
    vi.mocked(assembleTools).mockImplementationOnce(async () => {
      useMcpTokensStore.setState({ tokens: {} });
      return { tools: null, budgetExceeded: [], unreachable: [] };
    });
    const call =
      'event: copilotFunctionCall\ndata: {"function":"execute_agent_tool","input_arguments":{"server_id":"s1","tool_name":"quote","input":{}}}\n\n';
    replies(call, fixture("rita/simple-text.sse"));
    await useChatStore.getState().send("quote AAPL");
    expect(callMcpTool).not.toHaveBeenCalled();
    expect(useChatStore.getState().calls).toContainEqual(expect.objectContaining({ kind: "agent_tool", server_id: "s1", ok: false, error: expect.stringContaining("Token required") }));
  });

  it("refuses a call to a tool the user turned off, without reaching the server", async () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        ritaUrl: "https://rita.example",
        mcpServers: [{ id: "s1", url: "https://mcp.example/mcp", enabled: true }],
        mcpDisabledTools: { "https://mcp.example/mcp": ["quote"] },
      },
    });
    // Other tests in this file also call callMcpTool; the mock's call count
    // is not reset between tests, so start this assertion from a clean slate.
    vi.mocked(callMcpTool).mockClear();
    const call =
      'event: copilotFunctionCall\ndata: {"function":"execute_agent_tool","input_arguments":{"server_id":"s1","tool_name":"quote","input":{}}}\n\n';
    replies(call, fixture("rita/simple-text.sse"));
    await useChatStore.getState().send("quote AAPL");
    expect(callMcpTool).not.toHaveBeenCalled();
    const { messages } = useChatStore.getState();
    const errIndex = messages.findIndex(
      (m) => "content" in m && Array.isArray(m.content) && (m.content as Array<{ type: string }>)[0]?.type === "tool-error",
    );
    expect(errIndex).toBeGreaterThan(0);
    expect(((messages[errIndex] as { content: unknown }).content as Array<{ content: { code: string } }>)[0].content.code).toBe("TOOL_DISABLED");
  });

  it("counts a refused local save as a failed call: tool-error card, ledger, and the trail's error count", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example" } });
    const call =
      'event: copilotFunctionCall\ndata: {"function":"execute_agent_tool","input_arguments":{"server_id":"bdobb-local","tool_name":"set_widget_params","parameters":{"card_id":"c1","text":"Answer"}}}\n\n';
    replies(call, fixture("rita/simple-text.sse"));
    await useChatStore.getState().send("write the answer");
    const { messages, calls, trail } = useChatStore.getState();
    expect(messages.some((m) => "content" in m && Array.isArray(m.content) && (m.content as Array<{ type: string }>)[0]?.type === "tool-error")).toBe(true);
    expect(calls).toContainEqual(expect.objectContaining({ kind: "agent_tool", tool: "set_widget_params", ok: false }));
    expect(trail.filter((s) => s.eventType === "ERROR")).toHaveLength(1);
  });

  describe("proxied MCP tool names", () => {
    const proxied = (name: string) =>
      `event: copilotFunctionCall\ndata: ${JSON.stringify({
        function: "execute_agent_tool",
        input_arguments: { server_id: "s1", tool_name: "call_tool", parameters: { name, arguments: {} } },
      })}\n\n`;
    const configure = (disabled: string[], seen: Record<string, string[]> = {}) =>
      useSettingsStore.setState({
        settings: {
          ...DEFAULT_SETTINGS,
          ritaUrl: "https://rita.example",
          mcpServers: [{ id: "s1", url: "https://mcp.example/mcp", enabled: true }],
          mcpDisabledTools: { "https://mcp.example/mcp": disabled },
          mcpSeenProxiedTools: seen,
        },
      });

    it("refuses a disabled call_tool target, labels it by its effective name, and counts one error", async () => {
      configure(["equity_price_historical"]);
      vi.mocked(callMcpTool).mockClear();
      replies(proxied("equity_price_historical"), fixture("rita/simple-text.sse"));
      await useChatStore.getState().send("price");
      expect(callMcpTool).not.toHaveBeenCalled();
      const { messages, trail } = useChatStore.getState();
      const err = messages.flatMap((m) => (isArtifactMessage(m) ? m.content : [])).find((a) => a.type === "tool-error");
      expect(err?.content).toMatchObject({ code: "TOOL_DISABLED", display: "mcp.example · equity_price_historical (via call_tool)" });
      expect(trail.filter((t) => t.eventType === "ERROR")).toHaveLength(1);
      expect(trail.find((t) => t.eventType === "ERROR")?.tool_call).toMatchObject({ display: "mcp.example · equity_price_historical (via call_tool)" });
    });

    // Live shape (v6 565d3c6 Rita run, transcripts/s36-37-r1.jsonl): agent-rita
    // 0011's status step carries only { tool_name, input }; the server id
    // arrives on the copilotFunctionCall right after it. The old test faked
    // server_id on the status, which the live agent never sends (#37).
    it("labels Rita's own status step for a proxied call from the function call that follows it (#37)", async () => {
      useSettingsStore.setState({
        settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", mcpServers: [{ id: "m1", name: "OpenBQ MCP", url: "https://mcp.example/mcp", enabled: true }] },
      });
      vi.mocked(callMcpTool).mockResolvedValue({ content: [] });
      const input = { name: "cboe_equity_historical", arguments: { symbol: "AAPL", start_date: "2025-01-02", end_date: "2025-01-08" } };
      const status = `event: copilotStatusUpdate\ndata: ${JSON.stringify({
        eventType: "INFO",
        message: "Calling call_tool",
        group: "reasoning",
        details: [input],
        tool_call: { tool_name: "call_tool", input },
      })}\n\n`;
      const call = `event: copilotFunctionCall\ndata: ${JSON.stringify({
        function: "execute_agent_tool",
        input_arguments: { server_id: "m1", tool_name: "call_tool", parameters: input },
      })}\n\n`;
      replies(status + call, fixture("rita/simple-text.sse"));
      await useChatStore.getState().send("price");
      const { trail } = useChatStore.getState();
      expect(trail[0].tool_call).toMatchObject({ tool_name: "call_tool", display: "OpenBQ MCP · cboe_equity_historical (via call_tool)" });
      expect(trail.filter((t) => t.eventType === "ERROR")).toHaveLength(0);
    });

    // #37 follow-up: the same live two-event shape must reach the call log
    // (Help, ai-library.md), once, by its effective name.
    describe("call log for the live two-event shape (#37)", () => {
      const input = { name: "cboe_equity_historical", arguments: { symbol: "AAPL" } };
      const twoEvents = () =>
        `event: copilotStatusUpdate\ndata: ${JSON.stringify({ eventType: "INFO", message: "Calling call_tool", tool_call: { tool_name: "call_tool", input } })}\n\n` +
        `event: copilotFunctionCall\ndata: ${JSON.stringify({ function: "execute_agent_tool", input_arguments: { server_id: "m1", tool_name: "call_tool", parameters: input } })}\n\n`;
      beforeEach(() =>
        useSettingsStore.setState({
          settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", mcpServers: [{ id: "m1", name: "OpenBQ MCP", url: "https://mcp.example/mcp", enabled: true }] },
        }),
      );

      it("logs a successful call once, with its effective name", async () => {
        vi.mocked(callMcpTool).mockResolvedValue({ content: [] });
        replies(twoEvents(), fixture("rita/simple-text.sse"));
        await useChatStore.getState().send("price");
        expect(useChatStore.getState().calls).toEqual([
          { kind: "agent_tool", server_id: "m1", tool: "call_tool", narrated: "Calling call_tool", display: "OpenBQ MCP · cboe_equity_historical (via call_tool)" },
        ]);
      });

      it("logs a failed call once, as the failure", async () => {
        vi.mocked(callMcpTool).mockRejectedValue(new Error("boom"));
        replies(twoEvents(), fixture("rita/simple-text.sse"));
        await useChatStore.getState().send("price");
        const { calls } = useChatStore.getState();
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ kind: "agent_tool", ok: false, display: "OpenBQ MCP · cboe_equity_historical (via call_tool)" });
      });
    });

    it("records a newly seen effective name through the persisted setter, once", async () => {
      configure([]);
      vi.mocked(callMcpTool).mockResolvedValue({ content: [] });
      const save = vi.spyOn(useSettingsStore.getState(), "save");
      replies(proxied("equity_price_historical"), proxied("equity_price_historical"), fixture("rita/simple-text.sse"));
      await useChatStore.getState().send("price");
      await vi.waitFor(() =>
        expect(useSettingsStore.getState().settings.mcpSeenProxiedTools).toEqual({ "https://mcp.example/mcp": ["equity_price_historical"] }),
      );
      expect(save.mock.calls.filter(([p]) => "mcpSeenProxiedTools" in p)).toHaveLength(1);
      save.mockRestore();
    });

    it("does not write when the name is already seen", async () => {
      configure([], { "https://mcp.example/mcp": ["equity_price_historical"] });
      vi.mocked(callMcpTool).mockResolvedValue({ content: [] });
      const save = vi.spyOn(useSettingsStore.getState(), "save");
      replies(proxied("equity_price_historical"), fixture("rita/simple-text.sse"));
      await useChatStore.getState().send("price");
      expect(save.mock.calls.filter(([p]) => "mcpSeenProxiedTools" in p)).toHaveLength(0);
      save.mockRestore();
    });
  });

  it("does not refuse a different tool on the same server", async () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        ritaUrl: "https://rita.example",
        mcpServers: [{ id: "s1", url: "https://mcp.example/mcp", enabled: true }],
        mcpDisabledTools: { "https://mcp.example/mcp": ["quote"] },
      },
    });
    vi.mocked(callMcpTool).mockResolvedValueOnce({ content: [] });
    const call =
      'event: copilotFunctionCall\ndata: {"function":"execute_agent_tool","input_arguments":{"server_id":"s1","tool_name":"news","input":{}}}\n\n';
    replies(call, fixture("rita/simple-text.sse"));
    await useChatStore.getState().send("news AAPL");
    expect(callMcpTool).toHaveBeenCalled();
  });

  it("refuses a card whose backend gains a key-maint widget after the turn started", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", contextSharing: true } });
    useBackendsStore.setState({ backends: [backend({ id: "reference", name: "Reference", baseUrl: "http://x" })] });
    const prices = widget({
      id: "historical_prices",
      backendId: "reference",
      name: "Historical Prices",
      endpoint: "/historical",
      params: [{ paramName: "symbol", label: "Symbol", value: "SPY" }],
    });
    useWidgetRegistryStore.setState({ widgets: [prices] });
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "Main",
          tabs: [{ id: "t1", name: "Tab", cards: [card({ id: UUID, widgetId: "historical_prices", backendId: "reference" })] }],
        },
      ],
      activeId: "d1",
      activeTabIds: { d1: "t1" },
    });
    let n = 0;
    route((url) => {
      if (url.endsWith("/v1/query")) {
        // The backend finishes loading its widgets mid-turn: the turn-start
        // snapshot saw no key-maint widget, the live registry now does.
        if (n === 0) useWidgetRegistryStore.setState({ widgets: [prices, widget({ id: "provider_keys", backendId: "reference", type: "keys" })] });
        return sse(n++ === 0 ? fixture("rita/function-call.sse") : fixture("rita/roundtrip-answer.sse"));
      }
      return new Response(JSON.stringify([{ close: 1 }]), { status: 200, headers: { "content-type": "application/json" } });
    });
    await useChatStore.getState().send("show AAPL");
    expect(useChatStore.getState().calls).toEqual([expect.objectContaining({ kind: "widget_data", ok: false })]);
    // The refs re-read each round (#326) read the key-maint set live too: the
    // card went up before the keys widget appeared, never after.
    expect(JSON.stringify(bodies[0].widgets)).toContain(UUID);
    expect(JSON.stringify(bodies[1].widgets ?? null)).not.toContain(UUID);
  });

  it("marks unread only while the pane is closed, cleared on open", async () => {
    useChatStore.getState().setPaneOpen(false);
    replies(fixture("rita/simple-text.sse"));
    await useChatStore.getState().send("hi");
    expect(useChatStore.getState().hasUnread).toBe(true);
    useChatStore.getState().setPaneOpen(true);
    expect(useChatStore.getState().hasUnread).toBe(false);
    await useChatStore.getState().send("again");
    expect(useChatStore.getState().hasUnread).toBe(false);
  });

  it("refuses to send while running", async () => {
    route(() => new Promise(() => {}));
    void useChatStore.getState().send("one");
    await useChatStore.getState().send("two");
    expect(bodies).toHaveLength(1);
    useChatStore.getState().abort();
  });

  it("sends the enabled skills as skills_catalog, and a /skill: slug as a forced selected_skill", async () => {
    const table: Skill = { slug: "openbb-html-table", description: "Tables.", content: "# T", enabled: true, updated: "2026-09-19T00:00:00.000Z", extra: {} };
    useSkillsStore.setState({ skills: [table, { ...table, slug: "off-skill", enabled: false }] });
    replies(fixture("rita/simple-text.sse"));
    await useChatStore.getState().send("/skill:openbb-html-table make me a table");
    expect(bodies[0].skills_catalog).toEqual([{ slug: "openbb-html-table", description: "Tables.", updatedAt: "2026-09-19T00:00:00.000Z" }]);
    expect(bodies[0].selected_skills).toEqual([{ slug: "openbb-html-table", description: "Tables.", contentMarkdown: "# T", source: "forced_slash" }]);
    // The typed text goes up unchanged.
    expect((bodies[0].messages as Array<{ content: unknown }>).at(-1)?.content).toBe("/skill:openbb-html-table make me a table");
  });

  it("answers a get_skill_content round trip from the skills store", async () => {
    useSkillsStore.setState({ skills: [{ slug: "openbb-html-table", description: "Tables.", content: "# T", enabled: true, updated: "", extra: {} }] });
    let n = 0;
    const call = 'event: copilotFunctionCall\ndata: {"function":"get_skill_content","input_arguments":{"slug":"openbb-html-table","reason":"tables"}}\n\n';
    route(() => sse(n++ === 0 ? call : fixture("rita/roundtrip-answer.sse")));
    await useChatStore.getState().send("make a table");
    expect(bodies).toHaveLength(2);
    const tool = (bodies[1].messages as Array<{ role: string; data: unknown }>).find((m) => m.role === "tool");
    expect(tool?.data).toEqual([{ status: "success", data: { skill: { slug: "openbb-html-table", description: "Tables.", contentMarkdown: "# T" } } }]);
    expect(useChatStore.getState().error).toBeNull();
  });

  it("uses the committed Rita round limit and persists partial tool history at the cap", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", ritaMaxFunctionRounds: 2 }, draft: null });
    useSettingsStore.getState().beginDraft();
    useSettingsStore.getState().stageDraft({ ritaMaxFunctionRounds: 8 });
    replies('event: copilotFunctionCall\ndata: {"function":"get_skill_content","input_arguments":{"slug":"missing"}}\n\n');
    await useChatStore.getState().send("test the tool limit");
    expect(bodies).toHaveLength(3);
    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().messages.filter((m) => m.role === "tool")).toHaveLength(2);
    expect(useChatStore.getState().trail).toContainEqual({ eventType: "WARNING", message: expect.stringContaining("2-round tool limit") });
    await useChatStore.getState().load();
    expect(useChatStore.getState().messages.filter((m) => m.role === "tool")).toHaveLength(2);
    useSettingsStore.getState().discardDraft();
  });
});

describe("chatStore widget tiers", () => {
  const A = "aaaaaaaa-0000-0000-0000-000000000001";
  const B = "bbbbbbbb-0000-0000-0000-000000000002";
  function seed(contextSharing: boolean) {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", contextSharing } });
    useBackendsStore.setState({ backends: [backend({ id: "reference", name: "Reference", baseUrl: "http://x" })] });
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "historical_prices", backendId: "reference", name: "Historical Prices", endpoint: "/historical" })],
    });
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "Main",
          tabs: [
            {
              id: "t1",
              name: "Tab",
              cards: [
                card({ id: A, widgetId: "historical_prices", backendId: "reference" }),
                card({ id: B, widgetId: "historical_prices", backendId: "reference" }),
              ],
            },
          ],
        },
      ],
      activeId: "d1",
      activeTabIds: { d1: "t1" },
    });
    replies(fixture("rita/simple-text.sse"));
  }
  const uuids = (refs: unknown) => (refs as Array<{ uuid: string }>).map((r) => r.uuid);
  const tiers = () => bodies[0].widgets as { primary: unknown; secondary: unknown };

  it("sends every card as secondary when nothing is tagged", async () => {
    seed(true);
    await useChatStore.getState().send("hi");
    expect(uuids(tiers().primary)).toEqual([]);
    expect(uuids(tiers().secondary)).toEqual([A, B]);
  });

  it("sends a tagged card as primary and the rest as secondary", async () => {
    seed(true);
    useChatStore.getState().toggleShared(B);
    await useChatStore.getState().send("hi");
    expect(uuids(tiers().primary)).toEqual([B]);
    expect(uuids(tiers().secondary)).toEqual([A]);
  });

  it("identifies tagged shared cards as actual dashboard cards even when secondary is empty", async () => {
    seed(true);
    useChatStore.getState().toggleShared(A);
    useChatStore.getState().toggleShared(B);
    await useChatStore.getState().send("Remove the first card from this dashboard");
    expect(uuids(tiers().primary)).toEqual([A, B]);
    expect(uuids(tiers().secondary)).toEqual([]);
    const context = JSON.stringify(bodies[0].context);
    expect(context).toContain(A);
    expect(context).toContain(B);
    expect(context).toContain("placed on this dashboard");
  });

  it("sends no widgets with Context Sharing off, tagged or not", async () => {
    seed(false);
    useChatStore.getState().toggleShared(A);
    await useChatStore.getState().send("hi");
    expect(bodies[0].widgets).toEqual({ primary: [], secondary: [], extra: [] });
    expect(JSON.stringify(bodies[0].context)).not.toContain(A);
    expect(JSON.stringify(bodies[0].context)).not.toContain(B);
  });

  it("toggleShared untags a tagged card", () => {
    useChatStore.getState().toggleShared(A);
    useChatStore.getState().toggleShared(A);
    expect(useChatStore.getState().sharedCardIds).toEqual([]);
  });

  it("does not send a tag for a card off the active dashboard, but keeps it", async () => {
    seed(true);
    useChatStore.getState().toggleShared("elsewhere");
    useChatStore.getState().toggleShared(A);
    await useChatStore.getState().send("hi");
    expect(uuids(tiers().primary)).toEqual([A]);
    expect(useChatStore.getState().sharedCardIds).toContain("elsewhere");
  });
});

describe("chatStore widget-derived MCP servers", () => {
  function seedMcpCard(contextSharing: boolean) {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", contextSharing } });
    useBackendsStore.setState({ backends: [backend({ id: "reference", name: "Reference", baseUrl: "http://x" })] });
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "app", backendId: "reference", type: "iframe", mcpUrl: "http://localhost:7769/mcp" })],
    });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "Main", tabs: [{ id: "t1", name: "Tab", cards: [card({ id: UUID, widgetId: "app", backendId: "reference" })] }] }],
      activeId: "d1",
      activeTabIds: { d1: "t1" },
    });
    replies(fixture("rita/simple-text.sse"));
  }

  it("unions the active dashboard's mcpUrls into the tool set while Context Sharing is on", async () => {
    seedMcpCard(true);
    await useChatStore.getState().send("hi");
    expect(vi.mocked(assembleTools).mock.calls.at(-1)?.[1]).toEqual(["http://localhost:7769/mcp"]);
  });

  it("contacts none of them with Context Sharing off", async () => {
    seedMcpCard(false);
    await useChatStore.getState().send("hi");
    expect(vi.mocked(assembleTools).mock.calls.at(-1)?.[1]).toEqual([]);
  });

  it("hands the stored disabled-tool lists to assembleTools", async () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        ritaUrl: "https://rita.example",
        mcpDisabledTools: { "https://m.example/mcp": ["t"] },
      },
    });
    replies(fixture("rita/simple-text.sse"));
    await useChatStore.getState().send("hi");
    // Task 8 adds a `discover` function to this same options object, routing
    // discovery through withMcpAuth -- disabledTools is what this test is
    // about, so discover is matched loosely rather than re-specified here.
    expect(vi.mocked(assembleTools).mock.calls.at(-1)?.[2]).toEqual({
      disabledTools: { "https://m.example/mcp": ["t"] },
      discover: expect.any(Function),
    });
  });
});

describe("chatStore.load and clear", () => {
  it("loads a saved transcript and drops malformed calls", async () => {
    const { saveChat } = await import("../lib/chatFile");
    await saveChat({ messages: [{ role: "human", content: "old" }], calls: [{ kind: "bogus" }, { kind: "agent_tool", server_id: "s", tool: "t", narrated: "n" }] });
    await useChatStore.getState().load();
    expect(useChatStore.getState().messages).toEqual([{ role: "human", content: "old" }]);
    expect(useChatStore.getState().calls).toEqual([{ kind: "agent_tool", server_id: "s", tool: "t", narrated: "n" }]);
  });

  it("clear empties state and removes chat.json", async () => {
    replies(fixture("rita/simple-text.sse"));
    await useChatStore.getState().send("hi");
    expect(__list()).toContain("chat.json");
    await useChatStore.getState().clear();
    expect(useChatStore.getState().messages).toEqual([]);
    expect(__list()).not.toContain("chat.json");
  });

  it("clear() mid-turn does not resurrect the aborted turn's ledger", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", contextSharing: true } });
    useBackendsStore.setState({ backends: [backend({ id: "reference", name: "Reference", baseUrl: "http://x" })] });
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "historical_prices", backendId: "reference", name: "Historical Prices", endpoint: "/historical" })],
    });
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "Main",
          tabs: [{ id: "t1", name: "Tab", cards: [card({ id: UUID, widgetId: "historical_prices", backendId: "reference" })] }],
        },
      ],
      activeId: "d1",
      activeTabIds: { d1: "t1" },
    });
    // Round 1 answers with a function call (yields one widget_data ledger
    // entry via onCall); round 2 hangs until clear()'s abort rejects it --
    // by which point that entry already sits in send()'s local `calls`.
    let n = 0;
    let resolveSecondCall = () => {};
    const secondCallStarted = new Promise<void>((resolve) => {
      resolveSecondCall = resolve;
    });
    route((url, init) => {
      if (url.endsWith("/v1/query")) {
        if (n++ === 0) return sse(fixture("rita/function-call.sse"));
        resolveSecondCall();
        return new Promise((_, reject) =>
          init.signal?.addEventListener("abort", () => reject(new DOMException("x", "AbortError"))),
        );
      }
      return new Response(JSON.stringify([{ close: 1 }]), { status: 200, headers: { "content-type": "application/json" } });
    });
    const turn = useChatStore.getState().send("show AAPL");
    await secondCallStarted;
    await useChatStore.getState().clear();
    await turn;
    expect(useChatStore.getState().calls).toEqual([]);
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it("clear() during assembleTools does not resurrect the aborted turn", async () => {
    // assembleTools resolves AFTER clear() has already run -- the turn has
    // no controller yet to abort, so only the turnSeq token can catch it.
    let resolveAssemble: (v: Awaited<ReturnType<typeof assembleTools>>) => void = () => {};
    const deferred = new Promise<Awaited<ReturnType<typeof assembleTools>>>((resolve) => {
      resolveAssemble = resolve;
    });
    vi.mocked(assembleTools).mockImplementationOnce(() => deferred);
    replies(fixture("rita/simple-text.sse"));
    const turn = useChatStore.getState().send("hi");
    await useChatStore.getState().clear();
    resolveAssemble({ tools: null, budgetExceeded: [], unreachable: [] });
    await turn;
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().calls).toEqual([]);
    expect(__list()).not.toContain("chat.json");
  });

  it("saves tags with the transcript and loads them back", async () => {
    replies(fixture("rita/simple-text.sse"));
    useChatStore.getState().toggleShared("c1");
    await useChatStore.getState().send("hi");
    expect(JSON.parse(__read("chat.json") ?? "{}").sharedCardIds).toEqual(["c1"]);
    useChatStore.setState({ sharedCardIds: [] });
    await useChatStore.getState().load();
    expect(useChatStore.getState().sharedCardIds).toEqual(["c1"]);
  });

  it("loads a tag list that is not all strings as no tags, keeping the transcript", async () => {
    const { saveChat } = await import("../lib/chatFile");
    await saveChat({ messages: [{ role: "human", content: "old" }], sharedCardIds: ["ok", 7] });
    await useChatStore.getState().load();
    expect(useChatStore.getState().messages).toEqual([{ role: "human", content: "old" }]);
    expect(useChatStore.getState().sharedCardIds).toEqual([]);
  });

  it("clear removes every tag", async () => {
    useChatStore.getState().toggleShared("c1");
    await useChatStore.getState().clear();
    expect(useChatStore.getState().sharedCardIds).toEqual([]);
  });

  it("untagging after a turn has completed saves immediately, so a restart doesn't resurrect the tag", async () => {
    replies(fixture("rita/simple-text.sse"));
    useChatStore.getState().toggleShared("c1");
    await useChatStore.getState().send("hi");
    expect(JSON.parse(__read("chat.json") ?? "{}").sharedCardIds).toEqual(["c1"]);

    useChatStore.getState().toggleShared("c1");
    await vi.waitFor(() => {
      expect(JSON.parse(__read("chat.json") ?? "{}").sharedCardIds).toEqual([]);
    });

    useChatStore.setState({ sharedCardIds: ["c1"] });
    await useChatStore.getState().load();
    expect(useChatStore.getState().sharedCardIds).toEqual([]);
  });

  it("toggleShared with an empty transcript writes no chat.json", async () => {
    useChatStore.getState().toggleShared("c1");
    // Nothing async to wait on other than the tick a stray save would need.
    await Promise.resolve();
    await Promise.resolve();
    expect(__list()).not.toContain("chat.json");
  });

  it("togglePinned flips pinned", () => {
    useChatStore.getState().togglePinned();
    expect(useChatStore.getState().pinned).toBe(true);
  });

  it("togglePinned is a no-op with no Rita URL, so no caller leaves a stale pin (D-009 follow-up)", () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "" } });
    useChatStore.getState().togglePinned();
    expect(useChatStore.getState().pinned).toBe(false);
  });
});

describe("captured tagged request (Rita, v6.1.0)", () => {
  it("reproduces the captured request's widgets tiers through the real store", async () => {
    const captured = JSON.parse(fixture("rita/tagged-request.json"));
    const primaryRef = captured.widgets.primary[0];
    const secondaryRef = captured.widgets.secondary[0];

    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", contextSharing: true } });
    useBackendsStore.setState({ backends: [backend({ id: "reference", name: "Reference", baseUrl: "http://x" })] });
    useWidgetRegistryStore.setState({
      widgets: [
        widget({ id: primaryRef.widget_id, backendId: "reference", name: primaryRef.name, description: primaryRef.description, params: [] }),
        widget({ id: secondaryRef.widget_id, backendId: "reference", name: secondaryRef.name, description: secondaryRef.description, params: [] }),
      ],
    });
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "Main",
          tabs: [
            {
              id: "t1",
              name: "Tab",
              cards: [
                card({ id: primaryRef.uuid, widgetId: primaryRef.widget_id, backendId: "reference" }),
                card({ id: secondaryRef.uuid, widgetId: secondaryRef.widget_id, backendId: "reference" }),
              ],
            },
          ],
        },
      ],
      activeId: "d1",
      activeTabIds: { d1: "t1" },
    });
    useChatStore.getState().toggleShared(primaryRef.uuid);
    replies(fixture("rita/simple-text.sse"));

    await useChatStore.getState().send(captured.messages[0].content);

    expect(bodies[0].widgets).toEqual(captured.widgets);
  });
});

// Review U3: a sendToAgent row is card data. It goes into the draft for the
// user to read and send; it is never sent as the user's message by itself.
describe("chatStore.pushUserMessage", () => {
  it("pins the pane and hands the text to the draft without sending", async () => {
    replies(fixture("rita/simple-text.sse"));
    useChatStore.getState().pushUserMessage({ text: "Analyze ACME" });
    expect(useChatStore.getState()).toMatchObject({ pinned: true, pendingMessage: "Analyze ACME", running: false });
    await Promise.resolve();
    expect(bodies).toHaveLength(0);
  });

  it("the latest click wins, also while a turn runs, and the turn never sends it", async () => {
    replies(fixture("rita/simple-text.sse"));
    const first = useChatStore.getState().send("first");
    useChatStore.getState().pushUserMessage({ text: "one" });
    useChatStore.getState().pushUserMessage({ text: "two" });
    await first;
    expect(useChatStore.getState().pendingMessage).toBe("two");
    expect(bodies).toHaveLength(1);
  });

  it("still drafts for Rita, and logs once, when agentId names no discovered agent", async () => {
    useChatStore.getState().pushUserMessage({ text: "x", agentId: "financial-analyst-agent" });
    expect(useChatStore.getState().pendingMessage).toBe("x");
    await vi.waitFor(() => expect(__read("logs/bdobb.log") ?? "").toContain("sendToAgent names agent financial-analyst-agent"));
  });

  it("Clear drops a waiting draft", async () => {
    useChatStore.getState().pushUserMessage({ text: "held" });
    await useChatStore.getState().clear();
    expect(useChatStore.getState().pendingMessage).toBeNull();
  });
});

// task-8 review I1: nothing at the chatStore level proved the credential
// wiring end to end -- these two go through the REAL assembleTools (and so
// the real discoverMcpTools/withMcpAuth it calls), rather than the module's
// usual `{tools: null, ...}` stub, which never touches withMcpAuth at all.
describe("chatStore MCP credential wiring (task-8 I1)", () => {
  async function useRealAssembleTools() {
    const actual = await vi.importActual<typeof import("../lib/agent/mcp")>("../lib/agent/mcp");
    vi.mocked(assembleTools).mockImplementationOnce(actual.assembleTools);
  }

  it("makes no fetch for a Settings token server with no stored token, and surfaces the required message", async () => {
    await useRealAssembleTools();
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        ritaUrl: "https://rita.example",
        mcpServers: [{ id: "s1", url: "https://docs.example/mcp", enabled: true, authType: "token", source: { kind: "file" } }],
      },
    });
    // No mcpTokensStore.setToken call was ever made for this URL.
    const seenUrls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const reqUrl = String(input);
      seenUrls.push(reqUrl);
      if (reqUrl.endsWith("/v1/query")) {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return sse(fixture("rita/simple-text.sse"));
      }
      throw new Error(`unexpected fetch to ${reqUrl}`);
    });

    await useChatStore.getState().send("hi");

    // Discovery never reached the server's URL at all -- withMcpAuth's
    // needs-token branch throws before its `run` callback (and so before any
    // fetch) is ever invoked.
    expect(seenUrls.some((u) => u.includes("docs.example"))).toBe(false);
    expect(
      useChatStore
        .getState()
        .trail.some((s) => s.eventType === "WARNING" && s.message.includes("Token required — add it in AI Library → MCP Servers")),
    ).toBe(true);
  });

  it("keeps a query-auth backend credential off the /v1/query body while the MCP request URL carries it", async () => {
    await useRealAssembleTools();
    // Change A: same hostname as the MCP server below -- this test is about
    // the query-credential SHAPE, not the cross-host block (covered in
    // mcpAuth.test.ts), so the two must agree on host.
    const b = backend({ id: "b1", name: "NAS", baseUrl: "https://mcp.example", headerName: "api_token", headerValue: "s3cr3t", authLocation: "query" });
    useBackendsStore.setState({ backends: [b] });
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        ritaUrl: "https://rita.example",
        mcpServers: [{ id: "s1", url: "https://mcp.example/mcp", enabled: true, authType: "token", source: { kind: "backend", backendId: "b1" } }],
      },
    });
    const mcpUrls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const reqUrl = String(input);
      if (reqUrl.endsWith("/v1/query")) {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return sse(fixture("rita/simple-text.sse"));
      }
      mcpUrls.push(reqUrl);
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === "initialize") return sse('data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n');
      if (body.method === "notifications/initialized") return new Response("", { status: 202 });
      if (body.method === "tools/list") {
        return sse('data: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"search","description":"","inputSchema":{}}]}}\n\n');
      }
      throw new Error(`unexpected MCP method ${body.method}`);
    });

    await useChatStore.getState().send("hi");

    // The credential DID travel -- on the actual MCP request URL, at fetch
    // time -- proving discovery went through withMcpAuth's query branch.
    expect(mcpUrls.some((u) => u.includes("s3cr3t"))).toBe(true);
    // But it must never appear anywhere in what gets serialized to Rita: not
    // on the discovered tool's url, not in an unreachable[]/error message.
    expect(JSON.stringify(bodies[0])).not.toContain("s3cr3t");
  });
});

describe("chatStore suggestions gating on agentPromptSuggestions", () => {
  // The wire event name is copilotPromptSuggestions (events.ts); "test" here
  // is the plain human turn text, unrelated to the event name.
  const stream = `event: copilotPromptSuggestions\ndata: {"suggestions":["Follow up 1","Follow up 2"]}\n\n`;

  it("ignores a suggestions event when agentPromptSuggestions is off", async () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, agentPromptSuggestions: false } }));
    replies(stream);
    await useChatStore.getState().send("test");
    expect(useChatStore.getState().suggestions).toEqual([]);
  });

  it("keeps a suggestions event when agentPromptSuggestions is on (the default)", async () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, agentPromptSuggestions: true } }));
    replies(stream);
    await useChatStore.getState().send("test");
    expect(useChatStore.getState().suggestions).toEqual(["Follow up 1", "Follow up 2"]);
  });

  it("clears displayed suggestions when turned off and does not resurrect on turning on", () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, agentPromptSuggestions: true } }));
    useChatStore.setState({ suggestions: ["a", "b"] });
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, agentPromptSuggestions: false } }));
    expect(useChatStore.getState().suggestions).toEqual([]);
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, agentPromptSuggestions: true } }));
    expect(useChatStore.getState().suggestions).toEqual([]); // no resurrection
  });
});
