// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment jsdom
// Live Rita (OPENBB_RITA_URL) arranging a real CSV table through describe_table /
// arrange_table against the real worker execution path (the mountCsv harness),
// driven as chatStore.send drives a turn. Part B's live acceptance check: Rita
// must arrange once, quote only engine numbers, and never sum a text column (the engine
// refuses it or she declines). Suite is gated on OPENBB_LIVE=1; scripts/rita-live-check.sh
// sets it and fails the run on any skip, so a skipped suite never counts as green.
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildWidgetRefs, executeFunction, makeWidgetDataFetcher, runAgentTool } from "../../lib/agent/execute";
import { LOCAL_TOOLS } from "../../lib/agent/localTools";
import { runAgentQuery } from "../../lib/agent/query";
import { liveWorkspaceOptions } from "./liveModel";
import { forcedSkills, skillsCatalog } from "../../lib/agent/skills";
import type { AgentMessage } from "../../lib/agent/types";
import { mountCsv } from "../../lib/agent/tableModel/testHarness";
import { bundledSkills } from "../../lib/skillsFiles";
import type { TableModelV1 } from "../../lib/tableModel/types";
import type { DashboardCard, WidgetDef } from "../../lib/types";
import { useAgentEditsStore } from "../../stores/agentEditsStore";
import { useDashboardStore } from "../../stores/dashboardStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { tableExecutionStore } from "../../stores/tableExecutionStore";
import { useWidgetRegistryStore } from "../../stores/widgetRegistryStore";
import { cardRequestSync } from "../../hooks/useCardRequest";

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (input: string | URL, init?: RequestInit) => globalThis.fetch(input, init),
}));
// Twelve rows: Region / Desk / Amount. Totals: East 360, North 210, West 615 (all distinct, none a row value).
const CSV =
  "Region,Desk,Amount\n" +
  "East,Rates,100\nEast,Credit,120\nEast,Macro,140\n" +
  "North,Rates,50\nNorth,Credit,70\nNorth,Macro,90\n" +
  "West,Rates,200\nWest,Credit,205\nWest,Macro,210\n" +
  "East,Rates,0\nNorth,Credit,0\nWest,Macro,0\n";
vi.mock("../../lib/localFiles", () => ({ readLocalFile: vi.fn(async () => new TextEncoder().encode(CSV)) }));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: Math.min(count, 8) }, (_, index) => ({ index, start: index * 28, end: index * 28 + 28, size: 28, key: index })),
    getTotalSize: () => count * 28,
    measureElement: () => undefined,
    scrollToIndex: () => undefined,
  }),
}));

const ritaUrl = process.env.OPENBB_RITA_URL ?? "";
// Forces the arrange-table skill the way the #322 authoring test forces build-dashboard: whether Rita picks the skill
// up unprompted is her side's routing, not this gate's subject.
const SKILL = process.env.RITA_LIVE_NO_SKILL === "1" ? "" : "/skill:arrange-table ";
const live = process.env.OPENBB_LIVE === "1" ? describe : describe.skip;

type Round = { tool: string; args: Record<string, unknown>; result: unknown };

const activeCards = (): DashboardCard[] => useDashboardStore.getState().activeDashboard()?.tabs.flatMap((t) => t.cards) ?? [];
const findWidget = (b: string, w: string): WidgetDef | undefined => useWidgetRegistryStore.getState().find(b, w);
const tableCard = () => useDashboardStore.getState().dashboards.find((d) => d.id === "rita")!.tabs[0].cards[0];

/** One turn wired as chatStore.send wires it: all LOCAL_TOOLS, real executeLocalTool. */
async function turn(text: string): Promise<{ rounds: Round[]; reply: string }> {
  const skills = bundledSkills();
  const rounds: Round[] = [];
  const localCall = async () => null; // no MCP server is configured: local tools only
  const deps = {
    // The real fetcher, as chatStore.send builds it: a local-file card has no data backend, so
    // get_widget_data refuses it and Rita is left with describe_table / arrange_table.
    fetchWidget: makeWidgetDataFetcher({ cards: activeCards(), backends: [], findWidget, keyMaintBackends: new Set(), request: (c, w, b) => cardRequestSync(c, w, b, undefined) }),
    runAgentTool: async (serverId: string, tool: string, args: Record<string, unknown>) => {
      const result = await runAgentTool(serverId, tool, args, [], [], localCall);
      rounds.push({ tool, args, result });
      console.log("[tool]", tool, JSON.stringify(args).slice(0, 300), "→", JSON.stringify(result).slice(0, 500));
      return result;
    },
    readSkill: (slug: string) => skills.find((s) => s.slug === slug && s.enabled),
  };
  const gen = runAgentQuery({
    ritaUrl,
    workspaceOptions: liveWorkspaceOptions,
    messages: [{ role: "human", content: text }],
    refresh: () => ({ primary: buildWidgetRefs(activeCards(), findWidget, () => "builtin", new Set()) }),
    tools: LOCAL_TOOLS,
    executeFunction: (payload, signal) => executeFunction(payload, deps, signal),
    skillsCatalog: skillsCatalog(skills),
    selectedSkills: forcedSkills(text, skills),
    timeoutMs: 180_000,
  });
  let reply = "";
  for (;;) {
    const next = await (gen as AsyncGenerator<unknown, AgentMessage[]>).next();
    if (next.done) break;
    const e = next.value as { type: string; delta?: string };
    if (e.type === "chunk") reply += e.delta ?? "";
  }
  console.log("[reply]", reply);
  return { rounds, reply };
}

