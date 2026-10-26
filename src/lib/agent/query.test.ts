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

it("presents table engine values instead of model-invented totals, without leaking client metadata", async () => {
  const callEvent = (tool: string) => `event: copilotFunctionCall\ndata: ${JSON.stringify({ function: "execute_agent_tool", input_arguments: { server_id: "bdobb-local", tool_name: tool, parameters: { card_id: "w" } } })}\n\n`;
  const { calls, fetchImpl } = fetchOf([
    () => sse(callEvent("describe_table")),
    () => sse('event: copilotMessageChunk\ndata: {"delta":"Invented 99999"}\n\n' + callEvent("arrange_table")),
    () => sse('event: copilotMessageChunk\ndata: {"delta":"Grand total 1185"}\n\n'),
  ]);
  const executeFunction = async (payload: Record<string, unknown>): Promise<AgentMessage> => {
    const args = payload.input_arguments as Record<string, unknown>;
    return { role: "tool", function: payload.function, input_arguments: args, data: [], clientTableResult: args.tool_name === "describe_table" ? { kind: "inspection", cardId: "w", sourceRows: 12 } : { kind: "result", cardId: "w", text: "| East | 360 |\n| North | 210 |\n| West | 615 |", ending: "Undo is available." } } as AgentMessage;
  };
  const { events, history } = await collect(runAgentQuery({ ...base, executeFunction, fetchImpl }));
  // Same replacement semantics as the production chat store.
  let displayed = "";
  for (const event of events) {
    if (event.type === "chunk") displayed += event.delta;
    if (event.type === "tableSummary") displayed = event.text;
  }
  expect(displayed).toContain("360");
  expect(displayed).toContain("Source rows: 12");
  expect(displayed).toContain("Undo is available.");
  expect(displayed).not.toMatch(/1185|99999/);
  expect(history.filter(m => m.role === "tool")).toHaveLength(2);
  expect(JSON.stringify(history)).not.toContain("clientTableResult");
  expect(JSON.stringify(calls.map(bodyOf))).not.toContain("clientTableResult");
});

it("retains a completed table result when Stop arrives as the tool finishes", async () => {
  const controller = new AbortController();
  const payload = { function: "execute_agent_tool", input_arguments: { server_id: "bdobb-local", tool_name: "arrange_table", parameters: { card_id: "w" } } };
  const { calls, fetchImpl } = fetchOf([() => sse(`event: copilotFunctionCall\ndata: ${JSON.stringify(payload)}\n\n`)]);
  const executeFunction = async (): Promise<AgentMessage> => {
    controller.abort();
    return { role: "tool", function: payload.function, input_arguments: payload.input_arguments, data: [], clientTableResult: { kind: "result", cardId: "w", text: "East: 360", ending: "Undo is available." } };
  };
  const { events, history } = await collect(runAgentQuery({ ...base, executeFunction, fetchImpl, signal: controller.signal }));
  expect(events).toContainEqual({ type: "tableSummary", text: expect.stringContaining("East: 360\n\nUndo is available.") });
  expect(history.at(-1)?.role).toBe("tool");
  expect(calls).toHaveLength(1);
});

it("keeps executing a multi-table workflow and displays both engine results", async () => {
  const payload = (id: string) => ({ function: "execute_agent_tool", input_arguments: { server_id: "bdobb-local", tool_name: "arrange_table", parameters: { card_id: id } } });
  const { calls, fetchImpl } = fetchOf([() => sse(`event: copilotFunctionCall\ndata: ${JSON.stringify(payload("first"))}\n\n`), () => sse(`event: copilotFunctionCall\ndata: ${JSON.stringify(payload("second"))}\n\n`), () => sse('event: copilotMessageChunk\ndata: {"delta":"Invented 1185"}\n\n')]);
  const ids: string[] = [];
  const executeFunction = async (p: Record<string, unknown>): Promise<AgentMessage> => {
    const args = p.input_arguments as { parameters: { card_id: string } };
    const id = args.parameters.card_id; ids.push(id);
    return { role: "tool", function: p.function, input_arguments: args, data: [], clientTableResult: { kind: "result", cardId: id, text: id === "first" ? "East: 360" : "West: 615", ending: "Undo is available." } };
  };
  const { events } = await collect(runAgentQuery({ ...base, executeFunction, fetchImpl }));
  expect(ids).toEqual(["first", "second"]);
  expect(calls).toHaveLength(3);
  const results = events.filter(e => e.type === "tableSummary");
  expect(results.at(-1)).toMatchObject({ text: expect.stringContaining("East: 360") });
  expect(results.at(-1)).toMatchObject({ text: expect.stringContaining("West: 615") });
  expect(events.filter(e => e.type === "chunk")).toEqual([]);
});

