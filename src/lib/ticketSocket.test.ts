// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket } from "../test/fakeSocket";
import { makeTicketSocket } from "./ticketSocket";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const URL_IN = "wss://door.example.com/ta_series_ws?symbol=AAPL";
const build = (resolve: (u: URL) => Promise<string> = async (u) => `${u.href}&ticket=t1`) =>
  makeTicketSocket({ native: FakeSocket as never, matches: () => true, resolve });

describe("makeTicketSocket", () => {
  beforeEach(() => {
    FakeSocket.last = null;
    FakeSocket.all = [];
  });
  afterEach(() => vi.useRealTimers());

  it("leaves a URL it does not match to the native socket, untouched", () => {
    const Native = vi.fn();
    const S = makeTicketSocket({ native: Native as never, matches: () => false, resolve: vi.fn() });
    new S("wss://other.example.com/x");
    expect(Native).toHaveBeenCalledWith("wss://other.example.com/x", undefined);
  });

  it("opens the matched socket on the resolved URL, and a failed resolve reads as a close", async () => {
    const opened: string[] = [];
    const Native = vi.fn((u: string) => {
      opened.push(u);
      return {};
    });
    const S = makeTicketSocket({ native: Native as never, matches: () => true, resolve: async (u) => `${u.href}&ticket=t1` });
    new S("wss://door.example.com/ta_series_ws?symbol=AAPL");
    await vi.waitFor(() => expect(opened).toEqual(["wss://door.example.com/ta_series_ws?symbol=AAPL&ticket=t1"]));
    const F = makeTicketSocket({
      native: Native as never,
      matches: () => true,
      resolve: async () => {
        throw new Error("503");
      },
    });
    const s = new F("wss://door.example.com/ta_series_ws");
    const closed = vi.fn();
    s.onclose = closed;
    await vi.waitFor(() => expect(closed).toHaveBeenCalled());
  });

  it("relays open, frames, send and close, and exposes the static OPEN", async () => {
    const S = build();
    const ws = new S(URL_IN);
    const opened = vi.fn();
    const messages: unknown[] = [];
    ws.onopen = opened;
    ws.onmessage = (e) => messages.push(e.data);
    expect(ws.readyState).toBe(0);
    await settle();
    const real = FakeSocket.last!;
    expect(real.url).toBe(`${URL_IN}&ticket=t1`);
    real.open();
    real.emit({ type: "tick" });
    expect(opened).toHaveBeenCalledTimes(1);
    expect(ws.readyState).toBe(1);
    expect(messages).toEqual(['{"type":"tick"}']);
    ws.send("hello");
    expect(real.sent).toEqual(["hello"]);
    const closed = vi.fn();
    ws.onclose = closed;
    ws.close();
    expect(real.closed).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(S.OPEN).toBe(1);
  });

  it("resolves a fresh URL for every socket: a ticket is single use", async () => {
    const resolve = vi.fn(async (u: URL) => `${u.href}&ticket=t`);
    const S = build(resolve);
    new S(URL_IN);
    new S(URL_IN);
    await settle();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("closes, so the caller retries, when the resolve never answers", async () => {
    vi.useFakeTimers();
    const S = build(() => new Promise<string>(() => {}));
    const ws = new S(URL_IN);
    const closed = vi.fn();
    ws.onclose = closed;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(ws.readyState).toBe(3);
    expect(FakeSocket.last).toBeNull();
  });

  it("closed while the resolve is in flight never opens the real socket", async () => {
    const S = build();
    const ws = new S(URL_IN);
    ws.close();
    await settle();
    expect(FakeSocket.last).toBeNull();
  });
});
