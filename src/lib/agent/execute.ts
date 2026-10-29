// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { correctStatementData } from "../../hooks/useStatementYearEnds";
import { fetchWidgetData, joinUrl } from "../dataClient";
import { isRecord } from "../isRecord";
import { safeUrl } from "../safeUrl";
import { isCardAgentOffLimits } from "../providerKeys";
import { logError } from "../logger";
import type { Skill } from "../skillsFiles";
import { effectiveParams } from "../paramGroups";
import type { WireContext } from "../params";
import type { BackendConfig, DashboardCard, ParamGroup, WidgetDef } from "../types";
import { LOCAL_TOOL_SERVER_ID, executeLocalTool } from "./localTools";
import { normalizeMcpUrl } from "./mcp";
import { hostnameOf } from "./mcpAuth";
import { McpError, toolErrorOf } from "./mcpError";
import { PROXY_TOOLS, disabledEffective, effectiveToolNames } from "./proxiedTools";
import type { WidgetRef } from "./request";
import type { AgentCall, AgentMessage, McpServerConfig } from "./types";

/** Describes dashboard cards the way Rita's `widgets.primary` expects. */
export function buildWidgetRefs(
  cards: DashboardCard[],
  lookupWidget: (backendId: string, widgetId: string) => WidgetDef | undefined,
  backendName: (backendId: string) => string | undefined,
  /** keyMaintBackendIds over the whole registry; see isAgentOffLimits. */
  keyMaintBackends: ReadonlySet<string>,
  /** The cards' dashboard: current_value is what the card fetches with, groups applied. */
  dashboard?: { groups?: ParamGroup[]; groupsDisabled?: boolean },
): WidgetRef[] {
  const refs: WidgetRef[] = [];
  for (const c of cards) {
    const w = lookupWidget(c.backendId, c.widgetId);
    if (!w || isCardAgentOffLimits(c, cards, lookupWidget, keyMaintBackends)) continue;
    const shown = effectiveParams(c, dashboard?.groups, w, dashboard?.groupsDisabled === true);
    refs.push({
      uuid: c.id,
      origin: c.backendId,
      widget_id: w.id,
      name: c.title ?? w.name,
      description: w.description,
      metadata: { backend_name: backendName(c.backendId) ?? c.backendId },
      params: w.params.map((p) => ({
        name: p.paramName,
        type: "text",
        description: p.description ?? p.label ?? p.paramName,
        current_value: shown[p.paramName] ?? p.value ?? "",
        default_value: p.value ?? "",
      })),
    });
  }
  return refs;
}

/** `pdf` and `name` only for a pdf widget: its document goes to the agent as a file, named after the card. */
export type WidgetFetch = { data: unknown; url: string; params: Record<string, string>; pdf?: boolean; name?: string };
export type WidgetFetcher = (source: Record<string, unknown>, signal: AbortSignal) => Promise<WidgetFetch>;

type FetcherDeps = {
  cards: DashboardCard[];
  backends: BackendConfig[];
  findWidget: (backendId: string, widgetId: string) => WidgetDef | undefined;
  /** keyMaintBackendIds over the whole registry; see isAgentOffLimits. */
  keyMaintBackends: ReadonlySet<string>;
  /**
   * The query and wire context the card itself sends (cardRequestSync):
   * groups, fiscal relabelling, trading calendars, the dashboard's exchange,
   * and a Run-button card's last-run params. `overrides` are the model's
   * declared input_args, so the calendars are chosen on what is sent.
   */
  request: (
    card: DashboardCard,
    widget: WidgetDef,
    backend: BackendConfig,
    overrides: Record<string, string>,
  ) => { query: Record<string, string>; ctx: WireContext };
};

/**
 * Resolves a `data_sources[]` entry to a card on the active dashboard and
 * fetches it. Every refusal reads `unknown widget <uuid>` so Rita cannot
 * probe which backends or widgets exist.
 */
