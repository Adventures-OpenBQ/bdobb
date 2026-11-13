// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { useEffect, useRef, useState, type RefObject } from "react";

export type SocketStatus = "idle" | "connecting" | "live" | "error";

/** The live connection a handler was called for. */
type SocketCycle = {
  socket: WebSocket;
  /**
   * True once this connect cycle has been superseded (a reconnect, a url
   * change) or torn down. A handler is never CALLED while stale -- the hook
   * gates that -- so this is for work a handler starts and finishes later:
   * an async seed that resolves into a cycle that is no longer the one on
   * screen must no-op rather than clobber the newer cycle's state.
   */
  stale: () => boolean;
  /** Close and reconnect as a drop would, for a protocol error the caller alone can see. */
  retry: () => void;
};

type SocketHandlers = {
  onOpen?: (cycle: SocketCycle) => void;
  onMessage: (event: MessageEvent, cycle: SocketCycle) => void;
  /** A DROP: a close or an error that will be retried. Not an unmount. `reason` is the server's close reason when it gave one. */
  onClose?: (reason?: string) => void;
};

/** A connection open this long counts as recovered: the next drop waits the base delay again. */
export const STABLE_MS = 30_000;
/** The longest wait between reconnects, however many drops in a row. */
export const MAX_RECONNECT_MS = 60_000;

/**
 * The wait before reconnecting after `drops` consecutive short-lived
 * connections: `base` for the first, doubling, capped at MAX_RECONNECT_MS.
 */
export function reconnectDelay(base: number, drops: number): number {
  return Math.min(base * 2 ** Math.max(0, drops - 1), MAX_RECONNECT_MS);
}

/**
 * One reconnecting websocket, with the plumbing four hooks used to each
 * hand-roll: the connect/retry cycle, its staleness guards, and the timer.
 *
 * `globalThis.WebSocket` is read at connect time, not at module load, so a
 * test can install a fake AFTER importing the hook that uses this one.
 *
 * `handlers` are read through a ref, so a caller that rebuilds them every
 * render -- which every caller does -- cannot tear the socket down. What DOES
 * reconnect is a change of `url` or of `reconnectKey`: the key is for a
 * caller whose subscription frames are not in the url (useTickCache sends its
 * symbol, interval and anchors after open, and a change to any of them has to
 * be re-sent on a fresh connection).
 *
 * `socket` is the live socket or null, for a caller that sends over the OPEN
 * socket outside a handler (useWidgetSocket resubscribes on a symbol change
 * rather than paying a reconnect for it). It is cleared when its own socket
 * drops and on teardown: a real socket's onclose fires after the closing
 * handshake, so on a url change the OLD socket's handler lands once the new
 * socket already owns the ref -- the staleness guard is what stops that late
 * handler from orphaning its replacement.
 */
export function useReconnectingSocket(
  url: string | null,
  handlers: SocketHandlers,
  { reconnectMs = 3000, reconnectKey = "" }: { reconnectMs?: number; reconnectKey?: string } = {},
): { status: SocketStatus; socket: RefObject<WebSocket | null> } {
  const [status, setStatus] = useState<SocketStatus>("idle");
  const socket = useRef<WebSocket | null>(null);
  const current = useRef(handlers);
  current.current = handlers;

  useEffect(() => {
    if (url === null) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Consecutive drops of connections that never stayed up (2026-09-30).
    // Each one doubles the wait before the next connect, up to
    // MAX_RECONNECT_MS; a connection that stays open STABLE_MS resets it. A
    // fixed wait meant a socket the server kept dropping reconnected every
    // 3 s forever -- and a study socket's every reconnect is a fresh history
    // fetch upstream, which on an EODHD card is a billed call.
    let drops = 0;
    // Bumped on every connect() cycle. A cycle's own handlers and the async
    // work they start close over the generation they were born into; once a
    // newer cycle starts, theirs is stale and must no-op instead of
    // clobbering the newer cycle's state or scheduling a second reconnect.
    let generation = 0;

    const connect = () => {
      if (cancelled) return;
      const gen = ++generation;
      const stale = () => cancelled || gen !== generation;
      setStatus("connecting");
      const ws = new globalThis.WebSocket(url);
      socket.current = ws;
      // Guards re-entrancy: onerror and onclose both point at retry(), and
      // ws.close() below can itself invoke onclose synchronously (real
      // sockets close asynchronously, but the shared FakeSocket -- and
      // possibly other environments -- do not). Without this flag set
      // *before* ws.close(), that re-entrant call recurses through
      // close()/onclose forever.
      let retrying = false;
      let openedAt: number | null = null;

      const retry = (event?: Event) => {
        if (stale() || retrying) return;
        retrying = true;
        ws.close();
        socket.current = null;
        setStatus("error");
        // A server that refuses a socket says why in the close frame (live-grid closes 1011 with it).
        const reason = (event as { reason?: unknown } | undefined)?.reason;
        current.current.onClose?.(typeof reason === "string" && reason !== "" ? reason : undefined);
        drops = openedAt !== null && Date.now() - openedAt >= STABLE_MS ? 0 : drops + 1;
        timer = setTimeout(() => {
          timer = null;
          connect();
        }, reconnectDelay(reconnectMs, drops));
      };

      const cycle: SocketCycle = { socket: ws, stale, retry };
      ws.onopen = () => {
        if (stale()) return;
        openedAt = Date.now();
        setStatus("live");
        current.current.onOpen?.(cycle);
      };
      ws.onerror = retry;
      ws.onclose = retry;
      ws.onmessage = (event: MessageEvent) => {
        if (stale()) return;
        current.current.onMessage(event, cycle);
      };
    };

    connect();
    return () => {
      // Must precede close(): FakeSocket.close() -- and some real
      // environments -- fire onclose synchronously, and onclose is retry().
      // Without cancelled set first, that reentrant retry would schedule a
      // reconnect for a hook that has already unmounted.
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      socket.current?.close();
      socket.current = null;
    };
  }, [url, reconnectKey, reconnectMs]);

  return { status, socket };
}
