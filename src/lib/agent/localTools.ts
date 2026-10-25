// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Rita cannot mutate a dashboard through the custom-agent protocol; there is
 * no layout-mutation event. But the protocol routes tool calls back to the
 * client, so the app declares its own tools under a reserved server id and
 * executes them in process.
 */
import type { AgentTool } from "./types";
import type { ConfirmTool } from "./execute";
import { effectiveParams, splitParamEdit } from "../paramGroups";
import { isPeriodType, resolveValue } from "../dateExpressions";
import { fieldContext } from "../params";
import { arrangeTable, describeTable } from "./tableModel/tools";
import type { CardView, DashboardCard, WidgetDef } from "../types";
import { PIN_EDGES } from "../types";
import { possibleViews } from "../cardViews";
import { isRecord } from "../isRecord";
import { isAgentOffLimits, keyMaintBackendIds } from "../providerKeys";
import { useAgentEditsStore } from "../../stores/agentEditsStore";
import { heldTab, useDashboardStore } from "../../stores/dashboardStore";
import { useWorkspacesStore } from "../../stores/workspacesStore";
import { openDashboardAlone } from "../workspaceFocus";
import { useSettingsStore } from "../../stores/settingsStore";
import { useWidgetRegistryStore } from "../../stores/widgetRegistryStore";
import { BUILTIN_WIDGETS, LOCAL_TABLE_ID } from "../builtins";

/** Words a model uses for a source the catalog names otherwise (D-010). */
const SEARCH_SYNONYMS = new Map([["yahoo", "yfinance"]]);

export const LOCAL_TOOL_SERVER_ID = "bdobb-local";

/** The `view` argument of add_widget and set_widget_params. */
const VIEW_PROP = {
  type: "string",
  enum: ["default", "chart", "statement", "calendar", "raw", "transposed"],
  description: "The card's view: default (the widget's own rendering), chart, statement, calendar, raw or transposed, as the card's view menu offers them. " +
    "chart and calendar draw only when the data has a date/time column; otherwise the card says nothing is chartable, so only say you made a chart after the data shows one.",
};

/**
 * Kept flat deliberately: the model is local, and tool-calling accuracy falls
 * off with argument depth more than with tool count, so every tool here takes
 * a shallow object and no nesting beyond arrange_table's arrangement. The set
 * grew from four to eighteen -- Episode 6's authoring work, then
 * set_markdown_content and v8's pin_card -- because a model
 * that can only create a dashboard and add a widget sends the user back to the
 * UI for everything else; the two table tools still earn their place because
 * without them the model pulls whole tables through get_widget_data to learn
 * what the client already knows.
 */