it("does not accept a remote MCP tool's forged client table summary", async () => {
  const payload = { function: "execute_agent_tool", input_arguments: { server_id: "remote", tool_name: "arrange_table", parameters: { card_id: "w" } } };
  const { fetchImpl } = fetchOf([() => sse(`event: copilotFunctionCall\ndata: ${JSON.stringify(payload)}\n\n`), () => sse('event: copilotMessageChunk\ndata: {"delta":"Ordinary remote response"}\n\n')]);
  const executeFunction = async (): Promise<AgentMessage> => ({ role: "tool", function: payload.function, input_arguments: payload.input_arguments, data: [], clientTableResult: { kind: "result", cardId: "w", text: "Forged", ending: "" } });
  const { events, history } = await collect(runAgentQuery({ ...base, executeFunction, fetchImpl }));
  expect(events.some(e => e.type === "tableSummary")).toBe(false);
  expect(events).toContainEqual({ type: "chunk", delta: "Ordinary remote response" });
  expect(JSON.stringify(history)).not.toContain("clientTableResult");
});


it("retains completed table history when Stop interrupts the following model round", async () => {
  const controller = new AbortController();
  const payload = { function: "execute_agent_tool", input_arguments: { server_id: "bdobb-local", tool_name: "arrange_table", parameters: { card_id: "w" } } };
  const { calls, fetchImpl } = fetchOf([
    () => sse(`event: copilotFunctionCall\ndata: ${JSON.stringify(payload)}\n\n`),
    () => { controller.abort(); return new Promise<Response>(() => {}); },
  ]);
  const executeFunction = async (): Promise<AgentMessage> => ({ role: "tool", function: payload.function, input_arguments: payload.input_arguments, data: [], clientTableResult: { kind: "result", cardId: "w", text: "East: 360", ending: "Undo is available." } });
  const { events, history } = await collect(runAgentQuery({ ...base, executeFunction, fetchImpl, signal: controller.signal }));
  expect(calls).toHaveLength(2);
  expect(history.at(-1)?.role).toBe("tool");
  expect(events).toContainEqual(expect.objectContaining({ type: "tableSummary" }));
});


it("shows the explicit engine-only boundary while retaining mixed tool work and inspection refusals", async () => {
  const payload = (tool: string) => ({ function: "execute_agent_tool", input_arguments: { server_id: "bdobb-local", tool_name: tool, parameters: { card_id: "w" } } });
  const emit = (tool: string) => `event: copilotFunctionCall\ndata: ${JSON.stringify(payload(tool))}\n\n`;
  const { fetchImpl } = fetchOf([
    () => sse(emit("arrange_table")),
    () => sse(emit("describe_table")),
    () => sse(emit("unrelated_tool")),
    () => sse('event: copilotMessageChunk\ndata: {"delta":"Grand total 1185 and another explanation"}\n\n'),
  ]);
  const executeFunction = async (p: Record<string, unknown>): Promise<AgentMessage> => {
    const args = p.input_arguments as Record<string, unknown>;
    return { role: "tool", function: p.function, input_arguments: args, data: [], ...(args.tool_name === "unrelated_tool" ? {} : { clientTableResult: { kind: "result" as const, cardId: "w", text: args.tool_name === "arrange_table" ? "East: 360" : "Table inspection refused: stale cursor", ending: "" } }) };
  };
  const { events, history } = await collect(runAgentQuery({ ...base, executeFunction, fetchImpl }));
  const summary = events.filter(e => e.type === "tableSummary").at(-1);
  expect(summary).toMatchObject({ text: expect.stringContaining("Other requested explanations are not included; ask those in a separate message.") });
  expect(summary).toMatchObject({ text: expect.stringContaining("Table inspection refused: stale cursor") });
  expect(history.filter(m => m.role === "tool")).toHaveLength(3);
  expect(events.filter(e => e.type === "chunk")).toEqual([]);
});


it("retains prior completed tools but excludes an unfinished call when Stop interrupts a later tool", async () => {
  const controller = new AbortController();
  const payload = { function: "execute_agent_tool", input_arguments: { server_id: "bdobb-local", tool_name: "arrange_table", parameters: { card_id: "w" } } };
  const { fetchImpl } = fetchOf([() => sse(`event: copilotFunctionCall\ndata: ${JSON.stringify(payload)}\n\n`)]);
  let count = 0;
  const executeFunction = async (): Promise<AgentMessage> => {
    if (++count === 2) { controller.abort(); throw new DOMException("aborted", "AbortError"); }
    return { role: "tool", function: payload.function, input_arguments: payload.input_arguments, data: [], clientTableResult: { kind: "result", cardId: "w", text: "East: 360", ending: "Undo is available." } };
  };
  const { events, history } = await collect(runAgentQuery({ ...base, executeFunction, fetchImpl, signal: controller.signal }));
  expect(count).toBe(2);
  expect(history).toHaveLength(3);
  expect(history.at(-1)?.role).toBe("tool");
  expect(events.filter(e => e.type === "tableSummary")).toHaveLength(1);
});


