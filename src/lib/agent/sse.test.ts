// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SSE_EVENT_MAX_CHARS, sseEvents } from "./sse";
import type { SseEvent } from "./types";
import {
  streamOf,
  initializeSse,
  toolsListSse,
} from "../../test/fixtures/mcp-fixtures";

vi.mock("../logger", () => ({
  logError: vi.fn(() => Promise.resolve()),
  logOnce: vi.fn(() => Promise.resolve()),
  logInfo: vi.fn(() => Promise.resolve()),
}));

async function collect(
  stream: ReadableStream<Uint8Array>,
): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const ev of sseEvents(stream)) out.push(ev);
  return out;
}

function streamOfBytes(text: string): ReadableStream<Uint8Array> {
  return streamOf(text, text.length || 1);
}

describe("sseEvents", () => {
  // Without this, `expect(logError).toHaveBeenCalled()` in the unterminated-
  // block test can never fail once any earlier test has logged — the mock's
  // call history carries over.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("frames a simple event", async () => {
    const events = await collect(streamOfBytes("event: ping\ndata: hi\n\n"));
    expect(events).toEqual([{ event: "ping", data: "hi" }]);
  });

  it("accepts event: with no space after the colon", async () => {
    const events = await collect(streamOfBytes("event:ping\ndata:hi\n\n"));
    expect(events).toEqual([{ event: "ping", data: "hi" }]);
  });

  it("strips exactly one leading space from data, not all of it", async () => {
    const events = await collect(streamOfBytes("data:   padded\n\n"));
    expect(events[0].data).toBe("  padded");
  });

  it("frames CRLF streams, whose separator contains no \\n\\n", async () => {
    const events = await collect(
      streamOfBytes("event: a\r\ndata: one\r\n\r\nevent: b\r\ndata: two\r\n\r\n"),
    );
    expect(events).toEqual([
      { event: "a", data: "one" },
      { event: "b", data: "two" },
    ]);
  });

  it("joins multi-line data with a real newline, not an empty string", async () => {
    // The empty-string join turns this into the valid-but-wrong {"a":10}.
    const events = await collect(streamOfBytes('data: {"a":1\ndata: 0}\n\n'));
    expect(events[0].data).toBe('{"a":1\n0}');
  });

  it("ignores comments, id: and retry: lines", async () => {
    const events = await collect(
      streamOfBytes(": keep-alive\nid: 7\nretry: 500\nevent: x\ndata: y\n\n"),
    );
    expect(events).toEqual([{ event: "x", data: "y" }]);
  });

  it("defaults the event name to message when none is given", async () => {
    const events = await collect(streamOfBytes("data: bare\n\n"));
    expect(events).toEqual([{ event: "message", data: "bare" }]);
  });

  it("drops an unterminated trailing block and logs it", async () => {
    const { logError } = await import("../logger");
    const events = await collect(streamOfBytes("data: complete\n\ndata: cut"));
    expect(events).toEqual([{ event: "message", data: "complete" }]);
    expect(logError).toHaveBeenCalled();
  });

  it("cancels the reader when the caller breaks out early", async () => {
    // Pull-based, so the stream is still open when the caller breaks. A
    // start()-based stream would have enqueued everything and closed before
    // the first iteration, and cancel() would never fire — the test would
    // pass against an implementation that leaks.
    let cancelled = false;
    const bytes = new TextEncoder().encode("data: a\n\ndata: b\n\n");
    let pos = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pos >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(pos, pos + 4));
        pos += 4;
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const _ev of sseEvents(stream)) break;
    expect(cancelled).toBe(true);
  });

  // The property that matters: identical results at every read size,
  // including sizes that split data: lines and land inside multi-byte UTF-8.
  it.each([1, 3, 5, 7, 11, 64, 128, 4096])(
    "parses the initialize capture identically at %i-byte reads",
    async (chunkSize) => {
      const whole = await collect(streamOf(initializeSse, initializeSse.length));
      const sliced = await collect(streamOf(initializeSse, chunkSize));
      expect(sliced).toEqual(whole);
      expect(sliced.length).toBe(1);
      expect(JSON.parse(sliced[0].data).result.serverInfo.name).toBe("stores");
    },
  );

  it.each([1, 3, 5, 7, 11, 64, 128, 4096])(
    "parses the tools-list capture identically at %i-byte reads",
    async (chunkSize) => {
      const whole = await collect(streamOf(toolsListSse, toolsListSse.length));
      const sliced = await collect(streamOf(toolsListSse, chunkSize));
      expect(sliced).toEqual(whole);
      expect(JSON.parse(sliced[0].data).result.tools).toHaveLength(6);
    },
  );

  it("survives a multi-byte character split across reads", async () => {
    // The em dash is three bytes; a 1-byte read splits it every time.
    const events = await collect(streamOf("data: a—b\n\n", 1));
    expect(events[0].data).toBe("a—b");
  });

  it("frames every split of mixed CRLF/LF events the same as one read", async () => {
    const text = "data: a\r\n\r\ndata: b\n\n: keep\r\rdata: c\r\ndata: d\n\n";
    const whole = await collect(streamOf(text, text.length));
    expect(whole.map((e) => e.data)).toEqual(["a", "b", "c\nd"]);
    for (let size = 1; size < text.length; size++) expect(await collect(streamOf(text, size))).toEqual(whole);
  });

  it("stops a stream whose event never ends, at SSE_EVENT_MAX_CHARS", async () => {
    // One 64 KB chunk past the cap, no blank line: before the cap this read
    // on until EOF (and Rita's idle timer, re-armed per chunk, never fired).
    const chunk = new TextEncoder().encode("data: " + "x".repeat(64 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent > SSE_EVENT_MAX_CHARS + 2 * chunk.length) return c.close();
        c.enqueue(chunk);
        sent += chunk.length;
      },
    });
    await expect(collect(stream)).rejects.toThrow(/exceeded 10 MB without ending/);
    // The stream pulls one chunk ahead of the reader.
    expect(sent).toBeLessThanOrEqual(SSE_EVENT_MAX_CHARS + 2 * chunk.length);
  });
});
