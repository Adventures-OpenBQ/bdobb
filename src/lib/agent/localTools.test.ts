// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, it, expect } from "vitest";
import { LOCAL_TOOL_SERVER_ID, LOCAL_TOOLS, resolveWidgetMatch, executeLocalTool } from "./localTools";
import type { DashboardCard, WidgetDef } from "../types";
import { __read, __reset } from "../../test/memfs";
import { widget } from "../../test/fixtures";
import { DOCKS_ID } from "../dashboardsFile";
import { __resetJsonStoreForTests } from "../jsonStore";
import { __resetLoggerForTests } from "../logger";
import { useAgentEditsStore } from "../../stores/agentEditsStore";
import { useDashboardStore } from "../../stores/dashboardStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useWidgetRegistryStore } from "../../stores/widgetRegistryStore";
import { useWorkspacesStore } from "../../stores/workspacesStore";

// The card tools below act on cards the user placed, which Rita may only
// reach with Context sharing on (review A8); the off case is tested on its own.
beforeEach(() => useSettingsStore.setState((s) => ({ settings: { ...s.settings, contextSharing: true } })));

const widgets = [
  { id: "historical_prices", name: "Historical Prices" },
  { id: "company-news", name: "Company News" },
] as unknown as WidgetDef[];
const resolveWidgetId = (named: string, widgets: WidgetDef[]) => resolveWidgetMatch(named, widgets)?.def.id ?? null;

describe("the local tool declaration", () => {
  it("uses the reserved server id", () => {
    expect(LOCAL_TOOL_SERVER_ID).toBe("bdobb-local");
  });

  it("declares the full dashboard-authoring tool set", () => {
    // Tools are flat and single-purpose (the model is local, and accuracy falls
    // with argument depth). The set grew to cover full dashboard authoring —
    // add, configure, remove, annotate, arrange, navigate — at the cost of a
    // longer list; watch tool-calling accuracy and consolidate if it slips.
    // One tool the same commit adds on main is a later line's and absent here:
    // propose_chart_levels (no chart levels for it to act on before v12).
    // pin_card lands with v8 (donor 85841963), where a card first has a pinned
    // edge and the store first has pinCard: clean's 18th local tool.
    // REVIEW (v8 Part C, C3): this list and the "all 18" one below gain
    // pin_card, in main's position; nothing else changed.
    expect(LOCAL_TOOLS.map((t) => t.name)).toEqual([
      "create_dashboard",
      "add_widget",
      "describe_table",
      "arrange_table",
      "set_widget_params",
      "set_markdown_content",
      "remove_widget",
      "add_note",
      "navigate",
      "describe_widget",
      "add_tab",
      "rename_tab",
      "rename_widget",
      "rename_dashboard",
      "move_widget",
      "duplicate_widget",
      "pin_card",
      "search_widgets",
    ]);
  });

  it("add_widget advertises an optional params object and tells the model to pass required ones", () => {
    const add = LOCAL_TOOLS.find((t) => t.name === "add_widget")!;
    const props = add.input_schema.properties as Record<string, { type?: string }>;
    expect(props.params?.type).toBe("object");
    expect(add.input_schema.required).toEqual(["widget_id"]);
    expect(add.description).toMatch(/params/);
    expect(add.description).toMatch(/symbol/);
  });

  it("carries all 18 bdobb-local tools with table-model/1 table schemas", () => {
    expect(LOCAL_TOOLS.map(t => t.name).sort()).toEqual(["add_note", "add_tab", "add_widget", "arrange_table", "create_dashboard", "describe_table", "describe_widget", "duplicate_widget", "move_widget", "navigate", "pin_card", "remove_widget", "rename_dashboard", "rename_tab", "rename_widget", "search_widgets", "set_markdown_content", "set_widget_params"]);
    const arrange = LOCAL_TOOLS.find(t => t.name === "arrange_table")!;
    expect(arrange.input_schema.required).toEqual(["card_id", "expected_revision", "arrangement"]);
    expect(JSON.stringify(arrange)).toContain("table-model/1");
    expect(JSON.stringify(arrange)).not.toMatch(/grouping|split|buckets|aggregationFns/);
    const describe = LOCAL_TOOLS.find(t => t.name === "describe_table")!;
    expect(Object.keys(describe.input_schema.properties as object)).toEqual(["card_id", "section", "scope", "fields", "cursor", "search"]);
    expect(describe.input_schema.required).toEqual(["card_id"]);
    expect(describe.description).toContain("server-execution-pending");
    expect(arrange.description).toMatch(/expected_revision/);
    // V9-P2: the provider's aggregation hint is described and a contradiction is warned about.
    expect(describe.description).toMatch(/hint, suggested and suggestion_note/);
    expect(arrange.description).toContain("provider-aggregation-hint");
    expect(arrange.description).toContain("aggregation_intent");
    expect(arrange.description).toContain("user_override");
    // Task 12 minors + the roles a 35B model kept confusing live.
    for (const must of ["recalculating", "revision null", "busy", "timeout", "calculation-failed", "validation-failed", "linked", "ids", "category.add", "measure.add", "never field ids", "preview.rows", "grand total", "row count"]) expect(arrange.description, must).toContain(must);
    for (const must of ["how_to_arrange", "unavailable"]) expect(describe.description, must).toContain(must);
    // D-012: a read-only ask previews; nothing commits.
    expect((arrange.input_schema.properties as Record<string, { enum?: string[] }>).mode.enum).toEqual(["apply", "preview"]);
    for (const must of ["mode \"preview\"", "previewed", "committed false", "summarize", "totalRowCount"]) expect(arrange.description, must).toContain(must);
  });

  it("gives every tool the reserved server id and an object schema", () => {
    for (const tool of LOCAL_TOOLS) {
      expect(tool.server_id).toBe(LOCAL_TOOL_SERVER_ID);
      expect(tool.input_schema.type).toBe("object");
    }
  });
});

describe("resolveWidgetId", () => {
  it("matches an exact id", () => {
    expect(resolveWidgetId("historical_prices", widgets)).toBe("historical_prices");
  });

  it("matches case-insensitively", () => {
    expect(resolveWidgetId("HISTORICAL_PRICES", widgets)).toBe("historical_prices");
  });

  it("matches by display name", () => {
    // A model asked to "add the historical prices widget" reliably produces a
    // plausible id rather than an exact one.
    expect(resolveWidgetId("Historical Prices", widgets)).toBe("historical_prices");
  });

  it("matches ignoring underscores and hyphens", () => {
    expect(resolveWidgetId("historicalprices", widgets)).toBe("historical_prices");
    expect(resolveWidgetId("company_news", widgets)).toBe("company-news");
  });

  it("returns null when nothing plausibly matches", () => {
    expect(resolveWidgetId("nonsense", widgets)).toBeNull();
  });

  it("prefers a case-insensitive id match over a display-name match on an earlier widget", () => {
    // widget[0]'s NAME and widget[1]'s ID both match "news". The correct
    // ladder tries case-insensitive id across ALL widgets before falling to
    // display name, so it returns "News" (widget[1]'s id). A single combined
    // `find` over ci-id/name/loose stops at the first widget matching ANY
    // rung and returns "x" (widget[0]'s id, via its name) instead.
    const both = [
      { id: "x", name: "News" },
      { id: "News", name: "Other" },
    ] as unknown as WidgetDef[];
    expect(resolveWidgetId("news", both)).toBe("News");
  });

  it("prefers an exact id over a looser match", () => {
    // Both widgets match "news": the first by display NAME, the second by
    // exact id. The name-matching one is listed first, so an implementation
    // that returns the first widget matching on ANY rung yields "b" — only
    // one that tries exact across all widgets BEFORE falling to name
    // returns "news".
    const both = [
      { id: "b", name: "news" },
      { id: "news", name: "Other" },
    ] as unknown as WidgetDef[];
    expect(resolveWidgetId("news", both)).toBe("news");
  });
});

