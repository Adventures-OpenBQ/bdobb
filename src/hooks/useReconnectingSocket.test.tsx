// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STABLE_MS,
  useReconnectingSocket,
  type ReconnectingSocketOptions,
  type SocketConnection,
} from "./useReconnectingSocket";

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

function OptionsHarness({
  url,
  sub,
  onMsg,
  options,
}: {
  url: string | null;
  sub: unknown;
  onMsg: (m: unknown) => void;
  options: ReconnectingSocketOptions;
}) {
  useReconnectingSocket(url, sub, onMsg, options);
  return null;
}

const lastSock = () => FakeSocket.instances[FakeSocket.instances.length - 1];
const setHidden = (hidden: boolean) =>
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });

// The default mode is the one Live Grid uses: these pin what "reconnect"
// mode must NOT change about it.
describe("useReconnectingSocket default (resubscribe) mode", () => {
  it("re-sends a changed subscription on the open socket without reconnecting", () => {
    const { rerender } = render(<Harness url="ws://x/ws" sub={{ s: ["A"] }} onMsg={vi.fn()} />);
    act(() => lastSock().open());
    rerender(<Harness url="ws://x/ws" sub={{ s: ["A", "B"] }} onMsg={vi.fn()} />);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(lastSock().sent).toEqual([JSON.stringify({ s: ["A"] }), JSON.stringify({ s: ["A", "B"] })]);
  });

  it("does not reconnect on a return to the foreground", () => {
    try {
      render(<Harness url="ws://x/ws" sub={{}} onMsg={vi.fn()} />);
      act(() => lastSock().open());
      act(() => {
        setHidden(false);
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(FakeSocket.instances).toHaveLength(1);
    } finally {
      delete (document as unknown as Record<string, unknown>).hidden;
    }
  });
});

describe("useReconnectingSocket reconnect mode (one frame per connection)", () => {
  const RECONNECT: ReconnectingSocketOptions = { mode: "reconnect" };

  it("sends the subscription once on open, and a changed one opens a new connection instead of a second frame", () => {
    const { rerender } = render(
      <OptionsHarness url="ws://x/ws" sub={{ s: ["A"] }} onMsg={vi.fn()} options={RECONNECT} />,
    );
    const first = lastSock();
    act(() => first.open());
    rerender(<OptionsHarness url="ws://x/ws" sub={{ s: ["A", "B"] }} onMsg={vi.fn()} options={RECONNECT} />);
    expect(first.sent).toEqual([JSON.stringify({ s: ["A"] })]);
    expect(first.readyState).toBe(3);
    expect(FakeSocket.instances).toHaveLength(2);
    act(() => lastSock().open());
    expect(lastSock().sent).toEqual([JSON.stringify({ s: ["A", "B"] })]);
  });

  it("keeps the connection for an equal subscription with a new identity", () => {
    const { rerender } = render(
      <OptionsHarness url="ws://x/ws" sub={{ s: ["A"] }} onMsg={vi.fn()} options={RECONNECT} />,
    );
    act(() => lastSock().open());
    rerender(<OptionsHarness url="ws://x/ws" sub={{ s: ["A"] }} onMsg={vi.fn()} options={{ mode: "reconnect" }} />);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(lastSock().sent).toHaveLength(1);
  });

  it("opens a fresh connection when reconnectKey changes (Refresh)", () => {
    const { rerender } = render(
      <OptionsHarness url="ws://x/ws" sub={{}} onMsg={vi.fn()} options={{ mode: "reconnect", reconnectKey: 0 }} />,
    );
    const first = lastSock();
    act(() => first.open());
    rerender(<OptionsHarness url="ws://x/ws" sub={{}} onMsg={vi.fn()} options={{ mode: "reconnect", reconnectKey: 1 }} />);
    expect(first.readyState).toBe(3);
    expect(first.sent).toHaveLength(1);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("opens a fresh connection on a return to the foreground, not on going to the background", () => {
    try {
      render(
        <OptionsHarness
          url="ws://x/ws"
          sub={{}}
          onMsg={vi.fn()}
          options={{ mode: "reconnect", reconnectOnForeground: true }}
        />,
      );
      const first = lastSock();
      act(() => first.open());
      act(() => {
        setHidden(true);
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(FakeSocket.instances).toHaveLength(1);
      act(() => {
        setHidden(false);
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(first.readyState).toBe(3);
      expect(first.sent).toHaveLength(1);
      expect(FakeSocket.instances).toHaveLength(2);
    } finally {
      delete (document as unknown as Record<string, unknown>).hidden;
    }
  });

  it("with foregroundMinHiddenMs, keeps an open socket across a short hide and reconnects after a long one or when it is not open", () => {
    const flip = (hidden: boolean) =>
      act(() => {
        setHidden(hidden);
        document.dispatchEvent(new Event("visibilitychange"));
      });
    try {
      render(
        <OptionsHarness
          url="ws://x/ws"
          sub={{}}
          onMsg={vi.fn()}
          options={{ mode: "reconnect", reconnectOnForeground: true, foregroundMinHiddenMs: 60_000 }}
        />,
      );
      act(() => lastSock().open());
      // A tab switch: hidden 30 s, socket still open -> the same socket.
      flip(true);
      act(() => void vi.advanceTimersByTime(30_000));
      flip(false);
      expect(FakeSocket.instances).toHaveLength(1);
      // Hidden past the threshold -> a fresh connection.
      flip(true);
      act(() => void vi.advanceTimersByTime(60_001));
      flip(false);
      expect(FakeSocket.instances).toHaveLength(2);
      // Not open yet (still connecting) -> reconnect even after a short hide.
      flip(true);
      flip(false);
      expect(FakeSocket.instances).toHaveLength(3);
    } finally {
      delete (document as unknown as Record<string, unknown>).hidden;
    }
  });

  it("calls onConnect per socket, with a handle that goes stale when superseded", () => {
    const connects: SocketConnection[] = [];
    const options = (key: number): ReconnectingSocketOptions => ({
      mode: "reconnect",
      reconnectKey: key,
      onConnect: (conn) => connects.push(conn),
    });
    const { rerender } = render(<OptionsHarness url="ws://x/ws" sub={{}} onMsg={vi.fn()} options={options(0)} />);
    expect(connects).toHaveLength(1);
    act(() => lastSock().open());
    expect(connects[0].stale()).toBe(false);
    rerender(<OptionsHarness url="ws://x/ws" sub={{}} onMsg={vi.fn()} options={options(1)} />);
    expect(connects).toHaveLength(2);
    expect(connects[0].stale()).toBe(true);
    expect(connects[1].stale()).toBe(false);
  });

  it("fail() closes the connection and retries after retryMs; a stale handle's fail() is a no-op", () => {
    const connects: SocketConnection[] = [];
    const onDrop = vi.fn();
    render(
      <OptionsHarness
        url="ws://x/ws"
        sub={{}}
        onMsg={vi.fn()}
        options={{ mode: "reconnect", retryMs: 3000, onConnect: (c) => connects.push(c), onDrop }}
      />,
    );
    const first = lastSock();
    act(() => first.open());
    act(() => connects[0].fail());
    expect(first.readyState).toBe(3);
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(connects[0].stale()).toBe(true);
    act(() => connects[0].fail()); // already failed
    expect(onDrop).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2999));
    expect(FakeSocket.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeSocket.instances).toHaveLength(2);
    act(() => connects[0].fail()); // superseded
    expect(lastSock().readyState).toBe(0);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("retries on an error even when closing fires no close event", () => {
    render(<OptionsHarness url="ws://x/ws" sub={{}} onMsg={vi.fn()} options={{ mode: "reconnect", retryMs: 3000 }} />);
    const first = lastSock();
    first.close = () => {
      first.readyState = 3; // no onclose
    };
    act(() => first.open());
    act(() => first.onerror?.());
    expect(first.readyState).toBe(3);
    act(() => vi.advanceTimersByTime(3000));
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("drops messages from a superseded socket", () => {
    const onMsg = vi.fn();
    const { rerender } = render(
      <OptionsHarness url="ws://x/ws" sub={{}} onMsg={onMsg} options={{ mode: "reconnect", reconnectKey: 0 }} />,
    );
    const first = lastSock();
    act(() => first.open());
    rerender(<OptionsHarness url="ws://x/ws" sub={{}} onMsg={onMsg} options={{ mode: "reconnect", reconnectKey: 1 }} />);
    act(() => first.message({ late: true }));
    expect(onMsg).not.toHaveBeenCalled();
  });
});
