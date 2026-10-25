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
 * One socket the hook opened, handed to `onConnect`. A new one is made for
 * every (re)connect, and messages reach `onMessage` only from the current
 * one. A handle goes stale as soon as its socket is closed,
 * superseded or unmounted, so async work started for it (a REST seed) checks
 * `stale()` after every await and drops its result when it is.
 */
export type SocketConnection = {
  /** True once this connection is closed, superseded or unmounted. */
  stale: () => boolean;
  /**
   * Treat this connection as failed: close it and retry after the usual delay
   * (a malformed reply). A no-op on a stale connection or one already failed.
   */
  fail: () => void;
};

export type ReconnectingSocketOptions = {
  /**
   * "resubscribe" (the default, Live Grid): a changed `subscribe` is re-sent on
   * the open socket. "reconnect": the socket takes ONE frame, ever -- the
   * subscription goes out once when it opens, and a changed subscription opens
   * a new connection instead of sending a second frame (the News wire; the
   * gateway closes a socket that sends a second). The change is measured on
   * the subscription's JSON, not its identity.
   */
  mode?: "resubscribe" | "reconnect";
  /** Any change of this value closes the socket and opens a fresh one (Refresh). */
  reconnectKey?: string | number;
  /**
   * Open a fresh connection when the document returns to the foreground. On
   * iOS the webview is suspended with the app, and after a resume a socket can
   * sit OPEN with nothing live behind it, so no close ever fires.
   */
  reconnectOnForeground?: boolean;
  /**
   * With reconnectOnForeground: a return to the foreground reconnects only
   * when the document was hidden at least this long, or the socket is not
   * open. 0 (the default) reconnects on every return -- the iOS case, where
   * a suspended webview cannot tell a dead socket from a live one. The web
   * preview sets a threshold: a browser tab switch leaves the socket alive,
   * and each forced reconnect costs a fresh ticket and a gateway upgrade.
   */
  foregroundMinHiddenMs?: number;
  /** A fixed delay (ms) before every retry, in place of the backoff ladder. */
  retryMs?: number;
  /**
   * A new socket is being opened (first connect, retry or forced reconnect).
   * Its handle is the current connection until the next onConnect.
   */
  onConnect?: (conn: SocketConnection) => void;
  /** The connection ended and a retry is scheduled. */
  onDrop?: (conn: SocketConnection) => void;
};

/**
 * A native WebSocket that re-opens itself. `subscribe` is sent as JSON on every
 * (re)connect. In the default "resubscribe" mode it is re-sent (without tearing
 * the socket down) whenever it changes -- a live_grid changes its symbol set
 * this way; in "reconnect" mode a change opens a new connection instead (see
 * ReconnectingSocketOptions). A non-JSON message is dropped rather than thrown,
 * because one bad frame must not kill the stream. The socket is closed and
 * every timer cleared on unmount or when `url` changes.
 */
export function useReconnectingSocket(
  url: string | null,
  subscribe: unknown,
  onMessage: (message: unknown) => void,
  options: ReconnectingSocketOptions = {},
): SocketStatus {
  const { mode = "resubscribe", reconnectKey, reconnectOnForeground = false, retryMs } = options;
  const [status, setStatus] = useState<SocketStatus>("idle");
  // Latest callbacks/subscription through refs, so the connect effect depends
  // only on `url` and never tears the socket down when a parent re-renders.
  const onMessageRef = useRef(onMessage);
  const optionsRef = useRef(options);
  const subscribeRef = useRef(subscribe);
  const socketRef = useRef<WebSocket | null>(null);
  onMessageRef.current = onMessage;
  optionsRef.current = options;
  // Reconnect mode only: the subscription's JSON joins the connect effect's
  // dependencies, so a changed subscription is a new connection.
  const subscriptionKey = mode === "reconnect" ? JSON.stringify(subscribe) : null;
  if (mode === "reconnect") subscribeRef.current = subscribe;

  // Resubscribe mode: re-subscribe in place when the subscription changes and
  // the socket is open. Reconnect mode never sends a second frame.
  useEffect(() => {
    if (mode === "reconnect") return;
    subscribeRef.current = subscribe;
    const sock = socketRef.current;
    if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(subscribe));
  }, [subscribe, mode]);

  const [resumes, setResumes] = useState(0);
  useEffect(() => {
    if (!reconnectOnForeground) return;
    let hiddenAt: number | null = null;
    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      const hiddenFor = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      const open = socketRef.current?.readyState === WebSocket.OPEN;
      if (!open || hiddenFor >= (optionsRef.current.foregroundMinHiddenMs ?? 0)) setResumes((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [reconnectOnForeground]);

  useEffect(() => {
    if (url === null) {
      setStatus("idle");
      return;
    }
    let attempt = 0;
    let openedAt: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let current: SocketConnection | null = null;

    const connect = () => {
      if (closed) return;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      const sock = new WebSocket(url);
      socketRef.current = sock;
      let done = false;
      const conn: SocketConnection = {
        stale: () => closed || done || current !== conn,
        fail: () => retry(),
      };
      current = conn;
      const retry = () => {
        if (closed || done) return;
        done = true;
        sock.close();
        setStatus("reconnecting");
        if (openedAt !== null && Date.now() - openedAt >= STABLE_MS) attempt = 0;
        openedAt = null;
        const wait = retryMs ?? BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
        attempt += 1;
        optionsRef.current.onDrop?.(conn);
        timer = setTimeout(() => {
          timer = null;
          connect();
        }, wait);
      };
      sock.onopen = () => {
        if (conn.stale()) return;
        openedAt = Date.now();
        setStatus("live");
        sock.send(JSON.stringify(subscribeRef.current));
      };
      sock.onmessage = (event: MessageEvent) => {
        if (conn.stale()) return;
        try {
          onMessageRef.current(JSON.parse(String(event.data)));
        } catch {
          // one bad frame is not fatal
        }
      };
      sock.onclose = retry;
      sock.onerror = retry;
      optionsRef.current.onConnect?.(conn);
    };
    connect();

    return () => {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      socketRef.current?.close();
      socketRef.current = null;
    };
    // subscriptionKey is null in resubscribe mode, so there the effect still
    // depends only on `url`; reconnectKey and resumes are constant unless set.
  }, [url, subscriptionKey, reconnectKey, resumes, retryMs]);

  return status;
}