export function makeWidgetDataFetcher(deps: FetcherDeps, fetchData = fetchWidgetData): WidgetFetcher {
  return async (source, signal) => {
    const uuid = String(source.widget_uuid ?? "");
    const refuse = () => new Error(`unknown widget ${uuid}`);
    const card = deps.cards.find((c) => c.id === uuid);
    if (!card) throw refuse();
    const backend = deps.backends.find((b) => b.id === card.backendId && b.id === source.origin);
    if (!backend) throw refuse();
    const widget = deps.findWidget(card.backendId, card.widgetId);
    if (!widget || isCardAgentOffLimits(card, deps.cards, deps.findWidget, deps.keyMaintBackends)) throw refuse();
    const overrides: Record<string, string> = {};
    if (isRecord(source.input_args)) {
      // Only the parameters this widget declares. input_args come from the
      // model, whose context can carry injected text, and an undeclared key
      // would reach the backend as a query parameter the user never set.
      const declared = new Set(widget.params.map((p) => p.paramName));
      for (const [k, v] of Object.entries(source.input_args)) {
        if (declared.has(k) && v !== null && v !== undefined) overrides[k] = typeof v === "string" ? v : JSON.stringify(v);
      }
    }
    // What useWidgetData sends, resolved on the same calendars and exchange: chosen on the overridden params, since a
    // calendar follows `symbol` and an atom's `(MIC)`. fetchWidgetData sends through sendParams, so a value that
    // cannot resolve refuses the whole fetch (CalendarError) and nothing reaches the backend.
    const sent = deps.request(card, widget, backend, overrides);
    const params: Record<string, string> = { ...sent.query, ...overrides };
    const query = new URLSearchParams(params).toString();
    const url = joinUrl(backend.baseUrl, widget.endpoint) + (query === "" ? "" : `?${query}`);
    // Rita reads the statement rows the card shows, fiscal labels corrected (dev 191610b01).
    const data = await correctStatementData(backend, widget, params, await fetchData(backend, widget, params, sent.ctx, signal));
    // The same test WidgetCard uses to choose PdfRenderer.
    return widget.type === "pdf" ? { data, url, params, pdf: true, name: card.title ?? widget.name } : { data, url, params };
  };
}

/** An external MCP tool call, as the user is asked to approve it. */
export type ToolRequest = { label: string; url: string; tool: string; args: Record<string, unknown> };
/** Asks the user whether an external MCP tool call may run; resolves false when denied. */
export type ConfirmTool = (request: ToolRequest) => Promise<boolean>;

export type ExecuteDeps = {
  fetchWidget: WidgetFetcher;
  runAgentTool: (serverId: string, tool: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown | null>;
  onCall?: (call: AgentCall) => void;
  /** An execute_agent_tool call failed; chatStore turns this into a tool-error artifact. */
  onToolError?: (e: { server: string; tool: string; code: string; message: string; input?: Record<string, unknown> }) => void;
  /** Stop ended the turn while an execute_agent_tool call was running: a cancel, not a failure. */
  onToolStopped?: (e: { server: string; tool: string; input?: Record<string, unknown> }) => void;
  /**
   * The enabled skill for a slug, or undefined. Rita's get_skill_content is
   * answered from memory: the skills store already holds every file.
   */
  readSkill?: (slug: string) => Skill | undefined;
};

/** Characters of one tool result's content: every result is re-sent each round and persisted with the chat. */
export const MAX_RESULT_CHARS = 100_000;

/** Rows as an array, or `{ rows }`; null for anything else. */
function rowsOf(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.rows) ? value.rows : null;
}

/**
 * `data` serialized within MAX_RESULT_CHARS. Rows (an array, or `{ rows }`)
 * keep the leading rows that fit, with `truncated`, `total_rows` and
 * `returned_rows` saying so; anything else is cut, with a marker the model reads.
 */
export function capContent(data: unknown): string {
  const text = typeof data === "string" ? data : JSON.stringify(data) ?? "null";
  if (text.length <= MAX_RESULT_CHARS) return text;
  let value = data;
  if (typeof data === "string") {
    try {
      value = JSON.parse(data);
    } catch {
      value = undefined;
    }
  }
  const rows = rowsOf(value);
  if (rows) {
    const wrap = (n: number) => JSON.stringify({ truncated: true, total_rows: rows.length, returned_rows: n, rows: rows.slice(0, n) });
    // Binary search for the most leading rows that fit.
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (wrap(mid).length <= MAX_RESULT_CHARS) lo = mid;
      else hi = mid - 1;
    }
    return wrap(lo);
  }
  const marker = `\n[truncated: showing ${MAX_RESULT_CHARS} of ${text.length} characters]`;
  return text.slice(0, MAX_RESULT_CHARS - marker.length) + marker;
}

/**
 * A pdf card's document as the protocol's file item. A backend's link stays a
 * link (openbb-ai's SingleFileReference; Rita fetches `url`); bytes go as base64
 * within MAX_RESULT_CHARS, and past it the call fails rather than send half a PDF.
 */
