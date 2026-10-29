// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Workspace feedback (agents-for-openbb 42): a thumbs vote on one AI message,
 * sent only when the agent advertises `features.feedback` and only on a click.
 */
import { describeHttpError } from "../dataClient";
import type { AgentDescriptor } from "./types";

export type FeedbackVote = "thumbs_up" | "thumbs_down";
export type FeedbackPayload = {
  vote: FeedbackVote;
  tags: string[];
  user_comment: string;
  ai_response: string;
  user_prompt: string;
  /** Minted by the client per AI message: Rita sends no trace id on the wire. */
  trace_id: string;
};

/** The thumbs-down tags known from Workspace (example 42's recorded feedback). */
export const FEEDBACK_TAGS = ["Not factually correct / Hallucinations / Inaccurate", "Other"] as const;

export function advertisesFeedback(agent: AgentDescriptor | undefined): boolean {
  const f = agent?.features.feedback;
  return f?.kind === "boolean" && f.value;
}

// The public door refuses a feedback body over 64 KiB (413), so a long reply
// or prompt could never be rated. Worst case a JSON-escaped control character
// costs 6 bytes (4 for a raw astral character), so 7000 + 1800 + 900 chars
// is at most 58.2 KB, leaving room for the fixed keys, tags and trace id.
const CLIP = { ai_response: 7000, user_prompt: 1800, user_comment: 900 } as const;

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  // Do not leave half a surrogate pair at the cut.
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

export async function sendFeedback(agentUrl: string, payload: FeedbackPayload, fetchImpl: typeof fetch = fetch): Promise<void> {
  const body = {
    ...payload,
    ai_response: clip(payload.ai_response, CLIP.ai_response),
    user_prompt: clip(payload.user_prompt, CLIP.user_prompt),
    user_comment: clip(payload.user_comment, CLIP.user_comment),
  };
  const res = await fetchImpl(`${agentUrl.replace(/\/+$/, "")}/v1/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(describeHttpError(res.status, await res.text().catch(() => "")));
}