/** Every number in `text`, commas and a trailing .0 removed. */
const numbersIn = (text: string): string[] =>
  (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "").replace(/\.0+$/, ""));

beforeEach(() => {
  useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, contextSharing: true } });
  useWidgetRegistryStore.getState().seedBuiltins();
  useAgentEditsStore.getState().clear();
});
afterEach(() => {
  cleanup();
  tableExecutionStore.disposeDashboard("rita");
  vi.unstubAllGlobals();
});

live("Rita arranges a CSV table through table-model/1", () => {
  it("totals Amount by Region in one applied arrange_table, quoting only engine numbers", async () => {
    await mountCsv();
    // An explicit change: arrange_table's description sends read-only asks ("show", "summarize") to mode
    // preview, and this test is about the applied arrangement (#35).
    const { rounds, reply } = await turn(`${SKILL}Group the table by Region with the total Amount.`);
    const arranges = rounds.filter((r) => r.tool === "arrange_table");
    expect(arranges, "exactly one arrange_table call").toHaveLength(1);
    const out = arranges[0].result as { status: string; preview: { rows: unknown[] } };
    expect(out.status).toBe("applied");
    const model = tableCard().tableDefinition?.analytical as TableModelV1 | undefined;
    expect(model?.layout.rows, "one Region category on rows").toHaveLength(1);
    expect(model?.categories.find((c) => c.id === model.layout.rows[0])?.sourceFieldId).toBe("Region");
    expect(model?.measures, "one Amount sum measure").toHaveLength(1);
    expect(model?.measures[0]).toMatchObject({ sourceFieldId: "Amount", aggregation: "sum" });
    // Rita's final text may quote only numbers the engine returned.
    const engine = new Set(numbersIn(JSON.stringify(out.preview.rows)));
    expect(engine.has("615") && engine.has("360") && engine.has("210"), "engine totals present in preview.rows").toBe(true);
    // arrange_table's description (capabilities.ts) lets Rita state the source row count, but only as
    // describe_table's exact completeness.totalRowCount; that number is an engine number too.
    for (const r of rounds.filter((r) => r.tool === "describe_table")) {
      const count = (r.result as { completeness?: { totalRowCount?: unknown } }).completeness?.totalRowCount;
      if (typeof count === "number") engine.add(String(count));
    }
    const quoted = numbersIn(reply);
    expect(quoted.length, "Rita's reply quotes at least one total").toBeGreaterThan(0);
    for (const n of quoted) expect(engine.has(n), `reply number ${n} is in preview.rows`).toBe(true);
  }, 300_000);

  // REVIEW WARNING (docs/releases/v6-assembly.md): restated from "the tool result is refused with validation-failed,
  // Rita's reply says so, and the model is unchanged" to its invariant. A model that declines in prose from the
  // advertised aggregations is the desired behaviour; the engine's text-sum refusal stays pinned by the unit tests.
  it("never sums the Region text column: the engine refuses it or Rita declines, and the model is unchanged", async () => {
    await mountCsv();
    const first = await turn(`${SKILL}Show total Amount by Region in the table.`);
    expect(first.rounds.some((r) => r.tool === "arrange_table")).toBe(true);
    const before = structuredClone(tableCard().tableDefinition);
    // Names the text column as the thing to sum: "Sum the Region column" was read as "sum Amount by Region".
    const { rounds, reply } = await turn(`${SKILL}Add up the Region column's own values (the region names, not Amount).`);
    const results = rounds.filter((r) => r.tool === "arrange_table").map((r) => r.result as { status: string; code?: string });
    expect(results.some((r) => r.status === "applied"), "no arrange applied").toBe(false);
    expect(tableCard().tableDefinition).toEqual(before);
    const text = reply.toLowerCase();
    if (results.some((r) => r.status === "refused" && r.code === "validation-failed")) {
      expect(text).toMatch(/refus|cannot|can't|can not|unable|not (?:possible|valid|supported)|text/);
    } else {
      // Declined without the tool refusing: the reply must say a text column cannot be summed.
      // Claude words it as "a text field ... can only be counted or min/maxed, not summed".
      expect(text, "reply says it cannot sum").toMatch(/cannot|can't|can not|unable|not (?:possible|supported|available|numeric|summ)|isn't (?:possible|supported|numeric)|(?:do|does)(?: not|n't) support|can only be/);
      expect(text, "reply says why: the column is text").toMatch(/text|non-numeric|not numeric|isn't numeric|categorical|string/);
      expect(text, "reply is about summing").toMatch(/sum/);
    }
  }, 300_000);
});
