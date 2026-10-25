// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment jsdom
// Live Rita (OPENBB_RITA_URL) driving the dashboard-authoring tools against
// in-memory stores — no backend needed, these tools touch built-ins and the
// stores only. The point is tool SELECTION: with the bdobb-local tools
// advertised, does Rita pick the right one and does the store change? Runs only
// when OPENBB_RITA_URL is set. Never in CI. The wiring is chatStore.send's.
//
// This suite once found that Rita could not add a widget it had not already
// seen (no catalog of what is addable). search_widgets closes that: the
// add-from-scratch chain below is search_widgets → add_widget →
// set_widget_params, all in one turn.
import { describe, expect, it, vi } from "vitest";
import { buildWidgetRefs, executeFunction, runAgentTool } from "../../lib/agent/execute";

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (input: string | URL, init?: RequestInit) => globalThis.fetch(input, init),
}));
import { LOCAL_TOOLS } from "../../lib/agent/localTools";
import { runAgentQuery } from "../../lib/agent/query";
import { forcedSkills, skillsCatalog } from "../../lib/agent/skills";
import type { AgentMessage, AgentStatus } from "../../lib/agent/types";
import { BUILTIN_WIDGETS } from "../../lib/builtins";
import { __resetJsonStoreForTests } from "../../lib/jsonStore";
import { __resetLoggerForTests } from "../../lib/logger";
import { bundledSkills } from "../../lib/skillsFiles";
import type { DashboardCard, WidgetDef } from "../../lib/types";
import { useAgentEditsStore } from "../../stores/agentEditsStore";
import { useDashboardStore } from "../../stores/dashboardStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useWidgetRegistryStore } from "../../stores/widgetRegistryStore";
import { __reset } from "../memfs";

const ritaUrl = process.env.OPENBB_RITA_URL ?? "";
const live = ritaUrl !== "" ? describe : describe.skip;

/** A fake chart widget with declared params, so add_widget/set_widget_params/
 * describe_widget have a real target with no backend behind it. */
const CHART: WidgetDef = {
  id: "equity_chart",
  backendId: "reference",
  name: "Equity Chart",
  description: "Price chart for one symbol.",
  type: "chart",
  category: "Equity",
  subCategory: "",
  endpoint: "/equity_chart",
  gridData: { w: 20, h: 12 },
  source: [],
  params: [
    { paramName: "symbol", label: "Symbol", type: "text", value: "AAPL" },
    {
      paramName: "interval",
      label: "Interval",
      value: "1d",
      options: [
        { label: "1 minute", value: "1m" },
        { label: "30 minutes", value: "30m" },
        { label: "Daily", value: "1d" },
      ],
    },
  ],
};

/** Modelled on the backend's equity_price_historical_yfinance_obb (issue #322):
 * the widget the build-dashboard skill has to find, add and configure. */
const YF_HISTORICAL: WidgetDef = {
  id: "equity_price_historical_yfinance_obb",
  backendId: "reference",
  name: "Equity Historical Price (yfinance)",
  description: "Historical OHLCV price data for an equity, from Yahoo Finance.",
  type: "table",
  category: "Equity",
  subCategory: "Price",
  endpoint: "/api/v1/equity/price/historical",
  gridData: { w: 20, h: 12 },
  source: ["Yahoo Finance"],
  params: [
    { paramName: "symbol", label: "Symbol", type: "text", value: "SPY" },
    {
      paramName: "interval",
      label: "Interval",
      value: "1d",
      options: [
        { label: "1 hour", value: "1h" },
        { label: "Daily", value: "1d" },
        { label: "Weekly", value: "1W" },
      ],
    },
  ],
};

type Round = { tool: string; args: Record<string, unknown>; result: unknown; flat?: boolean };

async function finish(gen: AsyncGenerator<unknown, AgentMessage[]>): Promise<{ text: string; statuses: AgentStatus[] }> {
  let text = "";
  const statuses: AgentStatus[] = [];
  for (;;) {
    const next = await gen.next();
    if (next.done) return { text, statuses };
    const e = next.value as { type: string; delta?: string; status?: AgentStatus };
    if (e.type === "chunk") text += e.delta ?? "";
    if (e.type === "status" && e.status) statuses.push(e.status);
  }
}

const findWidget = (b: string, w: string): WidgetDef | undefined =>
  useWidgetRegistryStore.getState().find(b, w);

const activeCards = (): DashboardCard[] =>
  useDashboardStore.getState().activeDashboard()?.tabs.flatMap((t) => t.cards) ?? [];

