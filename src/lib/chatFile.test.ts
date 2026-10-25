// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";

import { __read, __reset, __seed, __writes } from "../test/memfs";
import { __resetLoggerForTests } from "./logger";
import { __resetJsonStoreForTests } from "./jsonStore";
import { CHAT_PATH, clearChat, isChatTranscript, loadChat, saveChat } from "./chatFile";

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
});

describe("isChatTranscript", () => {
  it("accepts a transcript with messages only", () => {
    // The shape check requires ONLY that messages is an array; `calls` is
    // tolerated as missing. Deliberately loose: this is append-heavy user
    // content, and a stricter check turns a recoverable file into a quarantine.
    expect(isChatTranscript({ messages: [] })).toBe(true);
  });

  it("accepts a transcript that also carries calls", () => {
    expect(isChatTranscript({ messages: [], calls: [] })).toBe(true);
  });

  it("rejects a missing messages array", () => {
    expect(isChatTranscript({})).toBe(false);
  });

  it("rejects messages that are not an array", () => {
    expect(isChatTranscript({ messages: "no" })).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(isChatTranscript(null)).toBe(false);
    expect(isChatTranscript(42)).toBe(false);
  });

  it("rejects a transcript with calls but no messages", () => {
    // Without this case, a validator reading
    // `Array.isArray(value.messages ?? value.calls)` would pass every other
    // case here.
    expect(isChatTranscript({ calls: [] })).toBe(false);
  });
});

describe("loadChat", () => {
  it("returns an empty transcript when the file is absent, and does NOT seed it", async () => {
    // An empty transcript is not worth writing. Checking the return value
    // alone would not prove that: a seeding implementation returns the same
    // { messages: [] } shape. __writes()/__read() prove no write happened.
    expect(await loadChat()).toEqual({ messages: [] });
    expect(__writes()).toEqual([]);
    expect(__read(CHAT_PATH)).toBeUndefined();
  });

  it("returns the loaded transcript when present", async () => {
    const t = { messages: [{ role: "human", content: "hi" }] };
    __seed(CHAT_PATH, JSON.stringify(t));
    expect(await loadChat()).toEqual(t);
  });
});

describe("saveChat", () => {
  it("writes the transcript to chat.json", async () => {
    const t = { messages: [{ role: "human" as const, content: "hi" }] };
    await saveChat(t);
    expect(JSON.parse(__read(CHAT_PATH) ?? "")).toEqual(t);
  });
});

describe("clearChat", () => {
  it("removes the file", async () => {
    __seed(CHAT_PATH, JSON.stringify({ messages: [] }));
    await clearChat();
    expect(__read(CHAT_PATH)).toBeUndefined();
  });
});
