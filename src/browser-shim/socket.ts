// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fetch } from "./http";
import "./registry";

/**
 * Web preview only. A socket relayed through a Vercel Function bills function
 * time for as long as it stays open, and the socket the app opens on its own
 * origin (/ref/live_grid_ws, /news/ws/news, and the live grid's /grid/live_grid_ws) is always open. It opens
 * on the gateway instead, which costs Vercel nothing: this asks the preview,
 * which holds the GitHub session, for a ticketed gateway URL (web/server.mjs
 * /socket-ticket) and constructs the real socket on that.
 *
 * The app's one construction site is untouched: useReconnectingSocket, which
 * both Live Grid and the News wire (useNewsWire, in its "reconnect" mode) run
 * on. It reads the WebSocket global at CONNECT time, not at module load, and
 * gets an object with the seven members it uses: onopen, onmessage, onerror,
 * onclose, send, close and readyState (its default mode gates an in-place
 * re-subscribe on readyState === OPEN), plus the static WebSocket.OPEN it
 * compares readyState against. Each (re)connect is a new socket and so a new
 * ticket -- a ticket is single use at the gateway. The targets are the vendored
 * policy's socketTarget (openbq-docker v10.0.0): the reference's /ref/live_grid_ws
 * (v3), /news/ws/news and the live grid's /grid/live_grid_ws (Ep. 10). Under a
 * policy without the grid rules the grid's ticket is refused, and the hook
 * retries it as a drop. Any other same-origin socket's ticket is refused.
 *
 * Inert unless the preview's bootstrap set window.__bdobbSocketTickets, so
 * `vite --mode browser` against a local backend, the e2e suite and help:shots
 * keep the browser's own WebSocket.
 *
 * The ticket fetch goes through the http shim, so a lapsed session (a same-origin
 * 401) lands on the sign-in page exactly as every other request does.
 */
const Native = globalThis.WebSocket;

type Handler<E> = ((event: E) => void) | null;

const TICKET_TIMEOUT_MS = 10_000;

class TicketSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  onopen: Handler<Event> = null;
  onmessage: Handler<MessageEvent> = null;
  onerror: Handler<Event> = null;
  onclose: Handler<CloseEvent> = null;
  private real: WebSocket | null = null;
  private done = false;

  constructor(url: string | URL, protocols?: string | string[]) {
    const target = new URL(url, window.location.href);
    // Anything that is not this origin's own socket is none of the preview's business.
    if (target.host !== window.location.host) return new Native(url, protocols) as unknown as TicketSocket;
    // A deadline of its own: a preview that accepts the request and never answers
    // would otherwise leave the caller CONNECTING for good, with no close to retry on.
    fetch("/socket-ticket?for=" + encodeURIComponent(target.pathname + target.search), {
      cache: "no-store",
      signal: AbortSignal.timeout(TICKET_TIMEOUT_MS),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((ticket: { url: string }) => {
        if (this.done) return;
        const real = new Native(ticket.url);
        this.real = real;
        real.onopen = (event) => this.onopen?.(event);
        real.onmessage = (event) => this.onmessage?.(event);
        real.onerror = (event) => this.onerror?.(event);
        real.onclose = (event) => {
          this.done = true;
          this.onclose?.(event);
        };
      })
      .catch(() => {
        // A drop, as far as the caller can tell: useReconnectingSocket retries it
        // (the News wire after its fixed RECONNECT_MS, the live grid up its backoff
        // ladder), with a fresh ticket.
        if (this.done) return;
        this.done = true;
        this.onclose?.(new Event("close") as CloseEvent);
      });
  }

  get readyState(): number {
    return this.real ? this.real.readyState : this.done ? TicketSocket.CLOSED : TicketSocket.CONNECTING;
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.real?.send(data);
  }

  close(): void {
    if (this.real) return this.real.close();
    // Still waiting on the ticket: never open the real socket at all.
    this.done = true;
  }
}

if (window.__bdobbSocketTickets) globalThis.WebSocket = TicketSocket as unknown as typeof WebSocket;