describe("executeLocalTool", () => {
  beforeEach(async () => {
    __reset();
    __resetLoggerForTests();
    __resetJsonStoreForTests();
    useAgentEditsStore.setState({ entries: [] });
    useDashboardStore.setState({
      dashboards: [],
      activeId: null,
      previousId: null,
      activeTabIds: {},
      maximizedCardId: null,
      viewer: false,
    });
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "historical_prices", name: "Historical Prices", backendId: "reference" })],
    });
    await useDashboardStore.getState().load(); // seeds "Main"
  });

  it("create_dashboard creates it, adds resolved widgets, and records an undo", async () => {
    const result = await executeLocalTool("create_dashboard", {
      name: "Prices",
      widget_ids: ["Historical Prices", "nope"],
    });
    expect(result).toMatchObject({
      created: true,
      added: ["historical_prices"],
      unresolved: [{ requested: "nope", suggestions: [] }],
      dashboard: { name: "Prices" },
    });
    expect((result.dashboard as { tab_id: unknown }).tab_id).toEqual(expect.any(String));
    const id = result.dashboard_id as string;
    const dash = useDashboardStore.getState().dashboards.find((d) => d.id === id);
    expect(dash?.name).toBe("Prices");
    expect(dash?.tabs[0].cards).toHaveLength(1);
    const edits = useAgentEditsStore.getState().entries;
    expect(edits.map((e) => e.summary)).toEqual(['Rita created dashboard "Prices"']);
    await useAgentEditsStore.getState().undoLast();
    expect(useDashboardStore.getState().dashboards.some((d) => d.id === id)).toBe(false);
  });

  it("create_dashboard rejects a blank name", async () => {
    expect(await executeLocalTool("create_dashboard", { name: "  " })).toEqual({
      error: { code: "MISSING_NAME", message: "name must be a non-empty string" },
    });
  });

  it("add_widget targets a named dashboard, else the active one, and undo removes the card", async () => {
    const main = useDashboardStore.getState().activeDashboard();
    const result = await executeLocalTool("add_widget", { widget_id: "historical_prices" });
    expect(result).toMatchObject({ added: true, dashboard_id: main?.id });
    const cards = useDashboardStore.getState().activeDashboard()?.tabs[0].cards ?? [];
    expect(cards).toHaveLength(1);
    expect(useAgentEditsStore.getState().entries[0].summary).toBe('Rita added "Historical Prices" to "Main"');
    await useAgentEditsStore.getState().undoLast();
    expect(useDashboardStore.getState().activeDashboard()?.tabs[0].cards).toHaveLength(0);
  });

  it("add_widget reports an unknown widget or dashboard", async () => {
    expect(await executeLocalTool("add_widget", { widget_id: "nope" })).toEqual({
      error: { code: "UNKNOWN_WIDGET", message: "no widget matches nope", requested: "nope", suggestions: [] },
    });
    expect(await executeLocalTool("add_widget", { widget_id: "historical_prices", dashboard_name: "Zzz" })).toEqual({
      error: { code: "UNKNOWN_DASHBOARD", message: "no dashboard named Zzz", requested: "Zzz", available: ["Main"] },
    });
  });

  it("returns unsupported for anything else", async () => {
    expect(await executeLocalTool("delete_everything", {})).toEqual({
      error: { code: "UNSUPPORTED", message: "unsupported tool delete_everything" },
    });
  });

  it("refuses a name over 60 characters with its length", async () => {
    expect(await executeLocalTool("create_dashboard", { name: "x".repeat(61) })).toEqual({
      error: { code: "NAME_TOO_LONG", message: "name must be at most 60 characters", got: 61 },
    });
  });

  it("refuses a missing widget id", async () => {
    expect(await executeLocalTool("add_widget", {})).toEqual({
      error: { code: "MISSING_WIDGET", message: "widget_id must be a non-empty string" },
    });
  });

  it("suggests widgets whose id or name shares a word with the request", async () => {
    const r = (await executeLocalTool("add_widget", { widget_id: "prices chart" })) as {
      error: { suggestions: string[] };
    };
    expect(r.error.suggestions).toEqual(["historical_prices"]);
  });

  it("reports how the widget was matched and the tab it landed on", async () => {
    const r = await executeLocalTool("add_widget", { widget_id: "Historical Prices" });
    expect(r).toMatchObject({ added: true, widget_id: "historical_prices", matched_via: "name" });
    expect(r.tab_id).toEqual(expect.any(String));
  });

  // D-017: Rita added a historical-prices card with no symbol and reported
  // success, because add_widget could not set params.
  const chartDef = () =>
    widget({
      id: "chart",
      name: "Chart",
      backendId: "reference",
      params: [{ paramName: "symbol", type: "text" }, { paramName: "interval", options: [{ label: "1d", value: "1d" }] }],
    });

  it("add_widget applies params through set_widget_params and reports them", async () => {
    useWidgetRegistryStore.setState({ widgets: [chartDef()] });
    const r = await executeLocalTool("add_widget", { widget_id: "chart", params: { symbol: "AAPL", interval: "1d" } });
    expect(r).toMatchObject({ added: true, params: { applied: ["symbol", "interval"] } });
    const card = useDashboardStore.getState().activeDashboard()!.tabs[0].cards.find((c) => c.id === r.card_id)!;
    expect(card.params).toMatchObject({ symbol: "AAPL", interval: "1d" });
  });

  it("add_widget still adds the card on a bad param and reports what was refused and why", async () => {
    useWidgetRegistryStore.setState({ widgets: [chartDef()] });
    const r = (await executeLocalTool("add_widget", { widget_id: "chart", params: { symbol: "AAPL", ticker: "X" } })) as Record<string, unknown>;
    expect(r).toMatchObject({ added: true, params: { applied: [], refused: ['unknown param "ticker"'], valid_params: ["symbol", "interval"] } });
    expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards).toHaveLength(1);
  });

  // #40 (V6-004): the live call was add_widget {widget_id, params: {symbol: "AAPL"}} for a
  // table-type yfinance widget, then Rita said she added a chart; no tool could set the view.
  it("add_widget sets the card's view through set_widget_params, and Undo restores the default view (#40)", async () => {
    useWidgetRegistryStore.setState({ widgets: [chartDef()] });
    const r = await executeLocalTool("add_widget", { widget_id: "chart", params: { symbol: "AAPL" }, view: "chart" });
    expect(r).toMatchObject({ added: true, params: { applied: ["symbol"] }, view: "chart" });
    const card = () => useDashboardStore.getState().activeDashboard()!.tabs[0].cards.find((c) => c.id === r.card_id)!;
    expect(card().view).toBe("chart");
    await useAgentEditsStore.getState().undoLast();
    expect(card().view).toBeUndefined();
  });

  it("add_widget refuses a view the widget cannot offer, still adds the card, and says why (#40)", async () => {
    useWidgetRegistryStore.setState({ widgets: [widget({ id: "page", name: "Page", backendId: "reference", type: "iframe" })] });
    const r = (await executeLocalTool("add_widget", { widget_id: "page", view: "chart" })) as Record<string, unknown>;
    expect(r).toMatchObject({ added: true, view: { refused: ['view "chart" must be one of: default'] } });
    expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0].view).toBeUndefined();
  });

  it("add_widget reports params that are not an object as refused reasons, as strings", async () => {
    useWidgetRegistryStore.setState({ widgets: [chartDef()] });
    const r = (await executeLocalTool("add_widget", { widget_id: "chart", params: "AAPL" })) as { added: boolean; params: { applied: string[]; refused: unknown[] } };
    expect(r.added).toBe(true);
    expect(r.params.applied).toEqual([]);
    expect(r.params.refused).toEqual([expect.stringContaining("params must be a non-empty object")]);
  });
});

