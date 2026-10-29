// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment jsdom
// BDOBB as host, against openbq-org/agents-for-openbb examples 30-42 (MIT), which
// scripts/agent-conformance.sh starts on loopback behind a stub OpenAI server. Each example
// answers 422 when its openbb-ai QueryRequest refuses a body, so every passing case also
// proves the request BDOBB built validates. Runs only when OPENBB_EXAMPLE_AGENTS is set.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { cardRequestSync } from "../../hooks/useCardRequest";
import { fetchAgentsJson } from "../../lib/agent/agents-json";
import { buildWidgetRefs, executeFunction, makeWidgetDataFetcher, type ExecuteDeps } from "../../lib/agent/execute";
import { advertisesFeedback, sendFeedback } from "../../lib/agent/feedback";
import { runAgentQuery } from "../../lib/agent/query";
import { dashboardContext } from "../../lib/agent/request";
import type { AgentEvent, AgentMessage, AgentTool, BoundingBox, SkillCatalogEntry } from "../../lib/agent/types";
import { pickAgent, workspaceOptionsFor } from "../../lib/agent/workspaceOptions";
import type { fetchWidgetData } from "../../lib/dataClient";
import type { Skill } from "../../lib/skillsFiles";
import type { DashboardCard, WidgetDef } from "../../lib/types";
import { isClientArtifact } from "../../stores/chatStore";
import { backend as backendOf, card as cardOf, widget as widgetOf } from "../fixtures";
import { pdfBase64 } from "../pdfFixture";

const agents = new Map(
  (process.env.OPENBB_EXAMPLE_AGENTS ?? "").split(",").filter(Boolean).map((p) => p.split("=") as [string, string]),
);
const live = agents.size > 0 ? describe : describe.skip;
const url = (n: number) => {
  const u = agents.get(String(n));
  if (!u) throw new Error(`example ${n} was not started`);
  return u;
};

const backend = backendOf({ id: "conformance", name: "Conformance", baseUrl: "http://127.0.0.1:9" });
const def = (id: string, name: string, type: string, params: WidgetDef["params"] = []) =>
  widgetOf({ id, backendId: backend.id, name, description: `${name} for the conformance run.`, type, endpoint: `/${id}`, params });
const WIDGETS = [
  def("prices", "Conformance Prices", "table", [{ paramName: "symbol", label: "Symbol", type: "text", value: "AAPL" }]),
  def("report", "Conformance Report", "pdf"),
  def("notes", "Conformance Notes", "table"),
];
// openbb-ai types a widget's uuid as a UUID, as BDOBB's own card ids are.
const PRICES = cardOf({ id: "6f1c7a52-8a43-4d0b-9a3e-0b5d1c2e3f40", widgetId: "prices", backendId: backend.id });
const REPORT = cardOf({ id: "7d3e9f10-2b4c-4e5a-8f60-1a2b3c4d5e6f", widgetId: "report", backendId: backend.id });
const NOTES = cardOf({ id: "8e4fa021-3c5d-4f6b-9071-2b3c4d5e6f70", widgetId: "notes", backendId: backend.id });
const findWidget = (_backendId: string, id: string) => WIDGETS.find((w) => w.id === id);
const refs = (cards: DashboardCard[]) => buildWidgetRefs(cards, findWidget, () => backend.name, new Set());
const PDF = pdfBase64(["Conformance fixture page one.", "Revenue grew 12 percent in 2025."]);
const fetchData = (async (_b: unknown, w: WidgetDef) =>
  w.type === "pdf"
    ? { content: PDF, data_format: { data_type: "pdf", filename: "conformance.pdf" } }
    : [{ symbol: "AAPL", marker: `row-${w.id}` }]) as unknown as typeof fetchWidgetData;
const fetchWidget = makeWidgetDataFetcher(
  { cards: [PRICES, REPORT, NOTES], backends: [backend], findWidget, keyMaintBackends: new Set(), request: (c, w, b) => cardRequestSync(c, w, b, undefined) },
  fetchData,
);
// What chatStore.send's refresh sends beside the cards; it validates as a RawContext since the Q1 ruling.
const CONTEXT = [dashboardContext({ id: "conformance", name: "Conformance" }, [])];

