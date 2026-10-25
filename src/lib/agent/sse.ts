// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The single SSE parser in the app. The MCP client reuses it rather than
 * hand-rolling a second line-scanner, because every rule below was learned
 * from a real capture and a second implementation would relearn them.
 */
import { IMPORT_MAX_BYTES } from "../importLimits";
import { logError } from "../logger";
import type { SseEvent } from "./types";

/**
 * Parse one framed block. Returns null for a block with no `data:` field —
 * a lone comment or a bare `id:` heartbeat is not an event.
 */
function parseBlock(block: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    // A comment line, and the empty line that a block can start with.
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    // WHATWG: exactly one leading space is a separator, not content. Stripping
    // more corrupts every payload that legitimately starts with whitespace;
    // JSON.parse's tolerance had been masking that.
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    // `id:` and `retry:` are deliberately ignored.
  }
  if (data.length === 0) return null;
  // A real newline. Joining with "" turns {"a":1 + 0} into {"a":10}.
  return { event, data: data.join("\n") };
}

/**
 * The most un-framed text sseEvents holds: one event, since every framed one
 * is handed on at once. Above it the stream is stopped with an error -- an
 * event that never ends would otherwise grow until the webview dies, the idle
 * timer being re-armed by every chunk.
 */
// ponytail: IMPORT_MAX_BYTES' 10 MB, counted in UTF-16 units not bytes; far
// above any Rita event or MCP reply (tool results are capped at 100k chars).
export const SSE_EVENT_MAX_CHARS = IMPORT_MAX_BYTES;

/**
 * `onBytes` fires on every chunk read, including chunks that hold only a
 * keepalive comment: a comment yields no event, but it is proof the
 * connection is alive, which an idle timeout needs to hear about.
 */
export async function* sseEvents(
  stream: ReadableStream<Uint8Array>,
  onBytes?: () => void,
): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  // stream:true so a multi-byte sequence split across reads survives.
  const decoder = new TextDecoder();
  // The current block's text so far, as parts: joined once when it frames,
  // and only new text is ever scanned, so one big event costs linear time.
  let parts: string[] = [];
  let pending = 0;
  let endsWithLf = false;
  // A trailing lone \r is held back: it may be the first half of a \r\n
  // split across a chunk boundary.
  let held = "";
  function* feed(raw: string, final: boolean): Generator<SseEvent> {
    let text = held + raw;
    held = "";
    if (!final && text.endsWith("\r")) {
      held = "\r";
      text = text.slice(0, -1);
    }
    // CRLF and lone CR become \n: the CRLF separator is \r\n\r\n, which
    // contains no \n\n, so an unnormalized stream would never frame.
    text = text.replace(/\r\n?/g, "\n");
    if (text === "") return;
    let from = 0;
    // The separator split across chunks: the block's \n ended the last one.
    if (endsWithLf && text.startsWith("\n")) {
      const ev = parseBlock(parts.join("").slice(0, -1));
      parts = [];
      pending = 0;
      from = 1;
      if (ev) yield ev;
    }
    let idx: number;
    while ((idx = text.indexOf("\n\n", from)) !== -1) {
      const ev = parseBlock(parts.join("") + text.slice(from, idx));
      parts = [];
      pending = 0;
      from = idx + 2;
      if (ev) yield ev;
    }
    const rest = text.slice(from);
    if (rest !== "") parts.push(rest);
    pending += rest.length;
    endsWithLf = pending > 0 && text.endsWith("\n");
    if (pending > SSE_EVENT_MAX_CHARS) {
      throw new Error(`stream event exceeded ${SSE_EVENT_MAX_CHARS / (1024 * 1024)} MB without ending; the response was stopped`);
    }
  }
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onBytes?.();
      yield* feed(decoder.decode(value, { stream: true }), false);
    }

    // Flush the decoder so a sequence left dangling by a dropped connection
    // becomes visible rather than vanishing.
    yield* feed(decoder.decode(), true);

    // Every real capture ends with a terminating blank line, so leftover
    // bytes mean the connection dropped mid-event. Report it; do not parse it.
    if (parts.join("").trim() !== "") {
      void logError(
        `sse: dropped ${pending} unterminated characters at end of stream`,
      );
    }
  } finally {
    // Cancel, not merely releaseLock: a caller that breaks out of the
    // `for await` (Stop) would otherwise leak the HTTP response body.
    await reader.cancel().catch(() => undefined);
  }
}