describe("resolveWidgetMatch", () => {
  it("names the rule that matched", () => {
    expect(resolveWidgetMatch("historical_prices", widgets)).toMatchObject({
      def: { id: "historical_prices" },
      matchedVia: "id",
    });
    expect(resolveWidgetMatch("HISTORICAL_PRICES", widgets)).toMatchObject({
      def: { id: "historical_prices" },
      matchedVia: "id_case",
    });
    expect(resolveWidgetMatch("historical prices", widgets)).toMatchObject({
      def: { id: "historical_prices" },
      matchedVia: "name",
    });
    expect(resolveWidgetMatch("company news", widgets)).toMatchObject({ def: { id: "company-news" } });
    expect(resolveWidgetMatch("nothing", widgets)).toBeNull();
  });

  it("set_widget_params sets valid params, and undo restores the originals", async () => {
    const def = widget({
      id: "chart",
      name: "Chart",
      backendId: "reference",
      params: [
        { paramName: "symbol", type: "text" },
        { paramName: "interval", options: [{ label: "30m", value: "30m" }, { label: "1d", value: "1d" }] },
      ],
    });
    useWidgetRegistryStore.setState({ widgets: [def] });
    const cardId = (await useDashboardStore.getState().addCard(def, { symbol: "AAPL" })) as string;
    const card = () => useDashboardStore.getState().activeDashboard()!.tabs[0].cards.find((c) => c.id === cardId)!;
    const before = { ...card().params };

    const ok = await executeLocalTool("set_widget_params", { card_id: cardId, params: { symbol: "MSFT", interval: "30m" } });
    expect(ok).toMatchObject({ updated: true, card_id: cardId, applied: ["symbol", "interval"] });
    expect(card().params).toMatchObject({ symbol: "MSFT", interval: "30m" });

    await useAgentEditsStore.getState().undoLast();
    expect(card().params).toEqual(before);
  });

  it("set_widget_params refuses an unknown param name or an out-of-range option, whole", async () => {
    const def = widget({
      id: "chart",
      name: "Chart",
      backendId: "reference",
      params: [{ paramName: "symbol", type: "text" }, { paramName: "interval", options: [{ label: "30m", value: "30m" }] }],
    });
    useWidgetRegistryStore.setState({ widgets: [def] });
    const cardId = (await useDashboardStore.getState().addCard(def, { symbol: "AAPL" })) as string;

    const unknown = (await executeLocalTool("set_widget_params", { card_id: cardId, params: { ticker: "MSFT" } })) as Record<string, unknown>;
    expect(unknown).toMatchObject({ error: "params refused", problems: ['unknown param "ticker"'] });
    expect(unknown.valid_params).toEqual(["symbol", "interval"]);

    const badOpt = (await executeLocalTool("set_widget_params", { card_id: cardId, params: { interval: "5s" } })) as Record<string, unknown>;
    expect(badOpt.error).toBe("params refused");
    expect((badOpt.problems as string[])[0]).toContain("interval");

    // A refused call changes nothing.
    const card = useDashboardStore.getState().activeDashboard()!.tabs[0].cards.find((c) => c.id === cardId)!;
    expect(card.params).toEqual({ symbol: "AAPL" });
  });

  // Review S-lib-3: the pieces were validated trimmed, but the raw spaced
  // string was what got stored.
  it("set_widget_params stores a spaced multiSelect value as the trimmed pieces it validated", async () => {
    const def = widget({
      id: "screen",
      name: "Screen",
      backendId: "reference",
      params: [{ paramName: "fields", multiSelect: true, options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] }],
    });
    useWidgetRegistryStore.setState({ widgets: [def] });
    const cardId = (await useDashboardStore.getState().addCard(def, {})) as string;
    expect(await executeLocalTool("set_widget_params", { card_id: cardId, params: { fields: "a, b" } })).toMatchObject({ updated: true });
    expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards.find((c) => c.id === cardId)!.params.fields).toBe("a,b");
  });

  // v4 calendar-qualified expressions: a date value goes through the card's resolver (fieldContext) as the params will
  // stand, and one it rejects is refused whole, as sendParams refuses it on the wire.
  it("set_widget_params refuses a date the calendar resolver rejects and accepts a qualified one", async () => {
    const def = widget({
      id: "px",
      name: "Prices",
      backendId: "reference",
      params: [{ paramName: "symbol", type: "text" }, { paramName: "start_date", type: "date" }],
    });
    useWidgetRegistryStore.setState({ widgets: [def] });
    const cardId = (await useDashboardStore.getState().addCard(def, { symbol: "VOD.L", start_date: "T-5bd" })) as string;
    const card = () => useDashboardStore.getState().activeDashboard()!.tabs[0].cards.find((c) => c.id === cardId)!;
    expect(await executeLocalTool("set_widget_params", { card_id: cardId, params: { start_date: "T-1bd(XNYZ)" } })).toMatchObject({
      error: "params refused",
      problems: ['param "start_date": Unknown calendar XNYZ'],
    });
    expect(await executeLocalTool("set_widget_params", { card_id: cardId, params: { start_date: "T@open" } })).toMatchObject({
      error: "params refused",
      problems: ['param "start_date": @ needs a date-and-time parameter'],
    });
    expect(card().params.start_date).toBe("T-5bd");
    expect(await executeLocalTool("set_widget_params", { card_id: cardId, params: { start_date: "T-1bd(XLON)" } })).toMatchObject({
      updated: true,
    });
    expect(card().params.start_date).toBe("T-1bd(XLON)");
  });

  it("set_widget_params sets only the view, refuses an unknown one whole, and default clears it (#40)", async () => {
    const def = widget({ id: "chart", name: "Chart", backendId: "reference", params: [{ paramName: "symbol", type: "text" }] });
    useWidgetRegistryStore.setState({ widgets: [def] });
    const cardId = (await useDashboardStore.getState().addCard(def, { symbol: "AAPL" })) as string;
    const card = () => useDashboardStore.getState().activeDashboard()!.tabs[0].cards.find((c) => c.id === cardId)!;
    expect(await executeLocalTool("set_widget_params", { card_id: cardId, view: "chart" })).toMatchObject({ updated: true, applied: [], view: "chart" });
    expect(card().view).toBe("chart");
    expect(await executeLocalTool("set_widget_params", { card_id: cardId, params: { symbol: "MSFT" }, view: "pie" })).toMatchObject({
      error: "params refused",
      problems: [expect.stringContaining('view "pie" must be one of: default, chart')],
    });
    expect(card().params.symbol).toBe("AAPL");
    expect(await executeLocalTool("set_widget_params", { card_id: cardId, view: "default" })).toMatchObject({ updated: true, view: "default" });
    expect(card().view).toBeUndefined();
    await useAgentEditsStore.getState().undoLast();
    expect(card().view).toBe("chart");
  });

  it("set_widget_params rejects a missing card or empty params", async () => {
    useWidgetRegistryStore.setState({ widgets: [widget({ id: "chart", backendId: "reference" })] });
    const cardId = (await useDashboardStore.getState().addCard(widget({ id: "chart", backendId: "reference" }))) as string;
    expect(await executeLocalTool("set_widget_params", { card_id: "nope", params: { symbol: "X" } })).toEqual({ error: "unknown card nope" });
    expect(await executeLocalTool("set_widget_params", { card_id: cardId, params: {} })).toMatchObject({ error: { code: "MISSING_PARAMS" } });
  });

  it("set_widget_params answers params sent beside card_id with the corrected call, and saves nothing", async () => {
    const def = widget({ id: "note", backendId: "builtin", type: "note", params: [{ paramName: "text", type: "text" }] });
    useWidgetRegistryStore.setState({ widgets: [def] });
    const cardId = (await useDashboardStore.getState().addCard(def, { text: "old" })) as string;
    useAgentEditsStore.setState({ entries: [] }); // earlier tests' edits linger in the store
    const res = await executeLocalTool("set_widget_params", { card_id: cardId, text: "Answer" });
    expect(res).toMatchObject({
      error: { code: "PARAMS_NOT_NESTED", received_keys: ["text"], retry_with: { card_id: cardId, params: { text: "Answer" } } },
    });
    expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards.find((c) => c.id === cardId)!.params.text).toBe("old");
    expect(useAgentEditsStore.getState().entries).toHaveLength(0);
    // Half-nested: one param inside `params`, one beside it. Refused whole, never half-saved.
    const half = await executeLocalTool("set_widget_params", { card_id: cardId, params: { text: "A" }, title: "B" });
    expect(half).toMatchObject({ error: { code: "PARAMS_NOT_NESTED", received_keys: ["title"], retry_with: { params: { text: "A", title: "B" } } } });
    expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards.find((c) => c.id === cardId)!.params.text).toBe("old");
  });

  it("set_markdown_content replaces a note or markdown card's body, undoably", async () => {
    const note = widget({ id: "note", backendId: "builtin", type: "note", params: [{ paramName: "text", type: "text" }] });
    const md = widget({ id: "markdown", backendId: "builtin", type: "markdown_editor", params: [{ paramName: "text", type: "text" }] });
    useWidgetRegistryStore.setState({ widgets: [note, md] });
    for (const def of [note, md]) {
      useAgentEditsStore.setState({ entries: [] });
      useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, contextSharing: true } });
      const cardId = (await useDashboardStore.getState().addCard(def, { text: "old" })) as string;
      const card = () => useDashboardStore.getState().activeDashboard()!.tabs[0].cards.find((c) => c.id === cardId)!;
      expect(await executeLocalTool("set_markdown_content", { card_id: cardId, text: "## Answer" })).toMatchObject({ updated: true, card_id: cardId, applied: ["text"] });
      // A mis-copied id is refused with the real note cards to retry against —
      // only with Context sharing on; off, the model is shown no cards at all.
      useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, contextSharing: true } });
      const miss = await executeLocalTool("set_markdown_content", { card_id: cardId.slice(0, 8), text: "x" });
      expect(miss).toMatchObject({ error: { code: "UNKNOWN_CARD", cards: expect.arrayContaining([expect.objectContaining({ card_id: cardId })]) } });
      useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, contextSharing: false } });
      expect(await executeLocalTool("set_markdown_content", { card_id: cardId.slice(0, 8), text: "x" })).toMatchObject({ error: { code: "UNKNOWN_CARD", cards: [] } });
      expect(card().params.text).toBe("## Answer");
      await useAgentEditsStore.getState().undoLast();
      expect(card().params.text).toBe("old");
    }
  });

  it("set_markdown_content refuses a card that is not markdown, a missing text, and a keys card as unknown", async () => {
    const chart = widget({ id: "chart", backendId: "reference", params: [{ paramName: "symbol", type: "text" }] });
    const keys = widget({ id: "keys", backendId: "km", type: "keys", params: [{ paramName: "text", type: "text" }] });
    useWidgetRegistryStore.setState({ widgets: [chart, keys] });
    const chartId = (await useDashboardStore.getState().addCard(chart)) as string;
    const keysId = (await useDashboardStore.getState().addCard(keys)) as string;
    expect(await executeLocalTool("set_markdown_content", { card_id: chartId, text: "x" })).toMatchObject({ error: { code: "NOT_MARKDOWN" } });
    expect(await executeLocalTool("set_markdown_content", { card_id: chartId })).toMatchObject({ error: { code: "MISSING_TEXT" } });
    // A keys card answers exactly as a missing one, and neither lists it.
    const forKeys = await executeLocalTool("set_markdown_content", { card_id: keysId, text: "x" });
    const forMissing = await executeLocalTool("set_markdown_content", { card_id: "nope", text: "x" });
    expect(forKeys).toMatchObject({ error: { code: "UNKNOWN_CARD", cards: [] } });
    expect(JSON.stringify(forKeys)).not.toContain(chartId);
    expect((forMissing as { error: { cards: unknown } }).error.cards).toEqual((forKeys as { error: { cards: unknown } }).error.cards);
  });

  it("set_widget_params refuses a keys widget as if it did not exist, and writes nothing", async () => {
    const def = widget({ id: "keys", name: "Keys", backendId: "reference", type: "keys", params: [{ paramName: "eodhd_key", type: "text" }] });
    useWidgetRegistryStore.setState({ widgets: [def] });
    const cardId = (await useDashboardStore.getState().addCard(def)) as string;
    // Same message as an unknown card: the model must not learn a keys card exists.
    expect(await executeLocalTool("set_widget_params", { card_id: cardId, params: { eodhd_key: "leak" } })).toEqual({ error: `unknown card ${cardId}` });
    const card = useDashboardStore.getState().activeDashboard()!.tabs[0].cards.find((c) => c.id === cardId)!;
    expect(card.params.eodhd_key).toBeUndefined();
  });
});

