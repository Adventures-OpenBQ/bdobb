// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describeHttpError } from "../dataClient";
import { logError } from "../logger";
import { toAgentEvent } from "./events";
import { localTableCall } from "./tableResultSummary";
import { normalizeFunctionRounds } from "./limits";
import { buildQueryRequest, queryUrl, type ContextItem, type WidgetRef } from "./request";
import { sseEvents } from "./sse";
import type { AgentEvent, AgentMessage, AgentTool, SkillCatalogEntry, SkillPayload } from "./types";

export const DEFAULT_TIMEOUT_MS = 45_000;
// One round per client-executed call: Rita drains several calls from one model
// step one per re-POST (agent-rita pending_agent_tool_calls, bdobb-v2 #326),
// so a 12-card edit is 12+ rounds. The cap (limits.ts, default 40, user-tightenable)
// only stops a runaway loop.

export type RunAgentQueryOptions = {
  ritaUrl: string;
  messages: AgentMessage[];
  /**
   * Read before every POST, so each round carries the dashboard as it is
   * now — a note Rita just wrote shows its new text, not the empty value
   * from when the turn began. Stale refs made the model rewrite cards it had
   * already saved (bdobb-v2 #326). `secondary` holds the active-dashboard
   * cards the user did not tag: Rita reads these as "on the dashboard" and
   * `primary` as "added to context", and prefers the latter. `context` is
   * sent as request.context (dashboardContext).
   */
  refresh: () => { primary: WidgetRef[]; secondary?: WidgetRef[]; context?: ContextItem[] };
  tools: AgentTool[];
  /** Turns a copilotFunctionCall payload into the tool message Rita expects back. */
  executeFunction: (payload: Record<string, unknown>, signal: AbortSignal) => Promise<AgentMessage>;
  signal?: AbortSignal;
  /** Idle timeout between bytes received (keepalive comments count); 0 disables. */
  timeoutMs?: number;
  /** Client tool-execution rounds per turn; one additional response may summarize. */
  maxFunctionRounds?: number;
  fetchImpl?: typeof fetch;
  /** The keyed object from workspaceOptionsFor; {} when absent. */
  workspaceOptions?: Record<string, boolean | string>;
  /** Enabled skills, as buildQueryRequest sends them on every round. */
  skillsCatalog?: SkillCatalogEntry[];
  /** Skills the typed text forced with /skill:<slug>. */
  selectedSkills?: SkillPayload[];
};

function abortError(): Error {
  return new DOMException("The query was aborted", "AbortError");
}

/**
 * POSTs the conversation, streams the answer, and runs function rounds until
 * Rita answers in text. Yields every mapped event; returns the history
 * including the ai/tool messages added by function rounds.
 */
export async function* runAgentQuery(
  opts: RunAgentQueryOptions,
): AsyncGenerator<AgentEvent, AgentMessage[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxFunctionRounds = normalizeFunctionRounds(opts.maxFunctionRounds);
  const url = queryUrl(opts.ritaUrl);
  const history = [...opts.messages];
  const sourceRows = new Map<string, number>();
  const tablePanels: string[] = [];

  // One extra response can summarize the last result, but cannot execute a tool.
  for (let round = 0; round <= maxFunctionRounds; round++) {
    if (opts.signal?.aborted) {
      if (history.length > opts.messages.length) return history;
      throw abortError();
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onAbort);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const arm = () => {
      if (timeoutMs <= 0) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    };

    let call: Record<string, unknown> | null = null;
    let sawEvent = false;
    const now = opts.refresh();
    try {
      arm();
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(buildQueryRequest(history, { primary: now.primary, secondary: now.secondary, tools: opts.tools, workspaceOptions: opts.workspaceOptions, skillsCatalog: opts.skillsCatalog, selectedSkills: opts.selectedSkills, context: now.context })),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(describeHttpError(res.status, await res.text().catch(() => "")));
      if (!res.body) throw new Error(`empty response body from ${url}`);
      // Rita's ":" keepalives during a long think re-arm the idle timer too.
      for await (const raw of sseEvents(res.body, arm)) {
        arm();
        const event = toAgentEvent(raw);
        if (event === null) continue;
        sawEvent = true;
        // Once local table results exist, their figures replace model prose.
        // Function rounds/status/errors still run, including multi-table work.
        if (event.type !== "chunk" || tablePanels.length === 0) yield event;
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "functionCall") call = event.payload;
        if (event.type === "done") break;
      }
    } catch (err) {
      if (timedOut) throw new Error(`timed out after ${timeoutMs}ms waiting on ${url}`);
      if (opts.signal?.aborted) {
        if (history.length > opts.messages.length) return history;
        throw abortError();
      }
      throw err;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }

    if (call === null) {
      if (!sawEvent) void logError(`agent: round ${round} ended with no events (truncated turn?)`);
      return history;
    }
    if (opts.signal?.aborted) {
      if (history.length > opts.messages.length) return history;
      throw abortError();
    }
    if (round === maxFunctionRounds) {
      // Return rather than throw: chatStore persists returned tool history.
      // Dropping it would lose chart IDs and encourage duplicate mutations on
      // the next turn. Do not append the unexecuted call to that history.
      const message =
        `Stopped at the ${maxFunctionRounds}-round tool limit. ` +
        "Completed tool results have been retained, but the requested workflow may be incomplete. " +
        "Review those results before retrying actions.";
      yield { type: "status", status: { eventType: "WARNING", message } };
      yield { type: "chunk", delta: `\n\n${message}` };
      return history;
    }
    history.push({ role: "ai", content: { function: call.function, input_arguments: call.input_arguments } });
    let executed: AgentMessage;
    try {
      executed = await opts.executeFunction(call, opts.signal ?? new AbortController().signal);
    } catch (err) {
      // An interrupted call has no completed result. Keep earlier tool pairs,
      // excluding this unmatched call so the next turn cannot treat it as done.
      history.pop();
      if (opts.signal?.aborted && history.length > opts.messages.length) return history;
      throw err;
    }
    const client = executed.role === "tool" ? executed.clientTableResult : undefined;
    if (executed.role === "tool") {
      const { clientTableResult: _private, ...wire } = executed;
      history.push(wire);
    } else history.push(executed);
    const tableCall = localTableCall(call);
    if (tableCall && client?.cardId === tableCall.cardId) {
      if (client.kind === "inspection" && tableCall.tool === "describe_table") {
        if (typeof client.sourceRows === "number" && Number.isSafeInteger(client.sourceRows) && client.sourceRows >= 0) sourceRows.set(client.cardId, client.sourceRows);
        else sourceRows.delete(client.cardId);
      } else if (client.kind === "result" && (tableCall.tool === "arrange_table" || tablePanels.length > 0)) {
        const count = sourceRows.get(client.cardId);
        tablePanels.push([client.text, ...(count === undefined ? [] : [`Source rows: ${count}.`]), client.ending].filter(Boolean).join("\n\n"));
        yield { type: "tableSummary", text: `${tablePanels.join("\n\n---\n\n")}\n\nThis response shows engine table results. Other requested explanations are not included; ask those in a separate message.` };
      }
    }
    // A completed call may have committed just as Stop arrived. Retain its
    // result and presentation, but never start another model/tool round.
    if (opts.signal?.aborted) return history;
  }
  return history;
}
