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

export async function sendFeedback(agentUrl: string, payload: FeedbackPayload, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${agentUrl.replace(/\/+$/, "")}/v1/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(describeHttpError(res.status, await res.text().catch(() => "")));
}