describe("dashboard-authoring tools", () => {
  beforeEach(async () => {
    __reset();
    __resetLoggerForTests();
    __resetJsonStoreForTests();
    useAgentEditsStore.setState({ entries: [] });
    useWorkspacesStore.setState({ workspaces: [], activeWorkspaceId: null, previousWorkspaceId: null, focusedSlot: null });
    useDashboardStore.setState({ dashboards: [], activeId: null, previousId: null, activeTabIds: {}, maximizedCardId: null, viewer: false });
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "chart", name: "Chart", backendId: "reference", type: "chart", params: [{ paramName: "symbol", type: "text", value: "AAPL" }] })],
    });
    await useDashboardStore.getState().load(); // seeds "Main"
  });

  const cards = () => useDashboardStore.getState().activeDashboard()!.tabs[0].cards;
  const chartCard = async () => (await useDashboardStore.getState().addCard(widget({ id: "chart", backendId: "reference", type: "chart" }))) as string;

  it("remove_widget removes a card and undo restores it", async () => {
    const id = await chartCard();
    await useDashboardStore.getState().patchCardField(id, "title", "My Chart");
    expect(await executeLocalTool("remove_widget", { card_id: id })).toMatchObject({ removed: true });
    expect(cards()).toHaveLength(0);
    await useAgentEditsStore.getState().undoLast();
    const restored = cards();
    expect(restored).toHaveLength(1);
    expect(restored[0].widgetId).toBe("chart");
    expect(restored[0].title).toBe("My Chart");
  });

  it("add_note adds a markdown card with the text, and undo removes it", async () => {
    expect(await executeLocalTool("add_note", { text: "## Findings\nUp 3%." })).toMatchObject({ added: true });
    const c = cards();
    expect(c).toHaveLength(1);
    expect(c[0].widgetId).toBe("markdown");
    expect(c[0].params.text).toBe("## Findings\nUp 3%.");
    await useAgentEditsStore.getState().undoLast();
    expect(cards()).toHaveLength(0);
  });

  // The card lands where the user is looking: the dashboard's held tab, the
  // same pick the Widget Library and a rail drop make (shownTabId).
  it("add_widget and add_note land on the tab on screen, not the first tab", async () => {
    const s = useDashboardStore.getState();
    const dash = s.activeDashboard()!;
    const t2 = (await s.addTab(dash.id, "Second"))!;
    useDashboardStore.getState().setActiveTab(dash.id, t2);
    expect(await executeLocalTool("add_widget", { widget_id: "chart" })).toMatchObject({ added: true, tab_id: t2 });
    expect(await executeLocalTool("add_note", { text: "hi" })).toMatchObject({ added: true });
    const live = useDashboardStore.getState().activeDashboard()!;
    expect(live.tabs[0].cards).toHaveLength(0);
    expect(live.tabs[1].cards.map((c) => c.widgetId)).toEqual(["chart", "markdown"]);
  });

  // In a workspace setActive alone changes nothing on screen; navigate does
  // what a rail click does (openDashboardAlone), so the dashboard is shown.
  it("navigate inside a workspace leaves it and shows the dashboard alone", async () => {
    const main = useDashboardStore.getState().activeId!;
    const id2 = (await useDashboardStore.getState().addDashboard("Macro")) as string;
    useWorkspacesStore.setState({
      workspaces: [{ id: "w1", name: "Trading", preset: "laptop", slots: [{ slot: "a", dashboardId: main }] }],
      activeWorkspaceId: "w1",
    });
    expect(await executeLocalTool("navigate", { dashboard_name: "Macro" })).toMatchObject({ navigated: true, dashboard_id: id2 });
    expect(useWorkspacesStore.getState().activeWorkspaceId).toBeNull();
    expect(useDashboardStore.getState().activeId).toBe(id2);
    // Already the focused dashboard, but shown in a tile: still opened alone.
    useWorkspacesStore.setState({ activeWorkspaceId: "w1" });
    expect(await executeLocalTool("navigate", { dashboard_name: "Macro" })).toMatchObject({ navigated: true });
    expect(useWorkspacesStore.getState().activeWorkspaceId).toBeNull();
  });

  it("navigate switches dashboard and tab by name, and refuses unknowns", async () => {
    const id2 = (await useDashboardStore.getState().addDashboard("Macro")) as string;
    const tab = useDashboardStore.getState().dashboards.find((d) => d.id === id2)!.tabs[0];
    useDashboardStore.getState().setActive(id2); // renameTab is active-scoped
    await useDashboardStore.getState().renameTab(tab.id, "Rates");
    useDashboardStore.getState().setActive(useDashboardStore.getState().dashboards[0].id);
    expect(await executeLocalTool("navigate", { dashboard_name: "Macro", tab_name: "Rates" })).toMatchObject({ navigated: true, dashboard_id: id2, tab_id: tab.id });
    expect(useDashboardStore.getState().activeId).toBe(id2);
    expect(await executeLocalTool("navigate", { dashboard_name: "Nope" })).toEqual({ error: "unknown dashboard Nope" });
    expect(await executeLocalTool("navigate", { dashboard_name: "Macro", tab_name: "Ghost" })).toEqual({ error: "unknown tab Ghost; the tabs are: Rates" });
  });

  // D-015: a model names "02" for the tab "02 Read".
  it("navigate matches a tab exactly, then case-insensitively, then by a unique prefix or word", async () => {
    const id = (await useDashboardStore.getState().addDashboard("Run")) as string;
    useDashboardStore.getState().setActive(id);
    const s = () => useDashboardStore.getState();
    const first = s().dashboards.find((d) => d.id === id)!.tabs[0].id;
    await s().renameTab(first, "01 Load");
    for (const n of ["02 Read", "rates", "Rates"]) await s().addTab(id, n);
    const tabId = (n: string) => s().dashboards.find((d) => d.id === id)!.tabs.find((t) => t.name === n)!.id;
    const go = (tab_name: string) => executeLocalTool("navigate", { dashboard_name: "Run", tab_name });
    expect(await go("Rates")).toMatchObject({ tab_id: tabId("Rates") }); // exact beats the case-insensitive "rates"
    expect(await go("02 READ")).toMatchObject({ tab_id: tabId("02 Read") });
    expect(await go("02")).toMatchObject({ tab_id: tabId("02 Read") });
    expect(await go("read")).toMatchObject({ tab_id: tabId("02 Read") });
    // "0" prefixes two tabs: refused, naming them all.
    expect(await go("0")).toEqual({ error: "unknown tab 0; the tabs are: 01 Load, 02 Read, rates, Rates" });
  });

  it("describe_widget returns the param schema and refuses a keys widget", async () => {
    const id = await chartCard();
    const r = (await executeLocalTool("describe_widget", { card_id: id })) as Record<string, unknown>;
    expect(r.widget).toBe("Chart");
    expect(r.params).toEqual([{ name: "symbol", type: "text", current_value: "AAPL" }]);
    const keys = widget({ id: "keys", backendId: "reference", type: "keys", params: [{ paramName: "eodhd_key" }] });
    useWidgetRegistryStore.setState({ widgets: [widget({ id: "chart", backendId: "reference", type: "chart" }), keys] });
    const kid = (await useDashboardStore.getState().addCard(keys)) as string;
    expect(await executeLocalTool("describe_widget", { card_id: kid })).toEqual({ error: `unknown card ${kid}` });
  });

  it("add_tab and rename_tab are both undoable", async () => {
    const r = (await executeLocalTool("add_tab", { name: "Rates" })) as Record<string, unknown>;
    const tabId = r.tab_id as string;
    const tabs = () => useDashboardStore.getState().activeDashboard()!.tabs;
    expect(tabs().some((t) => t.id === tabId)).toBe(true);
    await executeLocalTool("rename_tab", { tab_id: tabId, name: "Yields" });
    expect(tabs().find((t) => t.id === tabId)!.name).toBe("Yields");
    await useAgentEditsStore.getState().undoLast();
    expect(tabs().find((t) => t.id === tabId)!.name).toBe("Rates");
    await useAgentEditsStore.getState().undoLast();
    expect(tabs().some((t) => t.id === tabId)).toBe(false);
  });

  it("rename_widget and rename_dashboard are both undoable", async () => {
    const id = await chartCard();
    await executeLocalTool("rename_widget", { card_id: id, title: "Prices" });
    expect(cards()[0].title).toBe("Prices");
    await useAgentEditsStore.getState().undoLast();
    expect(cards()[0].title).toBeUndefined();
    const before = useDashboardStore.getState().activeDashboard()!.name;
    await executeLocalTool("rename_dashboard", { new_name: "Board" });
    expect(useDashboardStore.getState().activeDashboard()!.name).toBe("Board");
    await useAgentEditsStore.getState().undoLast();
    expect(useDashboardStore.getState().activeDashboard()!.name).toBe(before);
  });

  it("move_widget sets the layout and undo restores it", async () => {
    const id = await chartCard();
    expect(await executeLocalTool("move_widget", { card_id: id, x: 4, y: 8, w: 12, h: 10 })).toMatchObject({ moved: true, layout: { x: 4, y: 8, w: 12, h: 10 } });
    expect(cards()[0].layout).toMatchObject({ x: 4, y: 8, w: 12, h: 10 });
    await useAgentEditsStore.getState().undoLast();
    expect(cards()[0].layout).not.toMatchObject({ x: 4, y: 8 });
  });

  // Ep6 shoot: "move the clock to the top" left the clock under the card
  // already at row 0 (the grid does not compact, so the earlier card kept its
  // place) while the result claimed y 0. The moved card takes the spot, like
  // a drag; whatever it lands on goes down.
  it("move_widget pushes a card it lands on down, and undo puts both back", async () => {
    const top = await chartCard();
    const moved = await chartCard();
    await useDashboardStore.getState().updateLayouts([
      { i: top, x: 0, y: 0, w: 40, h: 10 },
      { i: moved, x: 0, y: 10, w: 20, h: 8 },
    ]);
    expect(await executeLocalTool("move_widget", { card_id: moved, x: 0, y: 0, w: 40 })).toMatchObject({ layout: { x: 0, y: 0, w: 40, h: 8 } });
    const at = (id: string) => cards().find((c) => c.id === id)!.layout;
    expect(at(moved)).toMatchObject({ x: 0, y: 0 });
    expect(at(top)).toMatchObject({ x: 0, y: 8, w: 40, h: 10 });
    await useAgentEditsStore.getState().undoLast();
    expect(at(top)).toMatchObject({ y: 0 });
    expect(at(moved)).toMatchObject({ y: 10, w: 20 });
  });

  // v8: a card pinned to an edge docks outside the grid, and its slot is
  // remembered for Unpin -- nothing may move a slot that is not on screen, so
  // move_widget's push-down passes over it.
  it("move_widget leaves a docked card's remembered slot alone", async () => {
    const docked = await chartCard();
    const moved = await chartCard();
    await useDashboardStore.getState().updateLayouts([
      { i: docked, x: 0, y: 0, w: 40, h: 10 },
      { i: moved, x: 0, y: 10, w: 20, h: 8 },
    ]);
    await useDashboardStore.getState().pinCard(docked, "top");
    const result = await executeLocalTool("move_widget", { card_id: moved, x: 0, y: 0 });
    expect(result).not.toHaveProperty("pushed_down");
    expect(cards().find((c) => c.id === docked)!.layout).toMatchObject({ x: 0, y: 0, w: 40, h: 10 });
  });

  // Review S-lib-6: the description promises a 40-column grid (x 0–39).
  it("move_widget keeps the card inside the 40-column grid", async () => {
    const id = await chartCard();
    expect(await executeLocalTool("move_widget", { card_id: id, x: 45, y: 0, w: 4, h: 4 })).toMatchObject({ layout: { x: 39, w: 1 } });
    expect(await executeLocalTool("move_widget", { card_id: id, x: 30, w: 50 })).toMatchObject({ layout: { x: 30, w: 10 } });
  });

  it("duplicate_widget copies a card and undo removes the copy", async () => {
    const id = await chartCard();
    expect(await executeLocalTool("duplicate_widget", { card_id: id })).toMatchObject({ duplicated: true });
    expect(cards()).toHaveLength(2);
    await useAgentEditsStore.getState().undoLast();
    expect(cards()).toHaveLength(1);
  });

  // Donor 85841963 (main's #176), assertions unchanged.
  it("pin_card pins to an edge, undo unpins, and a bad edge is refused", async () => {
    const id = await chartCard();
    expect(await executeLocalTool("pin_card", { card_id: id, edge: "bottom" })).toMatchObject({ pinned: true, edge: "bottom" });
    expect(cards()[0].pinned).toBe("bottom");
    await useAgentEditsStore.getState().undoLast();
    expect(cards()[0].pinned ?? null).toBeNull();
    expect(await executeLocalTool("pin_card", { card_id: id, edge: "sideways" })).toEqual({ error: 'edge must be "top", "bottom" or "none"' });
  });

  it("pin_card's undo puts back the edge the card had; \"none\" and an empty edge unpin", async () => {
    const id = await chartCard();
    await useDashboardStore.getState().pinCard(id, "top");
    expect(await executeLocalTool("pin_card", { card_id: id, edge: " Bottom " })).toMatchObject({ pinned: true, edge: "bottom" });
    await useAgentEditsStore.getState().undoLast();
    expect(cards()[0].pinned).toBe("top");
    expect(await executeLocalTool("pin_card", { card_id: id, edge: "none" })).toMatchObject({ pinned: true, edge: null });
    expect(cards()[0]).not.toHaveProperty("pinned");
    await useDashboardStore.getState().pinCard(id, "top");
    expect(await executeLocalTool("pin_card", { card_id: id, edge: "" })).toMatchObject({ edge: null });
    expect(cards()[0]).not.toHaveProperty("pinned");
  });

  it("pin_card on a locked widget is a no-op: no change, no undo step", async () => {
    const lockedId = (await useDashboardStore.getState().addCardTo(DOCKS_ID, "bottom", widget({ id: "chart", backendId: "reference", type: "chart" })))!;
    const before = useDashboardStore.getState().docks;
    const entries = useAgentEditsStore.getState().entries.length;
    expect(await executeLocalTool("pin_card", { card_id: lockedId, edge: "top" })).toMatchObject({ pinned: false, card_id: lockedId });
    expect(useDashboardStore.getState().docks).toBe(before);
    expect(useDashboardStore.getState().docks.tabs[1].cards[0]).not.toHaveProperty("pinned");
    expect(useAgentEditsStore.getState().entries).toHaveLength(entries);
  });

  // Review C1: pin_card is a card tool like move_widget, behind the same
  // Context-sharing gate -- a user card, or a locked one, reads as unknown.
  it("pin_card with Context sharing off answers unknown card exactly as move_widget does, a locked card too", async () => {
    const id = await chartCard();
    const lockedId = (await useDashboardStore.getState().addCardTo(DOCKS_ID, "bottom", widget({ id: "chart", backendId: "reference", type: "chart" })))!;
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, contextSharing: false } }));
    try {
      for (const cardId of [id, lockedId]) {
        const moved = await executeLocalTool("move_widget", { card_id: cardId, x: 1 });
        expect(moved).toEqual({ error: `unknown card ${cardId}` });
        expect(await executeLocalTool("pin_card", { card_id: cardId, edge: "top" })).toEqual(moved);
      }
      expect(cards()[0]).not.toHaveProperty("pinned");
    } finally {
      useSettingsStore.setState((s) => ({ settings: { ...s.settings, contextSharing: true } }));
    }
  });

  // Review C2: pinning to an edge another card of the tab holds swaps that
  // card off it; the one Undo step puts both back.
  it("pin_card's undo also gives the displaced card its edge back", async () => {
    const a = await chartCard();
    const b = await chartCard();
    await useDashboardStore.getState().pinCard(a, "top");
    await executeLocalTool("pin_card", { card_id: b, edge: "top" });
    expect(cards().find((c) => c.id === a)).not.toHaveProperty("pinned");
    await useAgentEditsStore.getState().undoLast();
    expect(cards().find((c) => c.id === a)!.pinned).toBe("top");
    expect(cards().find((c) => c.id === b)).not.toHaveProperty("pinned");
  });

  // Review C5: a docked card is off the grid, so moving it changes only its
  // own remembered slot (where Unpin returns it) and pushes nothing.
  it("move_widget on a docked card updates only its own slot and pushes nothing", async () => {
    const p = await chartCard();
    const q = await chartCard();
    await useDashboardStore.getState().updateLayouts([
      { i: p, x: 0, y: 0, w: 40, h: 10 },
      { i: q, x: 0, y: 10, w: 40, h: 8 },
    ]);
    await useDashboardStore.getState().pinCard(p, "top");
    const result = await executeLocalTool("move_widget", { card_id: p, x: 0, y: 10 });
    expect(result).toMatchObject({ moved: true, layout: { x: 0, y: 10 } });
    expect(result).not.toHaveProperty("pushed_down");
    expect(cards().find((c) => c.id === q)!.layout).toMatchObject({ y: 10 });
    expect(cards().find((c) => c.id === p)).toMatchObject({ pinned: "top", layout: { y: 10 } });
    await useAgentEditsStore.getState().undoLast();
    expect(cards().find((c) => c.id === p)!.layout).toMatchObject({ y: 0 });
  });


  it("search_widgets finds addable widgets by keyword and never surfaces keys", async () => {
    useWidgetRegistryStore.setState({
      widgets: [
        widget({ id: "arts_charts_eodhd", name: "Art's Charts — EODHD", description: "Advanced price chart.", category: "Equity", type: "chart" }),
        widget({ id: "earnings_calendar", name: "Earnings Calendar", description: "Upcoming earnings.", category: "Calendars", type: "table" }),
        // On its own backend: every widget on a backend that serves key-maint is
        // off limits (isAgentOffLimits), so sharing one would hide the two above.
        widget({ id: "api_keys", name: "API Keys", description: "Your provider keys.", type: "keys", backendId: "km" }),
      ],
    });
    const r = (await executeLocalTool("search_widgets", { query: "chart" })) as Record<string, unknown>;
    expect(r.total).toBe(1);
    expect((r.widgets as { id: string }[]).map((w) => w.id)).toEqual(["arts_charts_eodhd"]);
    // A query that would match the keys widget by name still never returns it.
    const k = (await executeLocalTool("search_widgets", { query: "keys" })) as Record<string, unknown>;
    expect((k.widgets as { id: string }[]).some((w) => w.id === "api_keys")).toBe(false);
    // Empty query lists everything addable (keys excluded).
    expect(((await executeLocalTool("search_widgets", {})) as Record<string, unknown>).total).toBe(2);
  });

  // D-010: a model's query carries words no metadata holds ("AAPL"), and
  // requiring every word returned nothing. Any word matches, ranked by hits.
  it("search_widgets ranks any-word matches over name, category, subcategory, description and source", async () => {
    useWidgetRegistryStore.setState({
      widgets: [
        widget({ id: "w_a", name: "Quote", description: "Latest price.", category: "Equity", subCategory: "Price", source: ["yfinance"] }),
        widget({ id: "w_b", name: "Price History", description: "Daily bars.", category: "Equity", subCategory: "Price", source: ["eodhd"] }),
        widget({ id: "w_c", name: "Calendar", description: "Dates.", category: "Calendars", subCategory: "Events", source: [] }),
        widget({ id: "w_d", name: "Yahoo Screener", description: "Screens.", category: "Screeners", subCategory: "", source: ["other"] }),
      ],
    });
    type R = { total: number; all_words_matched: number; widgets: { id: string; matched_words: string[] }[] };
    const r = (await executeLocalTool("search_widgets", { query: "AAPL price history chart" })) as R;
    expect(r.widgets.map((w) => w.id)).toEqual(["w_b", "w_a"]);
    expect(r.widgets[0].matched_words).toEqual(["price", "history"]);
    expect(r.total).toBe(2);
    expect(r.all_words_matched).toBe(0);
    // "yahoo" is how a model names the yfinance source.
    const y = (await executeLocalTool("search_widgets", { query: "yahoo" })) as R;
    // The synonym adds to the word: a widget that literally says "Yahoo" still matches.
    expect(y.widgets.map((w) => w.id)).toEqual(["w_a", "w_d"]);
    expect(y.all_words_matched).toBe(2);
    // subcategory is searched.
    expect(((await executeLocalTool("search_widgets", { query: "events" })) as R).widgets.map((w) => w.id)).toEqual(["w_c"]);
  });

  it("every card tool refuses a keys widget as if it did not exist", async () => {
    const keys = widget({ id: "keys", backendId: "reference", type: "keys" });
    useWidgetRegistryStore.setState({ widgets: [keys] });
    const kid = (await useDashboardStore.getState().addCard(keys)) as string;
    for (const t of ["remove_widget", "rename_widget", "move_widget", "duplicate_widget", "pin_card", "describe_widget"]) {
      expect(await executeLocalTool(t, { card_id: kid, title: "x", edge: "top" })).toEqual({ error: `unknown card ${kid}` });
    }
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
  beforeEach(async () => {
    __reset();
    __resetLoggerForTests();
    __resetJsonStoreForTests();
    useAgentEditsStore.setState({ entries: [] });
    useDashboardStore.setState({ dashboards: [], activeId: null, previousId: null, activeTabIds: {}, maximizedCardId: null, viewer: false });
    await useDashboardStore.getState().load(); // seeds "Main"
    useWidgetRegistryStore.setState({ widgets: registryWidgets });
  });

  it("search lists only the normal backend's widget, whatever the query", async () => {
    const all = (await executeLocalTool("search_widgets", {})) as { widgets: { id: string }[] };
    expect(all.widgets.map((w) => w.id)).toEqual(["historical_prices"]);
    for (const query of ["provider", "keys", "summary", "rotation", "settings"]) {
      expect(((await executeLocalTool("search_widgets", { query })) as Record<string, unknown>).total).toBe(0);
    }
  });

  it("a normal backend's widget stays addable and usable", async () => {
    expect(await executeLocalTool("add_widget", { widget_id: "historical_prices" })).toMatchObject({ added: true });
    const cardId = useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0].id;
    expect(await executeLocalTool("describe_widget", { card_id: cardId })).not.toHaveProperty("error");
  });

  for (const def of offLimits) {
    it(`add, create_dashboard and every card and table tool refuse ${def.id} (${def.type})`, async () => {
      for (const named of [def.id, def.name]) {
        const added = (await executeLocalTool("add_widget", { widget_id: named })) as { error?: { code: string; suggestions: string[] } };
        expect(added.error?.code).toBe("UNKNOWN_WIDGET");
        expect(added.error?.suggestions).not.toContain(def.id);
      }
      const created = (await executeLocalTool("create_dashboard", { name: "Grab", widget_ids: [def.id] })) as { added: string[] };
      expect(created.added).toEqual([]);

      // A card of it already on the dashboard (an imported one, say) reads as unknown to every tool.
      const kid = (await useDashboardStore.getState().addCard(def)) as string;
      for (const t of ["remove_widget", "rename_widget", "move_widget", "duplicate_widget", "pin_card", "describe_widget"]) {
        expect(await executeLocalTool(t, { card_id: kid, title: "x", edge: "top" })).toEqual({ error: `unknown card ${kid}` });
      }
      // A locked card of it reads as unknown too: the docks are behind the same gate.
      const locked = (await useDashboardStore.getState().addCardTo(DOCKS_ID, "top", def))!;
      expect(await executeLocalTool("pin_card", { card_id: locked, edge: "top" })).toEqual({ error: `unknown card ${locked}` });
      expect(await executeLocalTool("set_widget_params", { card_id: kid, params: { run_tests: "true" } })).toEqual({ error: `unknown card ${kid}` });
      for (const t of ["describe_table", "arrange_table"]) {
        expect(await executeLocalTool(t, { card_id: kid, arrangement: {} })).toMatchObject({ message: `unknown card ${kid}` });
      }
    });
  }
});

