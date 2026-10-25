// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runAgentQuery } from "./query";
import type { AgentEvent, AgentMessage } from "./types";

vi.mock("../logger", () => ({ logError: vi.fn(async () => {}) }));

const fixture = (name: string) => readFileSync(`src/test/fixtures/rita/${name}.sse`, "utf8");
const sse = (text: string) =>
  new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });

type Call = { url: string; init: RequestInit };

function fetchOf(responses: Array<() => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    // Abort-aware, like real fetch: an aborted signal rejects the pending
    // call even when the mocked response would otherwise hang forever.
    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      const onAbort = () => reject(new DOMException("aborted", "AbortError"));
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort);
      Promise.resolve(next()).then(resolve, reject);
    });
  };
  return { calls, fetchImpl };
}

function bodyOf(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

async function collect(gen: AsyncGenerator<AgentEvent, AgentMessage[]>) {
  const events: AgentEvent[] = [];
  for (;;) {
    const next = await gen.next();
    if (next.done) return { events, history: next.value };
    events.push(next.value);
  }
}

/** A fetch call that never resolves on its own; the abort-aware wrapper above errors it. */
function hanging(): () => Promise<Response> {
  return () => new Promise(() => {});
}

const messages: AgentMessage[] = [{ role: "human", content: "hello" }];
const base = { ritaUrl: "https://rita.example", messages, refresh: () => ({ primary: [] }), tools: [] };
const noFunction = async () => {
  throw new Error("executeFunction should not be called");
};

describe("runAgentQuery", () => {
  it("streams a plain answer and returns the history unchanged", async () => {
    const { calls, fetchImpl } = fetchOf([() => sse(fixture("simple-text"))]);
    const { events, history } = await collect(
      runAgentQuery({ ...base, executeFunction: noFunction, fetchImpl }),
    );
    expect(events.filter((e) => e.type === "chunk")).toHaveLength(28);
    expect(history).toEqual(messages);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://rita.example/v1/query");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Accept).toBe("text/event-stream");
    expect(bodyOf(calls[0]).tools).toEqual([]);
  });

  it("executes a function call and posts the tool result in the next round", async () => {
    const { calls, fetchImpl } = fetchOf([
      () => sse(fixture("function-call")),
      () => sse(fixture("roundtrip-answer")),
    ]);
    const executeFunction = vi.fn(async (payload: Record<string, unknown>): Promise<AgentMessage> => {
      expect(payload.function).toBe("get_widget_data");
      return { role: "tool", function: "get_widget_data", input_arguments: {}, data: [] };
    });
    const { events, history } = await collect(runAgentQuery({ ...base, executeFunction, fetchImpl }));
    expect(executeFunction).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect((bodyOf(calls[1]).messages as unknown[]).length).toBe(3);
    expect(history).toHaveLength(3);
    expect(history[1].role).toBe("ai");
    expect(history[2].role).toBe("tool");
    expect(events.some((e) => e.type === "functionCall")).toBe(true);
    expect(events.filter((e) => e.type === "chunk").length).toBeGreaterThan(28);
  });

  it("yields an ERROR status without throwing", async () => {
    const { fetchImpl } = fetchOf([() => sse(fixture("error-status"))]);
    const { events } = await collect(runAgentQuery({ ...base, executeFunction: noFunction, fetchImpl }));
    const status = events.find((e) => e.type === "status");
    expect(status && status.type === "status" && status.status.eventType).toBe("ERROR");
    expect(events.some((e) => e.type === "chunk")).toBe(true);
  });

  it("yields an error event, then throws with its message", async () => {
    const { fetchImpl } = fetchOf([() => sse("event: error\ndata: boom\n\n")]);
    const gen = runAgentQuery({ ...base, executeFunction: noFunction, fetchImpl });
    const first = await gen.next();
    expect(first.value).toEqual({ type: "error", message: "boom" });
    await expect(gen.next()).rejects.toThrow("boom");
  });

  it("throws on a non-2xx response", async () => {
    const { fetchImpl } = fetchOf([() => new Response("nope", { status: 500 })]);
    await expect(collect(runAgentQuery({ ...base, executeFunction: noFunction, fetchImpl }))).rejects.toThrow(
      /^HTTP 500/,
    );
  });

  it("times out when the stream goes idle", async () => {
    const { fetchImpl } = fetchOf([hanging()]);
    await expect(
      collect(runAgentQuery({ ...base, executeFunction: noFunction, fetchImpl, timeoutMs: 20 })),
    ).rejects.toThrow("timed out after 20ms waiting on https://rita.example/v1/query");
  });

  it("keepalive comments hold the idle timeout open while Rita thinks", async () => {
    // Rita writes ":\n\n" every 15s while the model thinks (agent-rita
    // stream.ts). Those blocks carry no event, but they prove the connection
    // is alive, so a think longer than the timeout must not fail the turn.
    const encoder = new TextEncoder();
    const fetchImpl: typeof fetch = async (_input, init) => {
      const timers: ReturnType<typeof setTimeout>[] = [];
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => {
            timers.forEach(clearTimeout);
            controller.error(new DOMException("aborted", "AbortError"));
          });
          for (let t = 10; t <= 80; t += 10) timers.push(setTimeout(() => controller.enqueue(encoder.encode(":\n\n")), t));
          timers.push(
            setTimeout(() => {
              controller.enqueue(encoder.encode(fixture("simple-text")));
              controller.close();
            }, 90),
          );
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    const { events } = await collect(runAgentQuery({ ...base, executeFunction: noFunction, fetchImpl, timeoutMs: 40 }));
    expect(events.some((e) => e.type === "chunk")).toBe(true);
  });

  it("rejects with AbortError when the caller aborts", async () => {
    const { fetchImpl } = fetchOf([hanging()]);
    const controller = new AbortController();
    const run = collect(
      runAgentQuery({ ...base, executeFunction: noFunction, fetchImpl, signal: controller.signal, timeoutMs: 0 }),
    );
    setTimeout(() => controller.abort(), 10);
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });

  // Deliberate contract change (adaptation 5): v6.2.1 threw at the cap; V6-006 requires a returned history plus a WARNING.
  it("stops at the configured round limit: final response allowed, no further tool, WARNING (adaptation 5)", async () => {
    const { calls, fetchImpl } = fetchOf([() => sse(fixture("function-call"))]);
    let executed = 0;
    const executeFunction = async (): Promise<AgentMessage> => { executed++; return { role: "tool", function: "x", input_arguments: {}, data: [] }; };
    const events: AgentEvent[] = [];
    const gen = runAgentQuery({ ...base, executeFunction, fetchImpl, maxFunctionRounds: 2 });
    let result = await gen.next();
    while (!result.done) { events.push(result.value); result = await gen.next(); }
    expect(executed).toBe(2);
    expect(calls).toHaveLength(3);
    expect(result.value.filter(m => m.role === "tool")).toHaveLength(2);
    expect(result.value.filter(m => m.role === "ai")).toHaveLength(2);
    expect(events).toContainEqual(expect.objectContaining({ type: "status", status: expect.objectContaining({ eventType: "WARNING" }) }));
    expect(events.some(e => e.type === "chunk" && /may be incomplete/.test(e.delta))).toBe(true);
  });

  it("defaults to 40 rounds when no limit is passed", async () => {
    const { calls, fetchImpl } = fetchOf([() => sse(fixture("function-call"))]);
    const executeFunction = async (): Promise<AgentMessage> => ({ role: "tool", function: "x", input_arguments: {}, data: [] });
    await collect(runAgentQuery({ ...base, executeFunction, fetchImpl }));
    expect(calls).toHaveLength(41);
  });

  it("sends each round the widget refs refresh returns then, not the turn-start ones (#326)", async () => {
    const { calls, fetchImpl } = fetchOf([() => sse(fixture("function-call")), () => sse(fixture("simple-text"))]);
    let text = "";
    const ref = () => ({ uuid: "n1", origin: "builtin", widget_id: "note", name: "Note", description: "", metadata: {}, params: [{ name: "text", type: "text", description: "", current_value: text, default_value: "" }] });
    const executeFunction = async (): Promise<AgentMessage> => {
      text = "saved"; // the round's tool call wrote the note
      return { role: "tool", function: "x", input_arguments: {}, data: [] };
    };
    await collect(runAgentQuery({ ...base, executeFunction, fetchImpl, refresh: () => ({ primary: [], secondary: [ref()] }) }));
    const valueSent = (i: number) => JSON.stringify(bodyOf(calls[i]!)).includes('"current_value":"saved"');
    expect(calls).toHaveLength(2);
    expect(valueSent(0)).toBe(false);
    expect(valueSent(1)).toBe(true);
  });
});