export function pdfItem(data: unknown, name: string): Record<string, unknown> {
  const doc = isRecord(data) ? data : {};
  const format = isRecord(doc.data_format) ? doc.data_format : {};
  const filename = typeof format.filename === "string" && format.filename.trim() !== "" ? format.filename : `${name}.pdf`;
  const data_format = { data_type: "pdf", filename };
  const link = typeof doc.content !== "string" && typeof doc.url === "string" ? safeUrl(doc.url) : null;
  if (link !== null) return { url: link, data_format, citable: true };
  if (typeof doc.content !== "string") throw new Error(`${name}: not a document payload`);
  if (doc.content.length > MAX_RESULT_CHARS) {
    throw new Error(`${name}: the PDF is ${doc.content.length} base64 characters, over the ${MAX_RESULT_CHARS}-character limit for one tool result`);
  }
  return { content: doc.content, data_format, citable: true };
}

function rowCount(data: unknown): number {
  return rowsOf(data)?.length ?? 0;
}

async function widgetDataResults(sources: unknown, deps: ExecuteDeps, signal: AbortSignal): Promise<unknown[]> {
  const list = Array.isArray(sources) ? sources.filter(isRecord) : [];
  const out: unknown[] = [];
  for (const source of list) {
    const started = Date.now();
    try {
      const { data, url, params, pdf, name } = await deps.fetchWidget(source, signal);
      const item = pdf
        ? pdfItem(data, name ?? String(source.widget_uuid ?? ""))
        : { content: capContent(data), data_format: { data_type: "object", parse_as: "table" }, citable: true };
      deps.onCall?.({ kind: "widget_data", url, params, ok: true, durationMs: Date.now() - started, rows: rowCount(data) });
      out.push({ items: [item] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.onCall?.({
        kind: "widget_data",
        url: "",
        params: {},
        ok: false,
        error: message,
        durationMs: Date.now() - started,
        rows: 0,
      });
      out.push({ error_type: "fetch_failed", message });
    }
  }
  return out;
}

/**
 * The `data` of an execute_agent_tool tool message, in the shape agent-rita's
 * processMcpResult iterates: a LIST of entries, each with `items`, each item
 * carrying its text as `text` (or `content`). An MCP result's `content[]`
 * already is a list of `{ type: "text", text }` items, so it rides through
 * as the one entry's items; anything else (a local tool's object, a refusal,
 * a thrown tool) becomes one JSON text item. A bare object made Rita's
 * `for (const entry of toolMsg.data)` throw "{} is not iterable" and end the
 * turn with no answer (issue #322).
 */
/**
 * The code and message of any not-completed tool result, classified once
 * (#39, bdobb#43):
 * - an `error_type` (the client's user_declined, unsupported, fetch_failed);
 * - a top-level `{ status: "refused" | "unavailable" | "error" }`, the table
 *   tools' refusal shape;
 * - an `{ error }` result (a plain string, or fail()'s `{ code, message }`);
 * - agent-rita's typed error, a `$rita_kind: "error"` item in `content`.
 */
function refusalOf(result: unknown): { code: string; message: string } | null {
  if (!isRecord(result)) return null;
  if (typeof result.error_type === "string" && result.error_type !== "") {
    return { code: result.error_type, message: String(result.message ?? result.error_type) };
  }
  if (result.status === "refused" || result.status === "unavailable" || result.status === "error") {
    return { code: String(result.code ?? result.reason ?? result.status), message: String(result.message ?? result.status) };
  }
  if (!result.error) return ritaTypedError(result);
  const e = result.error;
  if (isRecord(e)) return { code: String(e.code ?? "refused"), message: String(e.message ?? JSON.stringify(e)) };
  const problems = Array.isArray(result.problems) ? `: ${result.problems.join("; ")}` : "";
  return { code: "refused", message: `${String(e)}${problems}` };
}

/** agent-rita's typed error item (`{ $rita_kind: "error", error }`) inside an MCP result's `content`. */
function ritaTypedError(result: Record<string, unknown>): { code: string; message: string } | null {
  if (!Array.isArray(result.content)) return null;
  for (const item of result.content) {
    if (!isRecord(item) || typeof item.text !== "string" || !item.text.trimStart().startsWith("{")) continue;
    try {
      const parsed: unknown = JSON.parse(item.text);
      if (isRecord(parsed) && parsed.$rita_kind === "error" && isRecord(parsed.error)) {
        return { code: String(parsed.error.code ?? "error"), message: String(parsed.error.message ?? parsed.error.code ?? "error") };
      }
    } catch {
      // Not JSON: an ordinary text item.
    }
  }
  return null;
}

function toolResultData(result: unknown, failure?: { code: string; message: string } | null): unknown[] {
  const raw = isRecord(result) && Array.isArray(result.content) ? result.content : [{ type: "text", text: JSON.stringify(result ?? null) }];
  // Each item within MAX_RESULT_CHARS; a non-text item is capped as its JSON.
  const items = raw.map((item: unknown) =>
    isRecord(item) && typeof item.text === "string"
      ? item.text.length > MAX_RESULT_CHARS ? { ...item, text: capContent(item.text) } : item
      : JSON.stringify(item ?? null).length > MAX_RESULT_CHARS ? { type: "text", text: capContent(item) } : item,
  );
  // A failed call leads with agent-rita's typed error item, so Rita's own
  // status reads "<tool> returned an error" (WARNING) instead of "completed"
  // beside our ERROR step. Rita passes that item's code and message only, so
  // the result itself (retry_with and the rest) still follows.
  if (!failure) return [{ items }];
  const typed = { type: "text", text: JSON.stringify({ $rita_kind: "error", error: failure }) };
  return [{ items: [typed, ...items] }];
}

/**
 * Executes a copilotFunctionCall payload and builds the tool message Rita
 * expects back. The fields sit at the top level of the message, beside
 * `role`, because that is what agent-rita's `ToolMessage` type declares and
 * what its round-trip reads; a `content` wrapper is silently ignored.
 */
export async function executeFunction(
  payload: Record<string, unknown>,
  deps: ExecuteDeps,
  signal: AbortSignal,
): Promise<AgentMessage> {
  const fn = payload.function;
  const args = isRecord(payload.input_arguments) ? payload.input_arguments : {};
  let data: unknown = { error_type: "unsupported" };
  if (fn === "get_widget_data") {
    data = await widgetDataResults(args.data_sources, deps, signal);
  } else if (fn === "execute_agent_tool") {
    const serverId = String(args.server_id ?? "");
    const tool = String(args.tool_name ?? args.tool ?? "");
    // agent-rita's executeAgentTool event carries the tool's input as
    // `parameters` (src/protocol/events.ts); `input` / `args` are kept for
    // the older shapes. With only the old keys every local tool ran with `{}`.
    const input = isRecord(args.parameters) ? args.parameters : isRecord(args.input) ? args.input : isRecord(args.args) ? args.args : {};
    // The input rides on the error report only for a proxy, whose label needs it.
    const proxyInput = (PROXY_TOOLS as readonly string[]).includes(tool) ? { input } : {};
    let result: unknown;
    let failure: { code: string; message: string } | null = null;
    try {
      result = await deps.runAgentTool(serverId, tool, input, signal);
      if (result === null) result = { error_type: "unsupported" };
    } catch (err) {
      // Stop ended the turn mid-call: report it as stopped and let the abort
      // end the turn; nobody is left to read a result (bdobb#43).
      if (signal.aborted) {
        deps.onToolStopped?.({ server: serverId, tool, ...proxyInput });
        throw err;
      }
      const { code, message } = toolErrorOf(err);
      // The agent sees what failed and why, so it can plan around it. A call
      // refused before it was sent (disabled tool) never throws, so it comes
      // back as a typed { error } and carries no error_type; this field is
      // only for thrown failures, kept for anything already reading it.
      result = { error_type: "tool_failed", code, server: serverId, tool, message };
      failure = { code, message };
      deps.onToolError?.({ server: serverId, tool, code, message, ...proxyInput });
    }
    // A refusal answered normally ({ error }, local tool or MCP server) is
    // still a failed call: the agent reads it as is, and the chat shows and
    // counts it, so a rejected save never reads as "0 errors". Outside the
    // try, so a throwing reporter cannot turn it into a second tool_failed.
    // A thrown failure was already reported above; classify everything else once.
    const refused = failure ? null : refusalOf(result);
    if (refused) {
      failure = refused;
      deps.onToolError?.({ server: serverId, tool, ...refused, ...proxyInput });
    }
    data = toolResultData(result, failure);
  } else if (fn === "get_skill_content") {
    // agent-rita's extractSkillContent reads data[0].status, then
    // data[0].data.skill.contentMarkdown on success or data[0].message on
    // error. A disabled skill is "not found": turning one off means Rita
    // cannot read it, not merely that it is left off the catalogue.
    const slug = String(args.slug ?? "");
    const skill = deps.readSkill?.(slug);
    data = skill
      ? [{ status: "success", data: { skill: { slug: skill.slug, description: skill.description, contentMarkdown: skill.content } } }]
      : [{ status: "error", message: `Skill "${slug}" not found` }];
  } else {
    void logError(`agent: unsupported function ${String(fn)}`);
  }
  return {
    role: "tool",
    function: fn,
    input_arguments: payload.input_arguments,
    data,
    extra_state: payload.extra_state,
  };
}

/**
 * Routes a tool call to the local tools, an enabled Settings server, or a
 * widget-derived server. A widget-derived server's id IS its URL (that is
 * how assembleTools labels it), so the id Rita echoes back is only honoured
 * when that URL is on the active dashboard right now -- a hand-built call
 * must not be able to make the app contact an arbitrary URL. Throws when
 * nothing matches.
 */
export async function runAgentTool(
  serverId: string,
  tool: string,
  args: Record<string, unknown>,
  mcpServers: McpServerConfig[],
  dashboardMcp: string[],
  call: (
    server: McpServerConfig | undefined,
    url: string,
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<unknown>,
  opts?: {
    /** mcpDisabledTools, keyed by normalized server URL. */
    disabledTools?: Record<string, string[]>;
    /** A call went through; `names` are its effective tool names (see proxiedTools). */
    onEffective?: (url: string, names: string[]) => void;
    /** The turn's signal: Stop cancels an MCP call that is already running. */
    signal?: AbortSignal;
    /**
     * Asked before every external MCP call (never for the local tools): an
     * external server can place an order or write a note, and injected text
     * in widget data can talk the model into such a call.
     */
    confirm?: ConfirmTool;
  },
): Promise<unknown | null> {
  // The local tools take the table tools' row reader; everything else about
  // this line's routing is unchanged. The untrusted-data bracketing main's
  // v6.1.1 commit adds has no counterpart on this line -- the v6.1.1 re-cut
  // here is the agent/MCP parity work only, and nothing on this line brackets
  // tool results, MCP results included -- so it is deliberately not
  // back-ported.
  if (serverId === LOCAL_TOOL_SERVER_ID) return executeLocalTool(tool, args, { confirm: opts?.confirm });
  const server = mcpServers.find((s) => s.id === serverId && s.enabled);
  // A turned-off tool, or a proxied one (call_tool / run_pipeline) whose
  // effective name is turned off, is refused here -- before anything is sent
  // and before a widget-derived server's session is resolved. Keyed the way
  // assembleTools keys the map: the Settings entry's URL, or the
  // widget-derived server's id, which IS its URL. A malformed proxy call is
  // refused too: it could not be checked, so it is not forwarded.
  const keyUrl = normalizeMcpUrl(server?.url ?? serverId);
  const blocked = disabledEffective(keyUrl, tool, args, opts?.disabledTools);
  if (blocked && "disabled" in blocked) {
    const label = server?.name ?? (hostnameOf(server?.url ?? serverId) ?? serverId);
    return {
      error: {
        code: "TOOL_DISABLED",
        message: `${blocked.disabled.join(", ")} ${blocked.disabled.length === 1 ? "is" : "are"} turned off for ${label} in AI Library > MCP Servers; the call was not sent.`,
      },
    };
  }
  if (blocked) return { error: { code: "INVALID_PROXY_CALL", message: `${blocked.malformed} The call was not sent.` } };
  const done = (result: unknown) => {
    // Only a call that worked proves the name exists; a failed one may be a typo.
    const failed = refusalOf(result) !== null || (isRecord(result) && result.isError === true);
    const eff = effectiveToolNames(tool, args);
    if (!failed && eff.ok && eff.via !== undefined) opts?.onEffective?.(keyUrl, eff.names);
    return result;
  };
  const url = server ? server.url : normalizeMcpUrl(serverId);
  // Silence here used to become an empty result the agent took as "nothing
  // found"; an unknown server is a failure the user should see.
  if (!server && !dashboardMcp.includes(url)) {
    throw new McpError("unknown_server", `no enabled MCP server "${serverId}" is available to this chat`);
  }
  const label = server?.name ?? hostnameOf(url) ?? url;
  if (opts?.confirm && !(await opts.confirm({ label, url, tool, args }))) {
    return { error_type: "user_declined", message: `The user declined to run ${tool} on ${label}.` };
  }
  return call(server, url, tool, args, opts?.signal).then(done);
}