describe("remove_widget undo (adaptation 3)", () => {
  const full = { id: "c1", backendId: "builtin", widgetId: "note", title: "Kept", params: { text: "x" }, layout: { x: 1, y: 2, w: 3, h: 4 },
    bindings: [{ paramName: "text", groupId: "g" }], table: { sorting: [{ id: "a", desc: true }] }, view: "raw", fiscalYearEnd: { text: 6 } } as unknown as DashboardCard;
  beforeEach(() => {
    useAgentEditsStore.setState({ entries: [] }); // earlier tests' edits linger in the store
    useWidgetRegistryStore.getState().seedBuiltins();
    useDashboardStore.setState({ dashboards: [{ id: "d", name: "D", tabs: [{ id: "t", name: "T", cards: [{ ...full, id: "a0" }, full, { ...full, id: "z9" }] }] }], activeId: "d", activeTabId: "t", viewer: false, pendingCardRemoval: null });
  });
  it("re-inserts the identical card at its original tab and index", async () => {
    await executeLocalTool("remove_widget", { card_id: "c1" });
    await useAgentEditsStore.getState().undoLast();
    const cards = useDashboardStore.getState().dashboards[0].tabs[0].cards;
    expect(cards.map(c => c.id)).toEqual(["a0", "c1", "z9"]);
    expect(cards[1]).toEqual(full);
  });
  it("fails visibly once another removal superseded it", async () => {
    await executeLocalTool("remove_widget", { card_id: "c1" });
    await useDashboardStore.getState().removeCard("z9");
    await expect(useAgentEditsStore.getState().undoLast()).rejects.toThrow(/can no longer be undone/);
    expect(useAgentEditsStore.getState().entries).toHaveLength(0); // stale entry dropped so older edits stay undoable
  });
  it("refuses to remove a CSV/XLS table card", async () => {
    useDashboardStore.setState(s => ({ dashboards: [{ ...s.dashboards[0], tabs: [{ id: "t", name: "T", cards: [{ ...full, widgetId: "local_table", params: { file: "f.csv" } }] }] }] }));
    expect(await executeLocalTool("remove_widget", { card_id: "c1" })).toMatchObject({ error: { code: "LOCAL_FILE_CARD" } });
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards).toHaveLength(1);
  });
});