type Options = {
  primary?: DashboardCard[];
  secondary?: DashboardCard[];
  tools?: AgentTool[];
  workspaceOptions?: Record<string, boolean | string>;
  skillsCatalog?: SkillCatalogEntry[];
  deps?: Partial<ExecuteDeps>;
};

/** One user turn through runAgentQuery, executing calls the way chatStore.send does. */
async function turn(n: number, o: Options = {}) {
  const events: AgentEvent[] = [];
  const calls: Record<string, unknown>[] = [];
  const gen = runAgentQuery({
    ritaUrl: url(n),
    messages: [{ role: "human", content: "hi" }],
    refresh: () => ({ primary: refs(o.primary ?? []), secondary: refs(o.secondary ?? []), context: CONTEXT }),
    tools: o.tools ?? [],
    executeFunction: (payload, signal) => {
      calls.push(payload);
      return executeFunction(payload, { fetchWidget, runAgentTool: async () => null, ...o.deps }, signal);
    },
    workspaceOptions: o.workspaceOptions,
    skillsCatalog: o.skillsCatalog,
    timeoutMs: 30_000,
  });
  let history: AgentMessage[];
  for (;;) {
    const next = await gen.next();
    if (next.done) { history = next.value; break; }
    events.push(next.value);
  }
  const of = <T extends AgentEvent["type"]>(type: T) => events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type);
  const text = of("chunk").map((e) => e.delta).join("");
  const citations = of("citations").flatMap((e) => (Array.isArray(e.payload.citations) ? (e.payload.citations as Record<string, unknown>[]) : []));
  return { events, calls, history, text, of, citations };
}

