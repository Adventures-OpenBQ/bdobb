// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STABLE_MS, useReconnectingSocket } from "./useReconnectingSocket";

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  raw(data: string) {
    this.onmessage?.({ data });
  }
}

function Harness({ url, sub, onMsg }: { url: string | null; sub: unknown; onMsg: (m: unknown) => void }) {
  useReconnectingSocket(url, sub, onMsg);
  return null;
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useReconnectingSocket", () => {
  it("subscribes on open and forwards JSON messages", () => {
    const onMsg = vi.fn();
    render(<Harness url="ws://x/ws" sub={{ params: { symbol: "TSLA" } }} onMsg={onMsg} />);
    const sock = FakeSocket.instances[0];
    act(() => sock.open());
    expect(sock.sent[0]).toBe(JSON.stringify({ params: { symbol: "TSLA" } }));
    act(() => sock.message({ symbol: "TSLA", price: 1 }));
    expect(onMsg).toHaveBeenCalledWith({ symbol: "TSLA", price: 1 });
  });

  it("ignores a non-JSON message without throwing", () => {
    const onMsg = vi.fn();
    render(<Harness url="ws://x/ws" sub={{}} onMsg={onMsg} />);
    const sock = FakeSocket.instances[0];
    act(() => sock.open());
    act(() => sock.raw("not json"));
    expect(onMsg).not.toHaveBeenCalled();
  });

  it("reconnects after a close and re-sends the subscription", () => {
    render(<Harness url="ws://x/ws" sub={{ params: { symbol: "AAPL" } }} onMsg={vi.fn()} />);
    act(() => FakeSocket.instances[0].open());
    act(() => FakeSocket.instances[0].close());
    act(() => vi.advanceTimersByTime(5000)); // past the backoff
    expect(FakeSocket.instances.length).toBe(2);
    act(() => FakeSocket.instances[1].open());
    expect(FakeSocket.instances[1].sent[0]).toBe(JSON.stringify({ params: { symbol: "AAPL" } }));
  });
  // #222 back-port: a socket the backend accepts and then drops at once must
  // climb the backoff ladder rather than reset to 500 ms on every open; one
  // that stays up STABLE_MS has recovered and starts the ladder again.
  it("backs off across short-lived connections and resets after a stable one", () => {
    render(<Harness url="ws://x/ws" sub={{}} onMsg={vi.fn()} />);
    const dropAndWait = (ms: number) => {
      const n = FakeSocket.instances.length;
      act(() => FakeSocket.instances[n - 1].close());
      act(() => vi.advanceTimersByTime(ms - 1));
      expect(FakeSocket.instances.length).toBe(n); // not yet
      act(() => vi.advanceTimersByTime(1));
      expect(FakeSocket.instances.length).toBe(n + 1); // reconnected exactly then
    };
    const openLast = () => act(() => FakeSocket.instances[FakeSocket.instances.length - 1].open());
    openLast();
    dropAndWait(500);
    openLast(); // opens, then drops at once
    dropAndWait(1000);
    openLast();
    dropAndWait(2000);
    for (const ms of [4000, 8000, 16000, 32000, 60000, 60000]) dropAndWait(ms); // never opened: capped
    openLast();
    act(() => vi.advanceTimersByTime(STABLE_MS)); // stays up: recovered
    dropAndWait(500);
  });
});