describe("markdown tools persist the tool input exactly (adaptation 4, #326)", () => {
  const tricky = "## Café\r\n\n- a  \n\t`x` — 💡\n\n";
  beforeEach(() => {
    useWidgetRegistryStore.getState().seedBuiltins();
    useDashboardStore.setState({ dashboards: [{ id: "d", name: "D", tabs: [{ id: "t", name: "T", cards: [] }] }], activeId: "d", activeTabId: "t", viewer: false, pendingCardRemoval: null });
  });
  it("add_note creates a clean markdown card whose saved text equals the input", async () => {
    const out = await executeLocalTool("add_note", { text: tricky });
    const saved = JSON.parse(__read("dashboards/d.json") ?? "{}");
    const card = saved.tabs[0].cards.find((c: DashboardCard) => c.id === out.card_id);
    expect(card.widgetId).toBe("markdown");
    expect(card.params.text).toBe(tricky);
  });
  it("set_markdown_content writes the note text unchanged", async () => {
    const out = await executeLocalTool("add_note", { text: "x" });
    await executeLocalTool("set_markdown_content", { card_id: out.card_id, text: tricky });
    const card = useDashboardStore.getState().dashboards[0].tabs[0].cards[0];
    expect(card.params.text).toBe(tricky);
  });
});