/** One turn, wired as chatStore.send wires it: all LOCAL_TOOLS, real executeLocalTool. */
async function turn(text: string, firstSaveFlat = false): Promise<{ rounds: Round[]; reply: string; statuses: AgentStatus[] }> {
  const skills = bundledSkills();
  const rounds: Round[] = [];
  const deps = {
    fetchWidget: async () => ({ data: [] as unknown[], url: "", params: {} as Record<string, string> }),
    runAgentTool: async (serverId: string, tool: string, args: Record<string, unknown>) => {
      const localCall = async () => null; // no MCP server is configured: local tools only
      // Replays the slip from the 12-tab run on v6.2.0 (no set_markdown_content
      // then): the first set_widget_params goes out with its params beside
      // card_id instead of nested under params.
      if (firstSaveFlat && tool === "set_widget_params" && !rounds.some((r) => r.flat)) {
        // Keep a flat payload even when the model's first proposed params are empty.
        // Empty text is a fixture sentinel, never a successful saved answer.
        const flatArgs = { card_id: args.card_id, text: "", ...(args.params as Record<string, unknown>) };
        const result = await runAgentTool(serverId, "set_widget_params", flatArgs, [], [], localCall);
        rounds.push({ tool: "set_widget_params", args: flatArgs, result, flat: true });
        console.log("[tool:flat]", JSON.stringify(flatArgs).slice(0, 200), "→", JSON.stringify(result).slice(0, 300));
        return result;
      }
      // No AbortSignal here: the signal parameter ExecuteDeps declares has
      // nothing to pass it to.
      const result = await runAgentTool(serverId, tool, args, [], [], localCall);
      rounds.push({ tool, args, result });
      console.log("[tool]", tool, JSON.stringify(args).slice(0, 300), "→", JSON.stringify(result).slice(0, 400));
      return result;
    },
    readSkill: (slug: string) => skills.find((s) => s.slug === slug && s.enabled),
  };
  const gen = runAgentQuery({
    ritaUrl,
    messages: [{ role: "human", content: text }],
    // As chatStore.send: every round re-reads the board, so a card Rita just
    // wrote reaches her with its new text (#326).
    refresh: () => ({ primary: buildWidgetRefs(activeCards(), findWidget, () => "builtin", new Set()) }),
    // This targeted recovery case must update the existing note, not create a
    // replacement with add_note or bypass the injected operation through another tool.
    tools: firstSaveFlat ? LOCAL_TOOLS.filter((t) => ["describe_widget", "set_widget_params"].includes(t.name)) : LOCAL_TOOLS,
    executeFunction: (payload, signal) => {
      console.log("[call]", JSON.stringify(payload).slice(0, 400));
      return executeFunction(payload, deps, signal);
    },
    skillsCatalog: skillsCatalog(skills),
    selectedSkills: forcedSkills(text, skills),
    timeoutMs: 180_000,
  });
  // Drain, collecting rounds via the deps closure above.
  const out = await finish(gen);
  return { rounds, reply: out.text, statuses: out.statuses };
}

async function reset(): Promise<string> {
  __reset();
  // The harness sends widget refs, i.e. Context sharing is on (as in chatStore).
  useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, contextSharing: true } });
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  useAgentEditsStore.setState({ entries: [] });
  useDashboardStore.setState({ dashboards: [], activeId: null, previousId: null, activeTabIds: {}, maximizedCardId: null, viewer: false });
  useWidgetRegistryStore.setState({ widgets: [...BUILTIN_WIDGETS, CHART, YF_HISTORICAL] });
  await useDashboardStore.getState().load(); // seeds "Main"
  const clock = BUILTIN_WIDGETS.find((w) => w.id === "clock")!;
  const cardId = (await useDashboardStore.getState().addCard(clock)) as string;
  await useDashboardStore.getState().patchCardField(cardId, "title", "World Clock");
  return cardId;
}

/** Adds an Equity Chart card (symbol AAPL) and returns its id. */
async function addChart(): Promise<string> {
  const id = (await useDashboardStore.getState().addCard(CHART, { symbol: "AAPL", interval: "1d" })) as string;
  return id;
}

/** A second dashboard named `name`, leaving Main active. */
async function addDashboard(name: string): Promise<string> {
  const active = useDashboardStore.getState().activeId!;
  const id = (await useDashboardStore.getState().addDashboard(name)) as string;
  useDashboardStore.getState().setActive(active);
  return id;
}