export const LOCAL_TOOLS: AgentTool[] = ([
  {
    name: "create_dashboard",
    description: "Create a new dashboard, optionally with an ordered list of widgets.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Dashboard name" },
        widget_ids: {
          type: "array",
          items: { type: "string" },
          description: "Widget ids, in the order they should appear",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "add_widget",
    description:
      "Add a widget to a dashboard, defaulting to the current one. Pass the widget's required params in this same call " +
      '(e.g. {"widget_id": "…", "params": {"symbol": "AAPL"}}); a card without its symbol shows no data. Params are checked ' +
      "exactly as set_widget_params checks them. The result's params.applied lists what was set; if params.refused is present " +
      "the card was added WITHOUT any of them, so fix them and call set_widget_params before reporting success. " +
      'Pass view to show it other than as its default, e.g. {"view": "chart"}; a refused view is reported the same way, under view.refused.',
    input_schema: {
      type: "object",
      properties: {
        widget_id: { type: "string", description: "Widget id" },
        dashboard_name: { type: "string", description: "Target dashboard; omit for the current one" },
        params: {
          type: "object",
          description: 'Optional paramName → value for the new card, e.g. {"symbol": "AAPL"}. Values are strings or numbers.',
        },
        view: VIEW_PROP,
      },
      required: ["widget_id"],
    },
  },
  {
    name: "describe_table",
    description:
      "Read a table card's shared table model before arranging it (read-only, bounded). Works for CSV/XLS, linked and backend tables; " +
      "a standard LIVE table answers unavailable/server-execution-pending. Returns the model's revision (pass it to arrange_table as " +
      "expected_revision), its fields by stable ID, the current arrangement, the capabilities (the operations and per-field " +
      "aggregations the engine accepts, so read them here rather than guessing; capabilities.how_to_arrange says how fields, categories " +
      "and measures fit together), warnings and completeness. A table that cannot be read answers unavailable with a reason. section " +
      "'profile' returns each source field's exact count, missing, distinct (capped at 1000), min/max, samples and periodicity over " +
      "rows_profiled rows: scope 'input' (default) is every row the card receives, 'filtered' the rows its calculations use; pass fields to " +
      "pick source fields. Use it to choose categories, measures and filters and to answer questions without reading rows, and say which " +
      "scope a quoted number covers. section 'members:<category_id>' pages a category's observed members and 'formula:<formula_id>' lists " +
      "a formula's references; pass the returned cursor to continue and search to filter members by label. If the table's tab is not open " +
      "it asks you to navigate to it.",
    input_schema: { type: "object", properties: {
      card_id: { type: "string", description: "The table card (its uuid in the widget context)" },
      section: { type: "string", description: "summary (default), profile, members:<category_id> or formula:<formula_id>" },
      scope: { type: "string", enum: ["input", "filtered"], description: "profile only: input (default, every row the card receives) or filtered (the rows its calculations use)" },
      fields: { type: "array", items: { type: "string" }, description: "profile only: 1–100 source field ids to profile, in this order" },
      cursor: { type: "string", description: "Continuation token from a previous section page" },
      search: { type: "string", description: "Filter members by label (members sections only)" },
    }, required: ["card_id"] },
  },
  {
    name: "arrange_table",
    description:
      "Arrange a CSV/XLS or linked table with one table-model/1 arrangement, or with mode \"preview\" calculate it read-only. " +
      "When the user asks only to summarize, inspect or suggest, ALWAYS pass mode \"preview\": it runs the same validation and worker " +
      "calculation, returns status previewed with committed false and preview.rows (at most 20; preview.truncated says when there are more), " +
      "and never changes the table, the dashboard or Undo. Omitting mode applies. Call describe_table first and pass its revision as " +
      "expected_revision; a changed revision refuses with stale-revision, so describe again. All operations in the call apply " +
      "together or not at all, and the operations come from describe_table's capabilities. Fields are source columns: category.add makes " +
      "a category (rows/columns) and measure.add a measure (values) from a field; layout.set then places those objects, never field ids. " +
      "Address existing objects by {id} and new ones by a request-local {alias}; an applied result's ids maps each alias to its new id. " +
      "The engine validates and calculates: quote only numbers that are values in the result's preview.rows; the grand total and the row count " +
      "are not there, so do not add anything up yourself: state the source table's row count only as describe_table's exact completeness.totalRowCount, " +
      "never the grand total. Results are applied, previewed, unchanged, refused or failed. Unknown arguments are refused. Refusals: invalid-arrangement or validation-failed (read every errors item and " +
      "its alternatives), stale-revision (describe again), busy, timeout or calculation-failed (nothing changed; describe, then retry once). " +
      "view.set switches the card's view to one of describe_table's views (\"table\" is the default) in the same request and Undo. " +
      "An applied result may have revision null and recalculating true while the table settles, and lists each linked table with its status; " +
      "do not call a linked table ready until its status says so. An applied authoring change " +
      "can be undone with Undo. A standard LIVE table is refused with server-execution-pending, and a table whose tab is not open asks you to " +
      "navigate there. In viewer mode only the existing viewer controls can change, for this session only; any authoring change is refused with viewer-scope.",
    input_schema: { type: "object", properties: {
      card_id: { type: "string", description: "The table card (its uuid in the widget context)" },
      expected_revision: { type: "string", description: "The revision returned by describe_table" },
      mode: { type: "string", enum: ["apply", "preview"], description: "preview: calculate only, never commit (use for read-only asks). apply (default): commit with Undo." },
      arrangement: { type: "object", properties: {
        contract: { type: "string", enum: ["table-model/1"] },
        operations: { type: "array", description: "Operation objects as listed in describe_table's capabilities", items: { type: "object" } },
      }, required: ["contract", "operations"] },
    }, required: ["card_id", "expected_revision", "arrangement"] },
  },
  {
    name: "set_widget_params",
    description:
      "Set a widget card's parameters — a chart's symbol, interval or date range, or any card's inputs. " +
      "Pass only the params to change; the rest keep their current value, and the card refetches with the new ones. " +
      "Param names must match the widget's declared params (you see them in the widget context); an unknown name or " +
      "an out-of-range value refuses the whole call and lists what is valid. This is not for a table's grouping/sort " +
      "— use arrange_table for that. The params go NESTED under `params`: " +
      '{"card_id": "…", "params": {"symbol": "MSFT"}}, never beside card_id. For a note or markdown card\'s body, ' +
      "use set_markdown_content. To change how the card is shown (e.g. as a chart), pass view, with or without params.",
    input_schema: {
      type: "object",
      properties: {
        card_id: { type: "string", description: "The card to configure (its uuid in the widget context)" },
        params: {
          type: "object",
          description: 'paramName → value, e.g. {"symbol": "MSFT", "interval": "30m", "range": "5d"}. Values are strings or numbers.',
        },
        view: VIEW_PROP,
      },
      required: ["card_id"],
    },
  },
  {
    name: "set_markdown_content",
    description:
      "Replace the markdown body of a note or markdown card on the board — write an answer or summary into a card " +
      "that already exists. The whole text is replaced; one undoable step. Saved only when the result says " +
      "updated: true. To create a new note use add_note.",
    input_schema: {
      type: "object",
      properties: {
        card_id: { type: "string", description: "The note or markdown card (its uuid in the widget context)" },
        text: { type: "string", description: "The card's full new markdown body" },
      },
      required: ["card_id", "text"],
    },
  },
  {
    name: "remove_widget",
    description: "Remove a widget card from the dashboard. Undoable. Use when the user asks to remove, delete or close a widget.",
    input_schema: {
      type: "object",
      properties: { card_id: { type: "string", description: "The card to remove (its uuid in the widget context)" } },
      required: ["card_id"],
    },
  },
  {
    name: "add_note",
    description:
      "Write a markdown note onto a dashboard — your own summary, findings or explanation, as a card the user keeps. " +
      "Defaults to the current dashboard. Use this to put analysis on the board rather than only in chat.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The note's markdown body" },
        dashboard_name: { type: "string", description: "Target dashboard; omit for the current one" },
      },
      required: ["text"],
    },
  },
  {
    name: "navigate",
    description:
      "Switch the view to a dashboard and/or one of its tabs, by name. A tab may be named in full, or by a unique " +
      "prefix or word of its name (\"02\" for \"02 Read\"); a miss lists the tab names. Use when the user asks to show, open or go to a " +
      "dashboard or tab. A view change, not an edit.",
    input_schema: {
      type: "object",
      properties: {
        dashboard_name: { type: "string", description: "Dashboard to switch to; omit to stay on the current one" },
        tab_name: { type: "string", description: "Tab to switch to within that dashboard; omit to keep the current tab" },
      },
    },
  },
  {
    name: "describe_widget",
    description:
      "Profile a widget card's parameters before setting them: each param's name, type, current value, and — for a " +
      "dropdown — the allowed options. The read that pairs with set_widget_params the way describe_table pairs with arrange_table.",
    input_schema: {
      type: "object",
      properties: { card_id: { type: "string", description: "The card to profile (its uuid in the widget context)" } },
      required: ["card_id"],
    },
  },
  {
    name: "add_tab",
    description: "Add a tab to the current dashboard. Undoable.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "The new tab's name" } },
      required: ["name"],
    },
  },
  {
    name: "rename_tab",
    description: "Rename a tab of the current dashboard. Undoable.",
    input_schema: {
      type: "object",
      properties: {
        tab_id: { type: "string", description: "The tab's id (from the current dashboard)" },
        name: { type: "string", description: "The new name" },
      },
      required: ["tab_id", "name"],
    },
  },
  {
    name: "rename_widget",
    description: "Set a widget card's title. Undoable.",
    input_schema: {
      type: "object",
      properties: {
        card_id: { type: "string", description: "The card to rename (its uuid in the widget context)" },
        title: { type: "string", description: "The new title" },
      },
      required: ["card_id", "title"],
    },
  },
  {
    name: "rename_dashboard",
    description: "Rename a dashboard, defaulting to the current one. Undoable.",
    input_schema: {
      type: "object",
      properties: {
        new_name: { type: "string", description: "The new name" },
        name: { type: "string", description: "The dashboard to rename; omit for the current one" },
      },
      required: ["new_name"],
    },
  },
  {
    name: "move_widget",
    description:
      "Move and/or resize a widget card on the grid. The grid is 40 columns wide; x/y are the top-left cell, w/h the " +
      "size in cells. Pass only what changes. Undoable. Prefer this only when the user is explicit about placement — " +
      "people usually arrange by dragging.",
    input_schema: {
      type: "object",
      properties: {
        card_id: { type: "string", description: "The card to move (its uuid in the widget context)" },
        x: { type: "number", description: "Left column (0–39)" },
        y: { type: "number", description: "Top row" },
        w: { type: "number", description: "Width in columns" },
        h: { type: "number", description: "Height in rows" },
      },
      required: ["card_id"],
    },
  },
  {
    name: "duplicate_widget",
    description: "Duplicate a widget card, copying its params, onto the same dashboard. Undoable.",
    input_schema: {
      type: "object",
      properties: { card_id: { type: "string", description: "The card to duplicate (its uuid in the widget context)" } },
      required: ["card_id"],
    },
  },
  {
    name: "pin_card",
    description:
      "Pin a card to the top or bottom edge of its tab, where it stays while the rest scrolls, or unpin it. One card per " +
      "edge per tab. Undoable.",
    input_schema: {
      type: "object",
      properties: {
        card_id: { type: "string", description: "The card to pin (its uuid in the widget context)" },
        edge: { type: "string", description: 'One of "top", "bottom", or "none" to unpin' },
      },
      required: ["card_id", "edge"],
    },
  },
  {
    name: "search_widgets",
    description:
      "Search the widgets you can ADD, by name, category, subcategory, description or source — the catalog you otherwise " +
      "cannot see. Any query word matches; results are ranked by how many words matched (matched_words; all_words_matched " +
      "counts the results that matched every word). Use " +
      "this to find a widget that is not yet on any dashboard before calling add_widget; without it you only know the " +
      "widgets already placed. Query with keywords; results are concise (id, name, description, category) and capped, " +
      "so narrow the query rather than listing everything.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords, e.g. \"arts charts\" or \"earnings calendar\". Omit to list some of everything." },
        limit: { type: "number", description: "Max results (default 20, cap 50)" },
      },
    },
  },
] satisfies Omit<AgentTool, "server_id" | "url" | "endpoint">[]).map(({ name, ...rest }) => ({
  server_id: LOCAL_TOOL_SERVER_ID,
  name,
  url: "",
  endpoint: "",
  ...rest,
}));