describe("review fixes (A1-A4, A7, A8)", () => {
  const hp = widget({ id: "hp", name: "HP", backendId: "reference", params: [{ paramName: "symbol", label: "S", type: "text" }, { paramName: "interval", label: "I", type: "text" }] });
  beforeEach(async () => {
    __reset();
    __resetJsonStoreForTests();
    useAgentEditsStore.setState({ entries: [] });
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, contextSharing: true } }));
    useDashboardStore.setState({ dashboards: [], activeId: null, previousId: null, activeTabIds: {}, maximizedCardId: null, viewer: false });
    useWidgetRegistryStore.setState({ widgets: [hp] });
    useWidgetRegistryStore.getState().seedBuiltins();
    await useDashboardStore.getState().load();
  });
  const active = () => useDashboardStore.getState().activeDashboard()!;
  const cardOf = (id: string) => useDashboardStore.getState().dashboards.flatMap((d) => d.tabs.flatMap((t) => t.cards)).find((c) => c.id === id)!;

  it("A1: never points a Website card at a URL without the user's confirmation", async () => {
    const add = await executeLocalTool("add_widget", { widget_id: "website" });
    const id = add.card_id as string;
    expect(await executeLocalTool("set_widget_params", { card_id: id, params: { url: "https://attacker.example/?d=x" } })).toMatchObject({ error: { code: "NEEDS_USER" } });
    expect(cardOf(id).params.url ?? "").toBe("");
    const asked: unknown[] = [];
    const deny = async (r: unknown) => (asked.push(r), false);
    expect(await executeLocalTool("set_widget_params", { card_id: id, params: { url: "https://attacker.example/" } }, { confirm: deny })).toMatchObject({ error: { code: "user_declined" } });
    expect(asked).toEqual([expect.objectContaining({ url: "https://attacker.example/", tool: "set_widget_params" })]);
    expect(cardOf(id).params.url ?? "").toBe("");
    expect(await executeLocalTool("set_widget_params", { card_id: id, params: { url: "https://ok.example/" } }, { confirm: async () => true })).toMatchObject({ updated: true });
    expect(cardOf(id).params.url).toBe("https://ok.example/");
    // add_widget's params go through the same gate.
    const viaAdd = await executeLocalTool("add_widget", { widget_id: "website", params: { url: "https://attacker.example/" } });
    expect(cardOf(viaAdd.card_id as string).params.url ?? "").toBe("");
    expect(viaAdd.params).toMatchObject({ applied: [] });
  });

  it("A1: an RSS card's feed URL needs the same confirmation, via add_widget and set_widget_params", async () => {
    const bare = await executeLocalTool("add_widget", { widget_id: "rss" });
    const id = bare.card_id as string;
    expect(await executeLocalTool("set_widget_params", { card_id: id, params: { url: "https://attacker.example/feed?d=x" } })).toMatchObject({ error: { code: "NEEDS_USER" } });
    expect(await executeLocalTool("set_widget_params", { card_id: id, params: { url: "https://attacker.example/feed" } }, { confirm: async () => false })).toMatchObject({ error: { code: "user_declined" } });
    expect(cardOf(id).params.url ?? "").toBe("");
    const viaAdd = await executeLocalTool("add_widget", { widget_id: "rss", params: { url: "https://attacker.example/feed" } });
    expect(viaAdd.params).toMatchObject({ applied: [] });
    expect(cardOf(viaAdd.card_id as string).params.url ?? "").toBe("");
    const ok = await executeLocalTool("add_widget", { widget_id: "rss", params: { url: "https://ok.example/feed" } }, { confirm: async () => true });
    expect(ok.params).toEqual({ applied: ["url"] });
    expect(cardOf(ok.card_id as string).params.url).toBe("https://ok.example/feed");
  });

  it("A2: undo of create_dashboard / add_tab refuses once the user has added cards", async () => {
    const made = await executeLocalTool("create_dashboard", { name: "Mine" });
    const did = made.dashboard_id as string;
    const tabId = useDashboardStore.getState().dashboards.find((d) => d.id === did)!.tabs[0].id;
    await useDashboardStore.getState().addCardTo(did, tabId, hp, { symbol: "USER" });
    await expect(useAgentEditsStore.getState().undoLast()).rejects.toThrow(/did not add/);
    expect(useDashboardStore.getState().dashboards.some((d) => d.id === did)).toBe(true);
    const t = await executeLocalTool("add_tab", { name: "T2" });
    await useDashboardStore.getState().addCardTo(active().id, t.tab_id as string, hp, { symbol: "USER2" });
    await expect(useAgentEditsStore.getState().undoLast()).rejects.toThrow(/did not add/);
    expect(active().tabs.some((x) => x.id === t.tab_id)).toBe(true);
  });

  it("A2: undo of create_dashboard still removes a dashboard holding only Rita's cards", async () => {
    const made = await executeLocalTool("create_dashboard", { name: "Hers", widget_ids: ["hp"] });
    await useAgentEditsStore.getState().undoLast();
    expect(useDashboardStore.getState().dashboards.some((d) => d.id === made.dashboard_id)).toBe(false);
  });

  it("A3: a group-bound param is written to its group and reported as shown", async () => {
    const add = await executeLocalTool("add_widget", { widget_id: "hp", params: { symbol: "AAPL" } });
    const id = add.card_id as string;
    const d = active();
    useDashboardStore.setState((s) => ({
      dashboards: s.dashboards.map((x) => x.id === d.id ? { ...d, groups: [{ id: "g1", name: "Sym", paramName: "symbol", groupType: "symbol", value: "AAPL" }],
        tabs: d.tabs.map((t) => ({ ...t, cards: t.cards.map((c) => c.id === id ? { ...c, bindings: [{ paramName: "symbol", groupId: "g1" }] } : c) })) } : x),
    }));
    expect(await executeLocalTool("set_widget_params", { card_id: id, params: { symbol: "MSFT" } })).toMatchObject({ updated: true });
    expect(active().groups?.[0].value).toBe("MSFT");
    const described = await executeLocalTool("describe_widget", { card_id: id });
    expect(described.params).toContainEqual(expect.objectContaining({ name: "symbol", current_value: "MSFT" }));
    await useAgentEditsStore.getState().undoLast();
    expect(active().groups?.[0].value).toBe("AAPL");
  });

  it("A4: add_widget with params onto a dashboard that is not active applies them", async () => {
    await executeLocalTool("create_dashboard", { name: "Tech" });
    const r = await executeLocalTool("add_widget", { widget_id: "hp", dashboard_name: "Tech", params: { symbol: "AAPL" } });
    expect(r.params).toEqual({ applied: ["symbol"] });
    expect(cardOf(r.card_id as string).params.symbol).toBe("AAPL");
  });

  it("A7: undo of set_widget_params never overwrites a later user edit", async () => {
    const add = await executeLocalTool("add_widget", { widget_id: "hp", params: { symbol: "AAPL", interval: "1d" } });
    const id = add.card_id as string;
    await executeLocalTool("set_widget_params", { card_id: id, params: { symbol: "MSFT" } });
    await useDashboardStore.getState().applyCardParams(id, { cardParams: { ...cardOf(id).params, interval: "1h" }, groupEdits: [] });
    await useAgentEditsStore.getState().undoLast();
    expect(cardOf(id).params).toMatchObject({ symbol: "AAPL", interval: "1h" });
    await useDashboardStore.getState().applyCardParams(id, { cardParams: { ...cardOf(id).params, symbol: "TSLA" } , groupEdits: [] });
    // The add_widget params entry: symbol moved on since, so refuse.
    await expect(useAgentEditsStore.getState().undoLast()).rejects.toThrow(/changed after/);
    expect(cardOf(id).params.symbol).toBe("TSLA");
  });

  it("A8: with Context sharing off a known uuid is still an unknown card", async () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, contextSharing: false } }));
    const id = (await useDashboardStore.getState().addCard(hp)) as string;
    expect(await executeLocalTool("describe_widget", { card_id: id })).toEqual({ error: `unknown card ${id}` });
    expect(await executeLocalTool("set_widget_params", { card_id: id, params: { symbol: "X" } })).toEqual({ error: `unknown card ${id}` });
    expect(await executeLocalTool("describe_table", { card_id: id })).toEqual({ error: `unknown card ${id}` });
    expect(await executeLocalTool("set_markdown_content", { card_id: id, text: "x" })).toMatchObject({ error: { code: "UNKNOWN_CARD", cards: [] } });
    // A card Rita's own tools made stays hers to configure.
    const again = await executeLocalTool("add_widget", { widget_id: "hp", params: { symbol: "AAPL" } });
    expect(again.params).toEqual({ applied: ["symbol"] });
    expect(await executeLocalTool("set_widget_params", { card_id: again.card_id, params: { symbol: "MSFT" } })).toMatchObject({ updated: true });
  });

  it("A8: Rita's own cards are forgotten when the chat is cleared or sharing is switched off", async () => {
    const { useChatStore } = await import("../../stores/chatStore");
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, contextSharing: false } }));
    const first = (await executeLocalTool("add_widget", { widget_id: "hp" })).card_id as string;
    expect(await executeLocalTool("describe_widget", { card_id: first })).toMatchObject({ card_id: first });
    await useChatStore.getState().clear();
    expect(await executeLocalTool("describe_widget", { card_id: first })).toEqual({ error: `unknown card ${first}` });
    const second = (await executeLocalTool("add_widget", { widget_id: "hp" })).card_id as string;
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, contextSharing: true } }));
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, contextSharing: false } }));
    expect(await executeLocalTool("describe_widget", { card_id: second })).toEqual({ error: `unknown card ${second}` });
  });
});
