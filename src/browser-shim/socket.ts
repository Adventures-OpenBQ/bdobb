// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fetch } from "./http";
import "./registry";

/**
 * Web preview only. A socket relayed through a Vercel Function bills function
 * time for as long as it stays open, and the socket the app opens on its own
 * origin (/ref/live_grid_ws -- the only one at this line) is always open. It
 * opens on the gateway instead, which costs Vercel nothing: this asks the
 * preview, which holds the GitHub session, for a ticketed gateway URL
 * (web/server.mjs /socket-ticket) and constructs the real socket on that.
 *
 * The app's one construction site is untouched: useReconnectingSocket, which
 * LiveGridRenderer runs on. It reads the WebSocket global at CONNECT time, not
 * at module load, and gets an object with the seven members it uses: onopen,
 * onmessage, onerror, onclose, send, close and readyState, plus the static
 * WebSocket.OPEN it compares readyState against. Each (re)connect is a new
 * socket and so a new ticket -- a ticket is single use at the gateway. Only
 * /ref/live_grid_ws is one the gateway serves here, so any other same-origin
 * socket's ticket is refused.
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
    fetch("/socket-ticket?for=" + encodeURIComponent(target.pathname + target.search), { cache: "no-store" })
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
        // with a fresh ticket.
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
