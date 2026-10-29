// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment node
//
// Node, not jsdom: reads captures from disk.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { toAgentEvent, withQuoteBoxes } from "./events";
import { sseEvents } from "./sse";
import type { AgentEvent } from "./types";

vi.mock("../logger", () => ({
  logOnce: vi.fn(() => Promise.resolve()),
  logError: vi.fn(() => Promise.resolve()),
  logInfo: vi.fn(() => Promise.resolve()),
}));

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let pos = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (pos >= bytes.length) return c.close();
      c.enqueue(bytes.slice(pos, pos + 64));
      pos += 64;
    },
  });
}

async function mapCapture(rel: string): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const ev of sseEvents(streamOf(read(rel)))) {
    const mapped = toAgentEvent(ev);
    if (mapped) out.push(mapped);
  }
  return out;
}

describe("toAgentEvent against the plain-answer captures", () => {
  it("maps every chunk in simple-text.sse", async () => {
    const events = await mapCapture("../../test/fixtures/rita/simple-text.sse");
    expect(events).toHaveLength(28);
    expect(events.every((e) => e.type === "chunk")).toBe(true);
    const first = events[0];
    if (first.type !== "chunk") throw new Error("unreachable");
    expect(first.delta).toBe("A stock ticker");
  });

  it("maps every chunk in rita-stream.sse", async () => {
    const events = await mapCapture("../../test/fixtures/rita-stream.sse");
    expect(events).toHaveLength(48);
    expect(events.every((e) => e.type === "chunk")).toBe(true);
  });
});

describe("toAgentEvent against the ERROR status capture", () => {
  it("maps the status and the chunk that follows it", async () => {
    const events = await mapCapture("../../test/fixtures/rita/error-status.sse");
    expect(events.map((e) => e.type)).toEqual(["status", "chunk"]);
  });

  it("preserves fields beyond eventType and message", async () => {
    // Spread first, then normalize. Rebuilding field-by-field silently drops
    // `group` here, and drops `tool_call`/`artifacts` on a completing step.
    const events = await mapCapture("../../test/fixtures/rita/error-status.sse");
    const status = events[0];
    if (status.type !== "status") throw new Error("unreachable");
    expect(status.status.eventType).toBe("ERROR");
    expect(status.status.message).toContain("timed out after 240s");
    expect(status.status.group).toBe("reasoning");
  });
});

describe("toAgentEvent validation", () => {
  it("drops a status whose eventType is not INFO/WARNING/ERROR", () => {
    const out = toAgentEvent({ event: "copilotStatusUpdate", data: '{"eventType":"LOUD","message":"hi"}' });
    expect(out).toBeNull();
  });

  it("drops a status whose message is not a string", () => {
    // A malformed one used to reach the renderer, where eventType.toLowerCase()
    // threw mid-render.
    const out = toAgentEvent({ event: "copilotStatusUpdate", data: '{"eventType":"INFO","message":7}' });
    expect(out).toBeNull();
  });

  it("drops a functionCall payload that is not an object rather than casting it", () => {
    expect(toAgentEvent({ event: "copilotFunctionCall", data: '"not-an-object"' })).toBeNull();
  });

  it("drops an artifact payload that is not an object", () => {
    expect(toAgentEvent({ event: "copilotMessageArtifact", data: "42" })).toBeNull();
  });

  it("returns null on unparseable data rather than throwing", () => {
    expect(toAgentEvent({ event: "copilotMessageChunk", data: "{not json" })).toBeNull();
  });

  it("keys the unknown-event log by event name", async () => {
    const { logOnce } = await import("../logger");
    (logOnce as unknown as { mockClear: () => void }).mockClear();
    expect(toAgentEvent({ event: "copilotSomethingNew", data: "{}" })).toBeNull();
    expect(toAgentEvent({ event: "copilotSomethingNew", data: "{}" })).toBeNull();
    const calls = (logOnce as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    // logOnce dedupes by key, so both calls carry the SAME key — that is what
    // makes it once-per-name rather than once-per-occurrence.
    expect(new Set(calls.map((c) => String(c[0]))).size).toBe(1);
  });

  it("maps a bare error event", () => {
    const out = toAgentEvent({ event: "error", data: '{"message":"boom"}' });
    expect(out).toEqual({ type: "error", message: "boom" });
  });

  it("maps an error event whose body is plain text, not JSON", () => {
    // The exact case the `error` mapping exists to catch: without handling
    // it ahead of the JSON parse, this failure silently vanishes instead of
    // surfacing as an error.
    const out = toAgentEvent({ event: "error", data: "Internal Server Error" });
    expect(out).toEqual({ type: "error", message: "Internal Server Error" });
  });

  it("maps done", () => {
    expect(toAgentEvent({ event: "done", data: "{}" })).toEqual({ type: "done" });
  });

  it("maps a bare done event with no data", () => {
    expect(toAgentEvent({ event: "done", data: "" })).toEqual({ type: "done" });
  });
});

describe("citation quote boxes", () => {
  const good = { text: "Revenue grew", page: 1, x0: 72, top: 92, x1: 255, bottom: 104 };
  const sse = (payload: unknown) => toAgentEvent({ event: "copilotCitationCollection", data: JSON.stringify(payload) });

  it("keeps well-formed boxes in their groups", () => {
    const event = sse({ citations: [{ id: "c", source_info: { type: "widget" }, quote_bounding_boxes: [[good]] }] });
    expect(event).toEqual({ type: "citations", payload: { citations: [{ id: "c", source_info: { type: "widget" }, quote_bounding_boxes: [[good]] }] } });
  });

  it("drops malformed boxes and emptied groups, and keeps the citation", () => {
    const c = withQuoteBoxes({
      id: "c",
      quote_bounding_boxes: [[good, { ...good, page: "1" }, { ...good, x1: 10 }], [{ ...good, top: undefined }], "junk"],
    });
    expect(c).toEqual({ id: "c", quote_bounding_boxes: [[good]] });
  });

  it("removes the field when no box survives, and leaves a citation without it alone", () => {
    expect(withQuoteBoxes({ id: "c", quote_bounding_boxes: [[{ page: 0 }]] })).toEqual({ id: "c" });
    expect(withQuoteBoxes({ id: "c", quote_bounding_boxes: null })).toEqual({ id: "c" });
    const plain = { id: "c" };
    expect(withQuoteBoxes(plain)).toBe(plain);
  });
});