live("OpenBB example agents (agents-for-openbb aa1073d)", () => {
  it("30 raw widget data: get_widget_data round-trips and the reply streams", async () => {
    const t = await turn(30, { primary: [PRICES] });
    expect(t.calls.map((c) => c.function)).toEqual(["get_widget_data"]);
    expect(t.text).toContain("stub reply");
    expect(t.text).toContain("row-prices");
  });

  it("31 reasoning steps: a status arrives before the reply", async () => {
    const t = await turn(31);
    const firstStatus = t.events.findIndex((e) => e.type === "status");
    expect(firstStatus).toBeGreaterThanOrEqual(0);
    expect(firstStatus).toBeLessThan(t.events.findIndex((e) => e.type === "chunk"));
    expect(t.of("status").map((e) => e.status.message)).toContain("Starting to answer the question...");
  });

  it("32 citations: the collection names the primary card's widget", async () => {
    const t = await turn(32, { primary: [PRICES] });
    expect(t.citations.map((c) => c.source_info)).toContainEqual(expect.objectContaining({ type: "widget", origin: backend.id, widget_id: "prices" }));
  });

  it("33 charts: five chart artifacts pass BDOBB's artifact guard", async () => {
    const arts = (await turn(33)).of("artifact").map((e) => e.payload);
    expect(arts).toHaveLength(5);
    for (const a of arts) {
      expect(isClientArtifact(a)).toBe(true);
      expect(a.type).toBe("chart");
    }
  });

  it("34 tables: a table artifact passes the guard", async () => {
    const arts = (await turn(34)).of("artifact").map((e) => e.payload);
    expect(arts).toHaveLength(1);
    expect(isClientArtifact(arts[0])).toBe(true);
    expect(arts[0].type).toBe("table");
  });

  it("35 PDF: BDOBB sends the PDF card as data_type pdf and the example reads it", async () => {
    const t = await turn(35, { primary: [REPORT] });
    const tool = t.history.find((m) => m.role === "tool") as { data: Array<{ items: unknown[] }> };
    expect(tool.data[0].items[0]).toEqual({ content: PDF, data_format: { data_type: "pdf", filename: "conformance.pdf" }, citable: true });
    expect(t.text).toContain("===== conformance.pdf =====");
    expect(t.text).toContain("Revenue grew 12 percent in 2025.");
  });

  it("36 PDF citations: quote_bounding_boxes arrive and parse into boxes", async () => {
    const boxed = (await turn(36, { primary: [REPORT] })).citations.filter((c) => "quote_bounding_boxes" in c);
    expect(boxed).toHaveLength(1);
    const [[box]] = boxed[0].quote_bounding_boxes as BoundingBox[][];
    expect(box).toEqual({ text: "Conformance fixture page one.", page: 1, x0: 72, top: 78, x1: expect.closeTo(236.748, 2), bottom: 90 });
  });

  it("37 custom features: all four shapes normalize and the set values reach the request", async () => {
    const agent = pickAgent(await fetchAgentsJson(url(37)), url(37));
    expect(Object.fromEntries(Object.entries(agent?.features ?? {}).map(([k, f]) => [k, f.kind]))).toMatchObject({
      "deep-research": "toggle", "web-search": "toggle", model: "select", "agent-name": "text",
    });
    const t = await turn(37, { workspaceOptions: workspaceOptionsFor(agent, { "deep-research": true, model: "gpt-4o-mini", "agent-name": "Conformance Agent" }) });
    expect(t.text).toContain("- Deep Research: ✅ Enabled");
    expect(t.text).toContain("- Model: gpt-4o-mini");
    expect(t.text).toContain("- Agent Name: Conformance Agent");
  });

  it("38 MCP tools: the tool list is sent and an execute_agent_tool call round-trips", async () => {
    const tool: AgentTool = { server_id: "conformance", name: "echo", url: "http://127.0.0.1:9/mcp", endpoint: "", description: "Echo for the conformance run.", input_schema: { type: "object", properties: {} } };
    const ran: unknown[][] = [];
    const t = await turn(38, {
      tools: [tool],
      deps: { runAgentTool: async (...a) => { ran.push(a.slice(0, 3)); return { content: [{ type: "text", text: "echo-38" }] }; } },
    });
    expect(ran).toEqual([["conformance", "echo", {}]]);
    expect(t.text).toContain("Tool: echo (Server ID: conformance)");
    expect(t.text).toContain("echo-38");
  });

  it("39 HTML artifacts: three html artifacts pass the guard", async () => {
    const arts = (await turn(39)).of("artifact").map((e) => e.payload);
    expect(arts).toHaveLength(3);
    for (const a of arts) {
      expect(isClientArtifact(a)).toBe(true);
      expect(a.type).toBe("html");
    }
  });

  it("40 dashboard widgets: primary and secondary refs both validate and reach the example", async () => {
    const both = await turn(40, { primary: [PRICES], secondary: [NOTES] });
    expect(both.text).toContain("# Explicit Context (Primary)");
    expect(both.text).toContain("Conformance Prices");
    // The example lists secondary widgets only beside workspace_state's tabs (BDOBB sends none, Q4) or with no primary.
    const secondary = await turn(40, { secondary: [NOTES] });
    expect(secondary.text).toContain("**Available widgets**");
    expect(secondary.text).toContain("Conformance Notes");
  });

  it("41 dynamic skill: get_skill_content round-trips and the skill reaches the prompt", async () => {
    const skill: Skill = { slug: "conformance-skill", description: "Skill for the conformance run.", content: "SKILL-BODY-41", enabled: true, updated: "2026-10-28T00:00:00Z", extra: {} };
    const t = await turn(41, {
      skillsCatalog: [{ slug: skill.slug, description: skill.description, updatedAt: skill.updated }],
      deps: { readSkill: (slug) => (slug === skill.slug ? skill : undefined) },
    });
    expect(t.calls).toEqual([expect.objectContaining({ function: "get_skill_content", input_arguments: { slug: "conformance-skill" } })]);
    expect(t.text).toContain("SKILL-BODY-41");
  });

  it("42 feedback: advertised, accepted with 2xx, and recorded", async () => {
    expect(advertisesFeedback(pickAgent(await fetchAgentsJson(url(42)), url(42)))).toBe(true);
    const file = process.env.OPENBB_EXAMPLE_FEEDBACK_FILE ?? "";
    const before = JSON.parse(await readFile(file, "utf8")) as unknown[];
    const t = await turn(42);
    const trace_id = crypto.randomUUID();
    await sendFeedback(url(42), { vote: "thumbs_down", tags: ["Other"], user_comment: "conformance", ai_response: t.text, user_prompt: "hi", trace_id });
    const after = JSON.parse(await readFile(file, "utf8")) as Array<Record<string, unknown>>;
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)).toMatchObject({ vote: "thumbs_down", tags: ["Other"], trace_id, user_prompt: "hi" });
  });
});