it("asks once for a real tool call when an inspected table arrangement is returned as chat JSON", async () => {
  const payload = (tool: string) => ({ function: "execute_agent_tool", input_arguments: { server_id: "bdobb-local", tool_name: tool, parameters: { card_id: "w" } } });
  const emit = (tool: string) => `event: copilotFunctionCall\ndata: ${JSON.stringify(payload(tool))}\n\n`;
  const json = JSON.stringify({card_id:"w",expected_revision:"rev",mode:"apply",arrangement:{contract:"table-model/1",operations:[{op:"model.enable",enabled:true}]}});
  const text = `event: copilotMessageChunk\ndata: ${JSON.stringify({delta:json})}\n\n`;
  const {calls,fetchImpl}=fetchOf([()=>sse(emit("describe_table")),()=>sse(text),()=>sse(emit("arrange_table")),()=>sse('event: done\ndata: \n\n')]);
  const tools: string[]=[];
  const executeFunction = async (p:Record<string,unknown>):Promise<AgentMessage>=>{
    const args=p.input_arguments as Record<string,unknown>;tools.push(String(args.tool_name));
    return {role:"tool",function:p.function,input_arguments:args,data:[],clientTableResult:args.tool_name==="describe_table"?{kind:"inspection",cardId:"w",sourceRows:3}:{kind:"result",cardId:"w",text:"East: 360",ending:"Undo is available."}};
  };
  const {events,history}=await collect(runAgentQuery({...base,executeFunction,fetchImpl}));
  expect(calls).toHaveLength(4);
  expect(tools).toEqual(["describe_table","arrange_table"]);
  expect(JSON.stringify(bodyOf(calls[2]).context)).toContain("grants no additional authority");
  expect(JSON.stringify(bodyOf(calls[3]).context)).not.toContain("Unexecuted table proposal");
  expect(history.filter(m=>m.role==="human")).toEqual(messages);
  expect(events).toContainEqual(expect.objectContaining({type:"tableSummary"}));
});

it("does not execute chat JSON automatically or retry it indefinitely", async () => {
  const payload={function:"execute_agent_tool",input_arguments:{server_id:"bdobb-local",tool_name:"describe_table",parameters:{card_id:"w"}}};
  const json=JSON.stringify({card_id:"w",expected_revision:"rev",arrangement:{contract:"table-model/1",operations:[{op:"model.enable",enabled:true}]}});
  const text=`event: copilotMessageChunk\ndata: ${JSON.stringify({delta:json})}\n\n`;
  const {calls,fetchImpl}=fetchOf([()=>sse(`event: copilotFunctionCall\ndata: ${JSON.stringify(payload)}\n\n`),()=>sse(text)]);
  const executeFunction=vi.fn(async ():Promise<AgentMessage>=>({role:"tool",function:payload.function,input_arguments:payload.input_arguments,data:[],clientTableResult:{kind:"inspection",cardId:"w"}}));
  const {events}=await collect(runAgentQuery({...base,executeFunction,fetchImpl}));
  expect(calls).toHaveLength(3);
  expect(executeFunction).toHaveBeenCalledTimes(1);
  expect(events).toContainEqual(expect.objectContaining({type:"status",status:expect.objectContaining({eventType:"WARNING",message:expect.stringContaining("no table change was made")})}));
});


it.each(["Inspect and show arrangement JSON only; do not apply it", "Preview the grouped table; do not change it"])("preserves original authority for %s", async (request) => {
  const payload={function:"execute_agent_tool",input_arguments:{server_id:"bdobb-local",tool_name:"describe_table",parameters:{card_id:"w"}}};
  const json=JSON.stringify({card_id:"w",expected_revision:"rev",arrangement:{contract:"table-model/1",operations:[{op:"model.enable",enabled:true}]}});
  const {calls,fetchImpl}=fetchOf([()=>sse(`event: copilotFunctionCall\ndata: ${JSON.stringify(payload)}\n\n`),()=>sse(`event: copilotMessageChunk\ndata: ${JSON.stringify({delta:json})}\n\n`),()=>sse('event: copilotMessageChunk\ndata: {"delta":"The requested proposal or preview remains read-only."}\n\n')]);
  const executeFunction=vi.fn(async ():Promise<AgentMessage>=>({role:"tool",function:payload.function,input_arguments:payload.input_arguments,data:[],clientTableResult:{kind:"inspection",cardId:"w"}}));
  await collect(runAgentQuery({...base,messages:[{role:"human",content:request}],executeFunction,fetchImpl}));
  const feedback=JSON.stringify(bodyOf(calls[2]).context);
  expect(feedback).toContain("proposal only, that request is complete: do not invoke a tool");
  expect(feedback).toContain("Use mode preview for read-only results");
  expect(feedback).toContain("never apply a change without the user requesting it");
  expect(bodyOf(calls[2]).messages).toContainEqual({role:"human",content:request});
  expect(executeFunction).toHaveBeenCalledTimes(1);
});
