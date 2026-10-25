// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState } from "react";

export type SocketStatus = "idle" | "connecting" | "live" | "reconnecting";

/** ms; capped exponential backoff between reconnect attempts. */
const BACKOFF = [500, 1000, 2000, 4000, 8000, 16000, 32000, 60000];
/**
 * A connection open this long counts as recovered: the next drop starts the
 * ladder again. Back-ported from main's #222 (2026-09-30): resetting on every
 * open meant a backend that accepted and then dropped the socket was retried
 * every 500 ms forever, and the 8 s cap still asked a failing backend every
 * 8 s per card. Short-lived connections now climb the ladder to 60 s.
 */
export const STABLE_MS = 30_000;

/**
 * A native WebSocket that re-opens itself. `subscribe` is sent as JSON on every
 * (re)connect and re-sent (without tearing the socket down) whenever it changes
 * -- a live_grid changes its symbol set this way. A non-JSON message is dropped
 * rather than thrown, because one bad frame must not kill the stream. The
 * socket is closed and every timer cleared on unmount or when `url` changes.
 */
export function useReconnectingSocket(
  url: string | null,
  subscribe: unknown,
  onMessage: (message: unknown) => void,
): SocketStatus {
  const [status, setStatus] = useState<SocketStatus>("idle");
  // Latest callbacks/subscription through refs, so the connect effect depends
  // only on `url` and never tears the socket down when a parent re-renders.
  const onMessageRef = useRef(onMessage);
  const subscribeRef = useRef(subscribe);
  const socketRef = useRef<WebSocket | null>(null);
  onMessageRef.current = onMessage;

  // Re-subscribe in place when the subscription changes and the socket is open.
  useEffect(() => {
    subscribeRef.current = subscribe;
    const sock = socketRef.current;
    if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(subscribe));
  }, [subscribe]);

  useEffect(() => {
    if (url === null) {
      setStatus("idle");
      return;
    }
    let attempt = 0;
    let openedAt: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      const sock = new WebSocket(url);
      socketRef.current = sock;
      sock.onopen = () => {
        openedAt = Date.now();
        setStatus("live");
        sock.send(JSON.stringify(subscribeRef.current));
      };
      sock.onmessage = (event: MessageEvent) => {
        try {
          onMessageRef.current(JSON.parse(String(event.data)));
        } catch {
          // one bad frame is not fatal
        }
      };
      const retry = () => {
        if (closed) return;
        setStatus("reconnecting");
        if (openedAt !== null && Date.now() - openedAt >= STABLE_MS) attempt = 0;
        openedAt = null;
        const wait = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
        attempt += 1;
        timer = setTimeout(connect, wait);
      };
      sock.onclose = retry;
      sock.onerror = () => sock.close();
    };
    connect();

    return () => {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [url]);

  return status;
}
