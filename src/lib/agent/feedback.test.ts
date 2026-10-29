// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import { advertisesFeedback, sendFeedback, type FeedbackPayload } from "./feedback";
import type { AgentDescriptor } from "./types";

const payload: FeedbackPayload = { vote: "thumbs_up", tags: [], user_comment: "", ai_response: "hello", user_prompt: "hi", trace_id: "t-1" };

describe("sendFeedback", () => {
  it("POSTs the payload as JSON to <agent>/v1/feedback", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await sendFeedback("https://rita.example/", payload, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith("https://rita.example/v1/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  it("throws on an answer that is not 2xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(sendFeedback("https://rita.example", payload, fetchImpl as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe("advertisesFeedback", () => {
  const agent = (features: AgentDescriptor["features"]): AgentDescriptor => ({ id: "a", name: "A", description: "", queryPath: "/v1/query", features });
  it("is true only for a boolean feedback feature set to true", () => {
    expect(advertisesFeedback(agent({ feedback: { kind: "boolean", value: true } }))).toBe(true);
    expect(advertisesFeedback(agent({ feedback: { kind: "boolean", value: false } }))).toBe(false);
    expect(advertisesFeedback(agent({}))).toBe(false);
    expect(advertisesFeedback(undefined)).toBe(false);
  });
});