const chartCards = (): DashboardCard[] => activeCards().filter((c) => c.widgetId === "equity_chart");

live("Rita authors a dashboard", () => {
  it("adds a note when asked to write findings onto the board", async () => {
    await reset();
    const { rounds } = await turn("Add a note to my dashboard that says: Q3 review — revenue up 4%.");
    expect(rounds.map((r) => r.tool)).toContain("add_note");
    const notes = activeCards().filter((c) => c.widgetId === "markdown" || c.widgetId === "note");
    expect(notes.length).toBeGreaterThan(0);
    expect(String(notes[0].params.text).toLowerCase()).toContain("revenue");
  }, 200_000);

  it("renames the dashboard when asked", async () => {
    await reset();
    const { rounds } = await turn("Rename this dashboard to Portfolio.");
    expect(rounds.map((r) => r.tool)).toContain("rename_dashboard");
    expect(useDashboardStore.getState().activeDashboard()!.name).toBe("Portfolio");
  }, 200_000);

  it("removes a widget by name", async () => {
    await reset();
    const { rounds } = await turn("Remove the World Clock widget from my dashboard.");
    expect(rounds.map((r) => r.tool)).toContain("remove_widget");
    expect(activeCards().some((c) => c.title === "World Clock")).toBe(false);
  }, 200_000);

  it("discovers, adds and configures a widget in one turn", async () => {
    await reset(); // Equity Chart is in the registry but not on the board
    const { rounds } = await turn("Add an Equity Chart to my dashboard for NVDA with 30-minute bars.");
    const tools = rounds.map((r) => r.tool);
    expect(tools).toContain("search_widgets");
    expect(tools).toContain("add_widget");
    // add_widget can apply these parameters atomically; a separate set call is optional.
    const chart = chartCards()[0];
    expect(chart, "a chart card was added").toBeDefined();
    expect(String(chart.params.symbol).toUpperCase()).toBe("NVDA");
    expect(chart.params.interval).toBe("30m");
  }, 240_000);


  it("authors from an empty board under /skill:build-dashboard, persists, and undoes (#322)", async () => {
    await reset();
    await useDashboardStore.getState().removeCard(activeCards()[0].id); // the empty board of the report
    useAgentEditsStore.setState({ entries: [] });
    const { rounds } = await turn(
      "/skill:build-dashboard Add a Yahoo Finance (yfinance) daily historical price widget for AAPL to this dashboard. Find the real widget in the connected backend, configure its declared parameters, and add it yourself.",
    );
    const tools = rounds.map((r) => r.tool);
    expect(tools).toContain("search_widgets");
    expect(tools).toContain("add_widget");
    const yf = () => activeCards().filter((c) => c.widgetId === YF_HISTORICAL.id);
    expect(yf(), "the yfinance card was added").toHaveLength(1);
    expect(String(yf()[0].params.symbol).toUpperCase()).toBe("AAPL");
    expect(yf()[0].params.interval).toBe("1d");
    // Persisted: a fresh load from disk sees the same card and params.
    useDashboardStore.setState({ dashboards: [], activeId: null });
    await useDashboardStore.getState().load();
    expect(String(yf()[0]?.params.symbol).toUpperCase()).toBe("AAPL");
    // Undo every agent edit of the turn, newest first: the board is empty again.
    while (useAgentEditsStore.getState().entries.length > 0) await useAgentEditsStore.getState().undoLast();
    expect(yf()).toHaveLength(0);
  }, 240_000);

  it("writes an answer into the note on each of twelve tabs: every card saved exactly once (#326)", async () => {
    await reset();
    const note = BUILTIN_WIDGETS.find((w) => w.id === "note")!;
    const topics = ["Rates", "Inflation", "Jobs", "Growth", "Housing", "Credit", "Equities", "Dollar", "Oil", "Gold", "Volatility", "Earnings"];
    for (const name of topics) {
      const dashId = useDashboardStore.getState().activeId!;
      const tabId = (await useDashboardStore.getState().addTab(dashId, name))!;
      const id = (await useDashboardStore.getState().addCardTo(dashId, tabId, note, { text: "" })) as string;
      await useDashboardStore.getState().patchCardField(id, "title", `${name} answer`);
    }
    useAgentEditsStore.setState({ entries: [] });
    const { rounds } = await turn(
      `Each of my ${topics.join(", ")} tabs has an empty note titled '<tab> answer'. Write a one-sentence answer ` +
        "into each note: what the topic is and one indicator that tracks it.",
    );
    const tabs = useDashboardStore.getState().activeDashboard()!.tabs;
    // Three tabs besides Main, one note each.
    expect(topics.every((t) => tabs.find((x) => x.name === t)?.cards.some((c) => c.title === `${t} answer`))).toBe(true);
    const notes = topics.map((t) => activeCards().find((c) => c.title === `${t} answer`)!);
    for (const n of notes) expect(String(n.params.text ?? "").trim().length, `${n.title} was saved`).toBeGreaterThan(0);
    // Every refused save was retried until it landed: no note left empty above,
    // and no refusal was the last word on any card.
    const saves = rounds.filter((r) => r.tool === "set_markdown_content" || r.tool === "set_widget_params");
    const lastPerCard = new Map(saves.map((r) => [String(r.args.card_id), r.result as Record<string, unknown>]));
    for (const n of notes) expect(lastPerCard.get(n.id)?.updated, `${n.title}'s last save`).toBe(true);
    // #326's pass condition: every chosen call executed once, none re-issued
    // to make up for one Rita dropped.
    for (const n of notes) expect(saves.filter((r) => r.args.card_id === n.id), `${n.title} writes`).toHaveLength(1);
  }, 600_000);

  it("recovers from a save refused for flat params: retries, and the note is saved", async () => {
    await reset();
    const note = BUILTIN_WIDGETS.find((w) => w.id === "note")!;
    const id = (await useDashboardStore.getState().addCard(note, { text: "" })) as string;
    await useDashboardStore.getState().patchCardField(id, "title", "Answer");
    const { rounds, statuses } = await turn("Write a one-sentence definition of inflation into the note titled Answer.", true);
    console.log("[statuses]", JSON.stringify(statuses.map((st) => [st.eventType, st.message])));
    // Rita's own status for the refused call names it an error (from the typed
    // error item), not "completed"; she sends no ERROR of her own for it.
    expect(statuses.some((st) => st.eventType === "WARNING" && /set_widget_params returned an error$/.test(st.message))).toBe(true);
    expect(statuses.some((st) => st.eventType === "ERROR")).toBe(false);
    const refused = rounds.find((r) => r.flat);
    expect(refused?.result, "the first save was refused").toMatchObject({ error: { code: "PARAMS_NOT_NESTED" } });
    const after = rounds.slice(rounds.indexOf(refused!) + 1);
    expect(after.some((r) => r.tool === "set_widget_params" && r.args.card_id === id &&
      (r.result as Record<string, unknown>)?.updated === true), "a retry saved the original note").toBe(true);
    expect(String(activeCards().find((c) => c.id === id)!.params.text ?? "").toLowerCase()).toContain("inflation");
  }, 240_000);

  it("reconfigures an existing chart", async () => {
    await reset();
    await addChart(); // symbol AAPL, on the board and in context
    const { rounds } = await turn("Change the chart to MSFT.");
    expect(rounds.map((r) => r.tool)).toContain("set_widget_params");
    expect(String(chartCards()[0].params.symbol).toUpperCase()).toBe("MSFT");
  }, 240_000);


  it("duplicates a card from a 'make a copy' phrasing", async () => {
    await reset();
    const { rounds } = await turn("Make a copy of the World Clock.");
    expect(rounds.map((r) => r.tool)).toContain("duplicate_widget");
    expect(activeCards().filter((c) => c.widgetId === "clock").length).toBe(2);
  }, 200_000);

  it("adds a tab", async () => {
    await reset();
    const { rounds } = await turn("Add a tab called Rates.");
    expect(rounds.map((r) => r.tool)).toContain("add_tab");
    expect(useDashboardStore.getState().activeDashboard()!.tabs.some((t) => t.name === "Rates")).toBe(true);
  }, 200_000);

  it("navigates to another dashboard by name", async () => {
    await reset();
    const macroId = await addDashboard("Macro");
    const { rounds } = await turn("Open my Macro dashboard.");
    expect(rounds.map((r) => r.tool)).toContain("navigate");
    expect(useDashboardStore.getState().activeId).toBe(macroId);
  }, 200_000);

  it("moves/resizes a card on an explicit instruction", async () => {
    await reset();
    const { rounds } = await turn("Make the World Clock 12 columns wide.");
    expect(rounds.map((r) => r.tool)).toContain("move_widget");
    expect(activeCards().find((c) => c.title === "World Clock")!.layout.w).toBe(12);
  }, 200_000);
});