/** Kept for call-site stability; the table tools take no deps (worker tables only). */
export type LocalToolDeps = {
  /** The external-MCP confirm prompt, reused before Rita points an iframe card at a URL. */
  confirm?: ConfirmTool;
  /** Internal only (add_widget -> set_widget_params): the card's own dashboard, which need not be active. */
  dashboardId?: string;
};

/**
 * Tools that act on a card Rita names by uuid. With Context sharing off she is
 * shown no card, so only the ones her own tools made this session are known.
 */
const ritaMade = new Set<string>();
/** Forgotten with the conversation (chatStore.clear) and whenever sharing goes off. */
export function forgetRitaCards(): void {
  ritaMade.clear();
}
useSettingsStore.subscribe((s, prev) => {
  if (prev.settings.contextSharing && !s.settings.contextSharing) forgetRitaCards();
});

/** Card types that load their `url` param client-side the moment it is set: website (iframe) and rss. */
const URL_LOADING_TYPES = new Set(["iframe", "rss"]);
// set_markdown_content is left out: it applies the same rule itself, to keep its own refusal shape.
const CARD_TOOLS = new Set(["describe_table", "arrange_table", "set_widget_params", "remove_widget",
  "describe_widget", "rename_widget", "move_widget", "duplicate_widget", "pin_card"]);

/** Lowercased with `_` and `-` removed — the loosest rung of the ladder. */
function loose(value: string): string {
  return value.toLowerCase().replace(/[_-]/g, "");
}

export type WidgetMatch = { def: WidgetDef; matchedVia: "id" | "id_case" | "name" | "loose" };

/**
 * Resolve what the model called a widget to a real widget id, reporting WHICH
 * rule matched so the agent can see how its guess was read.
 *
 * Four rungs, tried in order, because a model asked for "the historical
 * prices widget" reliably produces something plausible rather than exact:
 * exact id, case-insensitive id, display name, then separator-stripped. Exact
 * wins so a real id is never overridden by a loose match on a different
 * widget.
 */
export function resolveWidgetMatch(named: string, widgets: WidgetDef[]): WidgetMatch | null {
  const exact = widgets.find((w) => w.id === named);
  if (exact) return { def: exact, matchedVia: "id" };

  const ci = widgets.find((w) => w.id.toLowerCase() === named.toLowerCase());
  if (ci) return { def: ci, matchedVia: "id_case" };

  const byName = widgets.find((w) => w.name.toLowerCase() === named.toLowerCase());
  if (byName) return { def: byName, matchedVia: "name" };

  const looseMatch = widgets.find(
    (w) => loose(w.id) === loose(named) || loose(w.name) === loose(named),
  );
  return looseMatch ? { def: looseMatch, matchedVia: "loose" } : null;
}

/**
 * Up to `limit` widget ids whose id or name contains any word of the request
 * — enough for the agent's next try.
 */
