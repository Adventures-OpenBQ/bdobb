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

describe("sendFeedback body cap", () => {
  const sent = async (p: FeedbackPayload) => {
    const fetchImpl = vi.fn(async (_u: string, _i: RequestInit) => new Response(null, { status: 204 }));
    await sendFeedback("https://rita.example", p, fetchImpl as unknown as typeof fetch);
    const body = fetchImpl.mock.calls[0][1].body as string;
    return { body, parsed: JSON.parse(body) as FeedbackPayload };
  };
  const big = (ai: string): FeedbackPayload => ({ ...payload, tags: ["Other"], vote: "thumbs_down", ai_response: ai, user_prompt: ai, user_comment: ai });

  it("keeps a 200 KB ASCII reply under 64 KiB", async () => {
    const { body, parsed } = await sent(big("a".repeat(200_000)));
    expect(new TextEncoder().encode(body).length).toBeLessThan(65536);
    expect(parsed.trace_id).toBe("t-1");
    expect(parsed.vote).toBe("thumbs_down");
    expect(parsed.tags).toEqual(["Other"]);
  });
  it("keeps 100K multi-byte characters (emoji, CJK) under 64 KiB without splitting a pair", async () => {
    for (const ch of ["\u{1F600}", "\u6F22"]) {
      const { body, parsed } = await sent(big(ch.repeat(100_000)));
      expect(new TextEncoder().encode(body).length).toBeLessThan(65536);
      expect(parsed.ai_response).toBe(ch.repeat(parsed.ai_response.length / ch.length));
    }
  });
  it("leaves short fields untouched", async () => {
    expect((await sent(payload)).parsed).toEqual(payload);
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
