// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Wire event -> AgentEvent.
 *
 * All eight mappings the protocol documents are implemented. `chunk` and
 * `status` are covered by live captures. `functionCall`, `artifact`, `error`
 * and `done` have validation tests but no capture yet. `citations` and
 * `suggestions` have neither. The untested four are marked below with the
 * fixture that will prove them. They are deliberately NOT tested against
 * hand-written strings: such a test passes against a wrong implementation and
 * a wrong belief about the format simultaneously.
 */
import { isRecord } from "../isRecord";
import { logOnce } from "../logger";
import type { AgentEvent, AgentStatus, SseEvent } from "./types";

const STATUS_KINDS = new Set(["INFO", "WARNING", "ERROR"]);

export function toAgentEvent(event: SseEvent): AgentEvent | null {
  // `error` and `done` are handled before a failed parse returns null: an
  // agent-reported failure is not guaranteed to carry a JSON body (a plain
  // "Internal Server Error" is exactly what the `error` case below exists to
  // catch), and a bare `done` needs no body at all. Bailing out on a failed
  // parse first silently dropped both. This does not cover a
  // block with no `data:` line at all — sse.ts drops those before this
  // function ever sees them; that layer is shared with the MCP client and
  // out of scope here.
  // JSON.parse never yields undefined, so undefined means the parse failed.
  let payload: unknown;
  try {
    payload = JSON.parse(event.data);
  } catch {
    payload = undefined;
  }
  if (event.event === "error") {
    const message =
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : event.data.trim() || "agent error";
    return { type: "error", message };
  }
  if (event.event === "done") {
    return { type: "done" };
  }
  if (payload === undefined) return null;

  switch (event.event) {
    // PROVEN by rita/simple-text.sse and rita-stream.sse.
    case "copilotMessageChunk": {
      if (!isRecord(payload) || typeof payload.delta !== "string") return null;
      return { type: "chunk", delta: payload.delta };
    }

    // PROVEN by rita/error-status.sse.
    case "copilotStatusUpdate": {
      if (!isRecord(payload)) return null;
      const { eventType, message } = payload;
      if (typeof eventType !== "string" || !STATUS_KINDS.has(eventType)) return null;
      if (typeof message !== "string") return null;
      // Spread FIRST, then narrow the two fields we validated. Rebuilding this
      // field-by-field silently dropped `tool_call` and the `artifacts` a
      // completing step carries, which is why reasoning steps once reached the
      // pane stripped of their content.
      const status = { ...payload, eventType, message } as AgentStatus;
      return { type: "status", status };
    }

    // AWAITING rita/function-call.sse.
    case "copilotFunctionCall":
      return isRecord(payload) ? { type: "functionCall", payload } : null;

    // AWAITING rita-artifact-stream.sse.
    case "copilotMessageArtifact":
      return isRecord(payload) ? { type: "artifact", payload } : null;

    // AWAITING rita/roundtrip-answer.sse, which carries a citation collection.
    case "copilotCitationCollection":
      return isRecord(payload) ? { type: "citations", payload } : null;

    // AWAITING rita/suggestions.sse.
    case "copilotPromptSuggestions":
      return isRecord(payload) ? { type: "suggestions", payload } : null;

    // "error" and "done" are handled above, before the JSON parse.

    default:
      // Once per event NAME, not per occurrence: a future Rita emitting a new
      // event type should cost one log line, not one per token.
      void logOnce(`agent-event:${event.event}`, `unknown agent event: ${event.event}`);
      return null;
  }
}