export function suggestWidgets(named: string, widgets: WidgetDef[], limit = 5): string[] {
  const words = named.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  if (words.length === 0) return [];
  return widgets
    .filter((w) => words.some((word) => w.id.toLowerCase().includes(word) || w.name.toLowerCase().includes(word)))
    .slice(0, limit)
    .map((w) => w.id);
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Every refusal has one shape: a code the agent can branch on, a sentence,
 * and whatever detail helps it retry.
 */
function fail(code: string, message: string, detail: Record<string, unknown> = {}): Record<string, unknown> {
  return { error: { code, message, ...detail } };
}

const MAX_DASHBOARD_NAME = 60;

/**
 * The card a table tool may act on, by id, on the ACTIVE dashboard -- the same
 * reach patchCardField itself has (dashboardOfCard): a tool call about a card
 * on some other dashboard has nowhere sensible to land. Always reads a fresh
 * getState(), never a snapshot passed in, because an undo entry calls back
 * into this long after the tool call that queued it and must see the card as
 * it is then.
 */
function cardDashboard(dashboardId?: string) {
  const s = useDashboardStore.getState();
  return dashboardId === undefined ? s.activeDashboard() : s.dashboards.find((d) => d.id === dashboardId);
}

function findCard(cardId: string, dashboardId?: string): DashboardCard | undefined {
  return cardDashboard(dashboardId)?.tabs.flatMap((t) => t.cards).find((c) => c.id === cardId);
}

/** What the card actually fetches with: its params with its dashboard's groups applied. */
function shownParams(card: DashboardCard, def: WidgetDef, dashboardId?: string): Record<string, string> {
  const d = cardDashboard(dashboardId);
  return effectiveParams(card, d?.groups, def, d?.groupsDisabled === true);
}

/**
 * A card Rita may act on, with its widget def — or the "unknown card" refusal.
 * A keys widget reads as unknown, never revealing it exists: its params are the
 * user's secrets and it is never the agent's to touch (the rule buildWidgetRefs
 * and get_widget_data enforce, shared by every card tool below).
 */
function cardAndDef(cardId: string, dashboardId?: string, card = findCard(cardId, dashboardId)): { card: DashboardCard; def: WidgetDef } | { error: string } {
  if (!card) return { error: `unknown card ${cardId}` };
  const registry = useWidgetRegistryStore.getState();
  const def = registry.find(card.backendId, card.widgetId);
  if (!def || isAgentOffLimits(def, keyMaintBackendIds(registry.widgets))) return { error: `unknown card ${cardId}` };
  return { card, def };
}

/**
 * Runs one of LOCAL_TOOLS against the live stores and records an undo entry.
 * Returns the JSON object Rita gets back as the tool result.
 *
 * addCardTo requires a real tab id — it looks up the tab by id and refuses a
 * miss — so every call below resolves the target dashboard's tab on screen
 * (heldTab: its held tab, else its first) rather than passing null.
 */
export async function executeLocalTool(
  name: string,
  args: Record<string, unknown>,
  deps?: LocalToolDeps,
): Promise<Record<string, unknown>> {
  const dashboards = useDashboardStore.getState();
  const dashByName = (n: string) =>
    n === "" ? dashboards.activeDashboard() : dashboards.dashboards.find((d) => d.name.toLowerCase() === n.toLowerCase());
  const registry = useWidgetRegistryStore.getState();
  // Everything the agent may name, add or be told about: the registry less
  // isAgentOffLimits (key-maint's keys surfaces and settings widgets). Name
  // resolution and suggestions read this one list, so add_widget and
  // create_dashboard cannot place such a widget and no suggestion leaks one's
  // id. Since fix round 2 that is every widget on a backend serving
  // key-maint, not just its two handles (keyMaintBackendIds).
  const keyMaintBackends = keyMaintBackendIds(registry.widgets);
  const agentWidgets = registry.widgets.filter((w) => !isAgentOffLimits(w, keyMaintBackends));
  const namedCard = typeof args.card_id === "string" ? args.card_id : "";
  if (CARD_TOOLS.has(name) && !ritaMade.has(namedCard) && !useSettingsStore.getState().settings.contextSharing) {
    return { error: `unknown card ${namedCard}` };
  }
  const resolveMatch = (named: string) => resolveWidgetMatch(named, agentWidgets);

  if (name === "create_dashboard") {
    const dashName = typeof args.name === "string" ? args.name.trim() : "";
    if (dashName === "") return fail("MISSING_NAME", "name must be a non-empty string");
    if (dashName.length > MAX_DASHBOARD_NAME) {
      return fail("NAME_TOO_LONG", `name must be at most ${MAX_DASHBOARD_NAME} characters`, {
        got: dashName.length,
      });
    }
    const id = await dashboards.addDashboard(dashName);
    if (id === null) return fail("CREATE_FAILED", "could not create dashboard");
    const tabId = useDashboardStore.getState().dashboards.find((d) => d.id === id)?.tabs[0]?.id ?? null;
    const added: string[] = [];
    const ritaCards = new Set<string>();
    const unresolved: Array<{ requested: string; suggestions: string[] }> = [];
    for (const named of stringList(args.widget_ids)) {
      const resolved = resolveMatch(named);
      if (!resolved) {
        unresolved.push({ requested: named, suggestions: suggestWidgets(named, agentWidgets) });
        continue;
      }
      const newCard = await useDashboardStore.getState().addCardTo(id, tabId, resolved.def);
      if (newCard !== null) {
        added.push(resolved.def.id);
        ritaCards.add(newCard);
        ritaMade.add(newCard);
      }
    }
    useAgentEditsStore.getState().push({
      summary: `Rita created dashboard "${dashName}"`,
      // Removing a dashboard deletes its cards' stored files too, so never
      // take a card the user added along with it.
      undo: async () => {
        const live = useDashboardStore.getState().dashboards.find((d) => d.id === id);
        if (live?.tabs.some((t) => t.cards.some((c) => !ritaCards.has(c.id))))
          throw new Error(`"${dashName}" now holds cards Rita did not add; delete the dashboard yourself if you want it gone.`);
        await useDashboardStore.getState().removeDashboard(id);
      },
    });
    return {
      created: true,
      dashboard_id: id,
      dashboard: { id, name: dashName, tab_id: tabId },
      added,
      unresolved,
    };
  }

  if (name === "add_widget") {
    const named = typeof args.widget_id === "string" ? args.widget_id.trim() : "";
    if (named === "") return fail("MISSING_WIDGET", "widget_id must be a non-empty string");
    const resolved = resolveMatch(named);
    if (!resolved) {
      return fail("UNKNOWN_WIDGET", `no widget matches ${named}`, {
        requested: named,
        suggestions: suggestWidgets(named, agentWidgets),
      });
    }
    const wanted = typeof args.dashboard_name === "string" ? args.dashboard_name.trim() : "";
    const target = dashByName(wanted);
    if (!target) {
      return fail("UNKNOWN_DASHBOARD", `no dashboard named ${wanted}`, {
        requested: wanted,
        available: dashboards.dashboards.map((d) => d.name),
      });
    }
    // The tab on screen, not the first: the same pick as the Widget Library.
    const tabId = heldTab(target, dashboards.activeTabIds[target.id]) || null;
    const cardId = await dashboards.addCardTo(target.id, tabId, resolved.def);
    if (cardId === null) return fail("ADD_FAILED", "could not add widget");
    ritaMade.add(cardId);
    useAgentEditsStore.getState().push({
      summary: `Rita added "${resolved.def.name}" to "${target.name}"`,
      undo: async () => {
        useDashboardStore.getState().setActive(target.id);
        await useDashboardStore.getState().removeCard(cardId);
      },
    });
    const result: Record<string, unknown> = {
      added: true,
      dashboard_id: target.id,
      card_id: cardId,
      widget_id: resolved.def.id,
      matched_via: resolved.matchedVia,
      tab_id: tabId,
    };
    // D-017: params go through set_widget_params itself (its validation,
    // persistence and Undo entry). A refusal is all-or-nothing there, so the
    // card stays added and the result says what was refused and why.
    // The view (#40) rides the same call, so a bad one refuses it whole too.
    if (args.params !== undefined || args.view !== undefined) {
      const set = await executeLocalTool(
        "set_widget_params",
        { card_id: cardId, ...(args.params !== undefined ? { params: args.params } : {}), ...(args.view !== undefined ? { view: args.view } : {}) },
        { ...deps, dashboardId: target.id },
      );
      // Always reasons as strings: problems for a bad param, else the
      // refusal's message (MISSING_PARAMS, unknown card).
      const refused = set.updated === true ? null : set.problems ?? [isRecord(set.error) ? set.error.message : set.error ?? set.message];
      if (args.params !== undefined) {
        result.params = refused
          ? { applied: [], refused, ...(set.valid_params ? { valid_params: set.valid_params } : {}) }
          : { applied: set.applied };
      }
      if (args.view !== undefined) result.view = refused ? { refused } : set.view;
    }
    return result;
  }

  if (name === "describe_table") return describeTable(args);
  if (name === "arrange_table") return arrangeTable(args);

  if (name === "set_markdown_content") {
    // A one-field wrapper over set_widget_params, so a note's body is written
    // with no nesting to get wrong; validation, persistence and undo are
    // set_widget_params' own.
    const cardId = typeof args.card_id === "string" ? args.card_id : "";
    if (typeof args.text !== "string") return fail("MISSING_TEXT", "text must be a string", { example: { card_id: cardId || "…", text: "## Answer\n…" } });
    const known = useSettingsStore.getState().settings.contextSharing || ritaMade.has(cardId);
    const card = cardId === "" || !known ? undefined : findCard(cardId);
    const def = card ? registry.find(card.backendId, card.widgetId) : undefined;
    if (!card || !def || isAgentOffLimits(def, keyMaintBackends)) {
      // A mis-copied uuid is the usual cause, so list the note/markdown cards
      // that do exist to retry against. An off-limits card gets this same
      // answer and is never listed, and with Context sharing off nothing is
      // listed: the model learns nothing it could not see.
      const sharing = useSettingsStore.getState().settings.contextSharing;
      const notes = (sharing ? (useDashboardStore.getState().activeDashboard()?.tabs ?? []) : []).flatMap((t) =>
        t.cards
          .filter((c) => {
            const d = registry.find(c.backendId, c.widgetId);
            return d && !isAgentOffLimits(d, keyMaintBackends) && (d.type === "note" || d.type === "markdown_editor");
          })
          .map((c) => ({ card_id: c.id, title: c.title ?? "", tab: t.name })),
      );
      return fail("UNKNOWN_CARD", `unknown card ${cardId}. Nothing was saved — retry with a card_id from cards.`, { cards: notes });
    }
    if (def.type !== "note" && def.type !== "markdown_editor") {
      return fail("NOT_MARKDOWN", `card ${cardId} is a ${def.name}, not a note or markdown card; use set_widget_params for its inputs`);
    }
    return executeLocalTool("set_widget_params", { card_id: cardId, params: { text: args.text } }, deps);
  }

  if (name === "set_widget_params") {
    const cardId = typeof args.card_id === "string" ? args.card_id : "";
    if (cardId === "") return { error: "card_id is required" };
    // The model's usual slip is params beside card_id instead of nested under
    // `params` (all of them, or some next to a `params` object). Hand back the
    // corrected call, ready to resend, rather than only saying what is wrong;
    // never save half of it and answer updated: true.
    const flat = Object.fromEntries(Object.entries(args).filter(([k]) => k !== "card_id" && k !== "params" && k !== "view"));
    const nested = isRecord(args.params) ? args.params : {};
    if (Object.keys(flat).length > 0 || (Object.keys(nested).length === 0 && (args.view === undefined || args.params !== undefined))) {
      return Object.keys(flat).length > 0
        ? fail("PARAMS_NOT_NESTED", `params must be nested under "params"; you sent ${Object.keys(flat).join(", ")} beside card_id. Nothing was saved — call again with retry_with.`, {
            received_keys: Object.keys(flat),
            retry_with: { card_id: cardId, params: { ...nested, ...flat } },
          })
        : fail("MISSING_PARAMS", 'params must be a non-empty object, e.g. {"card_id": "…", "params": {"symbol": "MSFT"}}. Nothing was saved.');
    }
    // Unknown card and unknown-kind read the same way get_widget_data's refusal
    // does — the model learns nothing about what exists it should not.
    // A keys widget's params ARE the user's API secrets. It is never the
    // agent's to read or write; refuse it exactly as an unknown card, so the
    // model does not even learn it exists — the rule buildWidgetRefs and
    // get_widget_data already enforce (execute.ts), extended to writes here.
    // Since the settings add-ins: isAgentOffLimits, which also covers the
    // provider_api_keys table and settings widgets.
    const dashboardId = deps?.dashboardId;
    const found = cardAndDef(cardId, dashboardId);
    if ("error" in found) return found;
    const { card, def } = found;
    const declared = new Map(def.params.map((p) => [p.paramName, p]));
    const problems: string[] = [];
    const next: Record<string, string> = {};
    for (const [key, raw] of Object.entries(nested)) {
      const param = declared.get(key);
      if (!param) {
        problems.push(`unknown param "${key}"`);
        continue;
      }
      if (raw === null || typeof raw === "object" || typeof raw === "boolean") {
        problems.push(`param "${key}" must be a string or number`);
        continue;
      }
      let value = String(raw);
      // A dropdown param only accepts one of its declared options; a free-text
      // or number param takes the value as given. multiSelect params are
      // comma-joined, so each piece must be a valid option.
      if (param.options && param.options.length > 0) {
        const allowed = new Set(param.options.map((o) => o.value));
        const pieces = param.multiSelect ? value.split(",").map((s) => s.trim()) : [value];
        const bad = pieces.filter((p) => !allowed.has(p));
        if (bad.length > 0) {
          problems.push(`param "${key}" must be one of: ${param.options.map((o) => o.value).join(", ")}`);
          continue;
        }
        // Stored as validated: the trimmed pieces, not the spaced string
        // ("a, b" saved as "a,b") (review S-lib-3).
        if (param.multiSelect) value = pieces.join(",");
      }
      next[key] = value;
    }
    // A date value goes through the card's own resolver (fieldContext: an atom's `(MIC)`, then the card's symbol, the
    // param, the widget and the dashboard) on the params as they will stand. One it rejects for itself -- an unknown
    // calendar, `@` on a date, an unreadable expression -- is refused here, as sendParams refuses it on the wire,
    // rather than saved for the card to show as an error. A calendar not loaded yet is the card's to wait for, so
    // this check is never strict.
    const after = { ...shownParams(card, def, dashboardId), ...next };
    for (const [key, value] of Object.entries(next)) {
      const param = declared.get(key);
      if (!isPeriodType(param?.type)) continue;
      resolveValue(param.type, value, {
        ...fieldContext(def, param, { exchange: cardDashboard(dashboardId)?.exchange }, after),
        strict: false,
        onError: (m) => problems.push(`param "${key}": ${m}`),
      });
    }
    // #40: the view, from the ones this card's view menu could offer.
    const views = possibleViews(def, card);
    if (args.view !== undefined && args.view !== "default" && !views.includes(args.view as CardView)) {
      problems.push(`view "${String(args.view)}" must be one of: ${["default", ...views].join(", ")}`);
    }
    if (problems.length > 0) {
      // Refuse the whole call and name the valid params, the way arrange_table
      // refuses — one bad name should not half-apply a configuration.
      return { error: "params refused", problems, valid_params: def.params.map((p) => p.paramName) };
    }
    const before = shownParams(card, def, dashboardId);
    const label = card.title ?? def.name;
    // An iframe or rss card loads its url the moment it is set: a URL
    // carrying data out needs no click. Rita may point one only with the
    // user's say-so, through the same prompt external MCP calls use.
    if (URL_LOADING_TYPES.has(def.type) && next.url !== undefined && next.url !== before.url) {
      if (!deps?.confirm) {
        return fail("NEEDS_USER", `Setting the URL of ${label} loads that page in the app; ask the user to set it themselves. Nothing was saved.`);
      }
      if (!(await deps.confirm({ label, url: next.url, tool: "set_widget_params", args: { card_id: cardId, params: next } }))) {
        return fail("user_declined", `The user declined to load ${next.url} in ${label}. Nothing was saved.`);
      }
    }
    const viewBefore = card.view;
    const viewAfter = args.view === "default" ? undefined : (args.view as CardView | undefined);
    // Through splitParamEdit, as the card's own controls write: a grouped
    // param lands on its group, or the group would mask it on the next render.
    const split = (edits: Record<string, string>, c: DashboardCard) => {
      const d = cardDashboard(dashboardId);
      return splitParamEdit(edits, c, d?.groups, def, d?.groupsDisabled === true);
    };
    if (Object.keys(next).length > 0) await dashboards.applyCardParams(cardId, split(next, card));
    if (args.view !== undefined) await dashboards.patchCardField(cardId, "view", viewAfter ?? null);
    useAgentEditsStore.getState().push({
      summary:
        args.view === undefined
          ? `Rita set ${Object.keys(next).length} param(s) on ${label}`
          : `Rita set ${Object.keys(next).length} param(s) and the view on ${label}`,
      // Restores only what Rita changed, and only while it still holds her
      // value: a later edit by the user is never silently overwritten.
      undo: async () => {
        const now = findCard(cardId, dashboardId);
        if (!now) throw new Error(`${label} is gone; there is nothing to undo.`);
        const shown = shownParams(now, def, dashboardId);
        const moved = Object.keys(next).filter((k) => shown[k] !== next[k]);
        if (moved.length > 0 || (args.view !== undefined && now.view !== viewAfter))
          throw new Error(`${label} was changed after Rita's edit (${[...moved, ...(args.view !== undefined && now.view !== viewAfter ? ["view"] : [])].join(", ")}); undo it by hand.`);
        if (Object.keys(next).length > 0) {
          const restore = Object.fromEntries(Object.keys(next).filter((k) => before[k] !== undefined).map((k) => [k, before[k]]));
          const edit = split(restore, now);
          for (const k of Object.keys(next)) if (before[k] === undefined) delete edit.cardParams[k];
          await useDashboardStore.getState().applyCardParams(cardId, edit);
        }
        if (args.view !== undefined) await useDashboardStore.getState().patchCardField(cardId, "view", viewBefore ?? null);
      },
    });
    return { updated: true, card_id: cardId, applied: Object.keys(next), ...(args.view !== undefined ? { view: args.view } : {}) };
  }

  if (name === "remove_widget") {
    const cardId = typeof args.card_id === "string" ? args.card_id : "";
    const found = cardAndDef(cardId);
    if ("error" in found) return found;
    const { card, def } = found;
    if (card.widgetId === LOCAL_TABLE_ID)
      return fail("LOCAL_FILE_CARD", `card ${cardId} is a CSV/XLS table; removing it deletes its stored file, so Rita may not remove it`);
    await dashboards.removeCard(cardId);
    // Clean keeps the exact card, tab and index; Undo is valid only while that entry is current.
    const entry = useDashboardStore.getState().pendingCardRemoval;
    if (entry?.card.id !== cardId) return fail("REMOVE_FAILED", `card ${cardId} could not be removed`);
    useAgentEditsStore.getState().push({
      summary: `Rita removed ${card.title ?? def.name}`,
      undo: async () => {
        if (useDashboardStore.getState().pendingCardRemoval !== entry)
          throw new Error(`Removing "${card.title ?? def.name}" can no longer be undone: another removal replaced it.`);
        await useDashboardStore.getState().undoCardRemoval();
      },
    });
    return { removed: true, card_id: cardId };
  }

  if (name === "add_note") {
    const text = typeof args.text === "string" ? args.text : "";
    if (text === "") return { error: "text is required" };
    const md = BUILTIN_WIDGETS.find((w) => w.id === "markdown");
    if (!md) return { error: "the markdown widget is unavailable" };
    const wanted = typeof args.dashboard_name === "string" ? args.dashboard_name.trim() : "";
    const target = dashByName(wanted);
    if (!target) return { error: `unknown dashboard ${wanted}` };
    const cardId = await dashboards.addCardTo(target.id, heldTab(target, dashboards.activeTabIds[target.id]) || null, md, { text });
    if (cardId === null) return { error: "could not add note" };
    ritaMade.add(cardId);
    useAgentEditsStore.getState().push({
      summary: `Rita added a note to "${target.name}"`,
      undo: async () => {
        useDashboardStore.getState().setActive(target.id);
        await useDashboardStore.getState().removeCard(cardId);
      },
    });
    return { added: true, card_id: cardId, dashboard_id: target.id };
  }

  if (name === "navigate") {
    const dashName = typeof args.dashboard_name === "string" ? args.dashboard_name.trim() : "";
    const tabName = typeof args.tab_name === "string" ? args.tab_name.trim() : "";
    const dash = dashByName(dashName);
    if (!dash) return { error: `unknown dashboard ${dashName}` };
    // Switch as a rail click does (openDashboardAlone): in a workspace a bare
    // setActive changes nothing on screen and leaves later default-target adds
    // on a dashboard no tile shows, so the workspace is left even when the
    // dashboard is already the focused one. It resets the active tab, so the
    // named tab, if any, is set after. setActiveTab takes the dashboard id as
    // well on this line: the active tab is remembered per dashboard here
    // (activeTabIds), not as one global id.
    if (dash.id !== dashboards.activeId || useWorkspacesStore.getState().activeWorkspace()) openDashboardAlone(dash.id);
    let tab: { id: string } | undefined;
    if (tabName !== "") {
      // Exact, then case-insensitive, then the one tab whose name starts with,
      // or has a word equal to, what was asked ("02" -> "02 Read") (D-015).
      const q = tabName.toLowerCase();
      const loose = dash.tabs.filter((t) => t.name.toLowerCase().startsWith(q) || t.name.toLowerCase().split(/\s+/).includes(q));
      tab = dash.tabs.find((t) => t.name === tabName) ??
        dash.tabs.find((t) => t.name.toLowerCase() === q) ??
        (loose.length === 1 ? loose[0] : undefined);
      if (!tab) return { error: `unknown tab ${tabName}; the tabs are: ${dash.tabs.map((t) => t.name).join(", ")}` };
      useDashboardStore.getState().setActiveTab(dash.id, tab.id);
    }
    return { navigated: true, dashboard_id: dash.id, tab_id: tab?.id ?? null };
  }

  if (name === "describe_widget") {
    const cardId = typeof args.card_id === "string" ? args.card_id : "";
    const found = cardAndDef(cardId);
    if ("error" in found) return found;
    const { card, def } = found;
    const shown = shownParams(card, def);
    return {
      card_id: cardId,
      widget: def.name,
      params: def.params.map((p) => ({
        name: p.paramName,
        type: p.type ?? "text",
        current_value: shown[p.paramName] ?? p.value ?? null,
        ...(p.options ? { options: p.options.map((o) => o.value) } : {}),
        ...(p.multiSelect ? { multi: true } : {}),
      })),
    };
  }

  if (name === "add_tab") {
    const tabName = typeof args.name === "string" ? args.name.trim() : "";
    if (tabName === "") return { error: "name is required" };
    // addTab takes the dashboard id on this line (TabBar passes it too); the
    // tool is documented as acting on the current dashboard, so that is the id.
    const dash = dashboards.activeDashboard();
    if (!dash) return { error: "no dashboard is open" };
    const id = await dashboards.addTab(dash.id, tabName);
    if (id === null) return { error: "could not add tab" };
    useAgentEditsStore.getState().push({
      summary: `Rita added tab "${tabName}"`,
      // Rita's tab starts empty; any card on it now is not hers to delete.
      undo: async () => {
        const live = useDashboardStore.getState().dashboards.find((d) => d.id === dash.id)?.tabs.find((t) => t.id === id);
        if (live && live.cards.length > 0)
          throw new Error(`Tab "${tabName}" now holds cards Rita did not add; delete the tab yourself if you want it gone.`);
        await useDashboardStore.getState().removeTab(id);
      },
    });
    return { added: true, tab_id: id };
  }

  if (name === "rename_tab") {
    const tabId = typeof args.tab_id === "string" ? args.tab_id : "";
    const newName = typeof args.name === "string" ? args.name.trim() : "";
    if (newName === "") return { error: "name is required" };
    const tab = dashboards.activeDashboard()?.tabs.find((t) => t.id === tabId);
    if (!tab) return { error: `unknown tab ${tabId}` };
    const before = tab.name;
    await dashboards.renameTab(tabId, newName);
    useAgentEditsStore.getState().push({
      summary: `Rita renamed a tab to "${newName}"`,
      undo: () => useDashboardStore.getState().renameTab(tabId, before),
    });
    return { renamed: true, tab_id: tabId };
  }

  if (name === "rename_widget") {
    const cardId = typeof args.card_id === "string" ? args.card_id : "";
    const title = typeof args.title === "string" ? args.title.trim() : "";
    if (title === "") return { error: "title is required" };
    const found = cardAndDef(cardId);
    if ("error" in found) return found;
    const before = found.card.title;
    await dashboards.patchCardField(cardId, "title", title);
    useAgentEditsStore.getState().push({
      summary: `Rita renamed a card to "${title}"`,
      undo: () => useDashboardStore.getState().patchCardField(cardId, "title", before ?? null),
    });
    return { renamed: true, card_id: cardId };
  }

  if (name === "rename_dashboard") {
    const newName = typeof args.new_name === "string" ? args.new_name.trim() : "";
    if (newName === "") return { error: "new_name is required" };
    const wanted = typeof args.name === "string" ? args.name.trim() : "";
    const dash = dashByName(wanted);
    if (!dash) return { error: `unknown dashboard ${wanted}` };
    const before = dash.name;
    await dashboards.renameDashboard(dash.id, newName);
    useAgentEditsStore.getState().push({
      summary: `Rita renamed dashboard to "${newName}"`,
      undo: () => useDashboardStore.getState().renameDashboard(dash.id, before),
    });
    return { renamed: true, dashboard_id: dash.id };
  }

  if (name === "move_widget") {
    const cardId = typeof args.card_id === "string" ? args.card_id : "";
    const found = cardAndDef(cardId);
    if ("error" in found) return found;
    const before = { ...found.card.layout };
    const at = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : fallback);
    const size = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(1, Math.round(v)) : fallback);
    // The 40-column grid the description promises: x stays in 0–39 and the
    // card ends at column 40 at the latest (review S-lib-6).
    const x = Math.min(39, at(args.x, before.x));
    const next = { x, y: at(args.y, before.y), w: Math.min(40 - x, size(args.w, before.w)), h: size(args.h, before.h) };
    // The grid does not compact (DashboardGrid compactType null), so an
    // overlap is settled at render by pushing the LATER card down, which kept
    // the card already at row 0 on top and moved this one under it. Settle it
    // here the way a drag does: this card takes the spot and each card it
    // lands on (and any those land on) goes down below it.
    const tab = cardDashboard()?.tabs.find((t) => t.cards.some((c) => c.id === cardId));
    const placed = [{ i: cardId, ...next }];
    const hits = (a: typeof next, b: typeof next) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    // v8: a card docked to an edge (the first pinned to it, as DashboardGrid
    // decides) is off the grid; its remembered slot is neither hit nor moved.
    // Moving a docked card itself changes only that slot -- where Unpin puts
    // it back -- so it lands on nothing and pushes nothing (review C5).
    const docked = new Set(PIN_EDGES.map((e) => tab?.cards.find((c) => c.pinned === e)?.id));
    const onGrid = docked.has(cardId) ? [] : (tab?.cards ?? []);
    for (const c of [...onGrid].filter((c) => c.id !== cardId && !docked.has(c.id)).sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x)) {
      const l = { i: c.id, ...c.layout };
      for (let hit = placed.find((p) => hits(p, l)); hit; hit = placed.find((p) => hits(p, l))) l.y = hit.y + hit.h;
      placed.push(l);
    }
    const changed = placed.filter((l) => l.i === cardId || tab?.cards.find((c) => c.id === l.i)?.layout.y !== l.y);
    const undoTo = changed.map((l) => ({ i: l.i, ...(l.i === cardId ? before : tab!.cards.find((c) => c.id === l.i)!.layout) }));
    await dashboards.updateLayouts(changed);
    useAgentEditsStore.getState().push({
      summary: "Rita moved a card",
      undo: () => useDashboardStore.getState().updateLayouts(undoTo),
    });
    return { moved: true, card_id: cardId, layout: next, ...(changed.length > 1 ? { pushed_down: changed.length - 1 } : {}) };
  }

  if (name === "duplicate_widget") {
    const cardId = typeof args.card_id === "string" ? args.card_id : "";
    const found = cardAndDef(cardId);
    if ("error" in found) return found;
    const newId = await dashboards.duplicateCard(cardId);
    if (newId === null) return { error: "could not duplicate" };
    ritaMade.add(newId);
    useAgentEditsStore.getState().push({
      summary: `Rita duplicated ${found.card.title ?? found.def.name}`,
      undo: () => useDashboardStore.getState().removeCard(newId),
    });
    return { duplicated: true, card_id: newId };
  }


  if (name === "pin_card") {
    const cardId = typeof args.card_id === "string" ? args.card_id : "";
    const raw = typeof args.edge === "string" ? args.edge.trim().toLowerCase() : "";
    const edge = raw === "top" ? "top" : raw === "bottom" ? "bottom" : raw === "none" || raw === "" ? null : undefined;
    if (edge === undefined) return { error: 'edge must be "top", "bottom" or "none"' };
    // A locked widget (v8) already sits in a band at an edge of every
    // dashboard; pinning does not apply to it, so this is a no-op with no undo
    // step -- behind the same off-limits gate as every card tool.
    const locked = dashboards.docks.tabs.flatMap((t) => t.cards).find((c) => c.id === cardId);
    if (locked) {
      const gated = cardAndDef(cardId, undefined, locked);
      if ("error" in gated) return gated;
      return { pinned: false, card_id: cardId, reason: "a locked widget sits in a band on every dashboard; it is not pinned to a tab" };
    }
    const found = cardAndDef(cardId);
    if ("error" in found) return found;
    const before = found.card.pinned ?? null;
    // pinCard keeps one card per edge per tab, so pinning to an edge another
    // card of this tab holds unpins that card. Recorded before the pin, so
    // the one Undo step puts it back on its edge too (review C2).
    const tab = cardDashboard()?.tabs.find((t) => t.cards.some((c) => c.id === cardId));
    const displaced = edge === null ? undefined : tab?.cards.find((c) => c.id !== cardId && c.pinned === edge)?.id;
    await dashboards.pinCard(cardId, edge);
    useAgentEditsStore.getState().push({
      summary: edge === null ? "Rita unpinned a card" : `Rita pinned a card to ${edge}`,
      undo: async () => {
        await useDashboardStore.getState().pinCard(cardId, before);
        if (displaced !== undefined && edge !== null) await useDashboardStore.getState().pinCard(displaced, edge);
      },
    });
    return { pinned: true, card_id: cardId, edge };
  }

  if (name === "search_widgets") {
    const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
    const words = [...new Set(query.split(/[^a-z0-9]+/).filter((w) => w.length > 1))];
    // Keys widgets are never surfaced — they hold secrets and are not the
    // agent's to add, the same exclusion buildWidgetRefs makes. Since the
    // settings add-ins that exclusion is isAgentOffLimits (agentWidgets).
    // Any-word match ranked by how many words hit (a stable sort, so catalog
    // order breaks ties): a model's query carries words like "AAPL" or
    // "chart" that no metadata holds, and requiring every word returned
    // nothing (D-010).
    const ranked = agentWidgets
      .map((w) => {
        const hay = [w.id, w.name, w.category, w.subCategory, w.description, ...(w.source ?? [])].join(" ").toLowerCase();
        return { w, hits: words.filter((word) => hay.includes(word) || hay.includes(SEARCH_SYNONYMS.get(word) ?? word)) };
      })
      .filter((r) => words.length === 0 || r.hits.length > 0)
      .sort((a, b) => b.hits.length - a.hits.length);
    const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(50, Math.round(args.limit)) : 20;
    return {
      total: ranked.length,
      all_words_matched: ranked.filter((r) => r.hits.length === words.length).length,
      widgets: ranked.slice(0, limit).map(({ w, hits }) => ({
        id: w.id,
        name: w.name,
        description: (w.description ?? "").slice(0, 160),
        category: w.category ?? "",
        ...(words.length > 0 ? { matched_words: hits } : {}),
      })),
    };
  }

  return fail("UNSUPPORTED", `unsupported tool ${name}`);
}
