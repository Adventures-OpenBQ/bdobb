// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

/**
 * A WebSocket constructor that asks for a single-use ticket before it opens the real socket.
 * The web preview (src/browser-shim/socket.ts) and the desktop's Art's Charts shim
 * (src/lib/artsCharts/desktopSocket.ts) each build one; they differ in which URLs they match
 * and in how a ticketed URL is resolved.
 *
 * The caller gets an object with the seven members useReconnectingSocket uses: onopen,
 * onmessage, onerror, onclose, send, close and readyState (its default mode gates an in-place
 * re-subscribe on readyState === OPEN), plus the static WebSocket.OPEN it compares readyState
 * against. Each (re)connect is a new socket and so a new ticket -- a ticket is single use at
 * the gateway. A URL `matches` rejects goes to the native constructor untouched.
 */

type Handler<E> = ((event: E) => void) | null;

const TICKET_TIMEOUT_MS = 10_000;

export interface TicketSocketOptions {
  /** The constructor the matched socket really opens on, and the one unmatched URLs go to. */
  native: typeof WebSocket;
  /** True for the URLs this shim acts on. */
  matches(url: URL): boolean;
  /** The URL the real socket opens on (ticket included). A rejection reads as a close. */
  resolve(url: URL): Promise<string>;
}

export function makeTicketSocket({ native: Native, matches, resolve }: TicketSocketOptions): typeof WebSocket {
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
      // Anything that is not this shim's own socket is none of its business.
      if (!matches(target)) return new Native(url, protocols) as unknown as TicketSocket;
      // A deadline of its own: a door that accepts the request and never answers
      // would otherwise leave the caller CONNECTING for good, with no close to retry on.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("ticket timeout")), TICKET_TIMEOUT_MS);
      });
      Promise.race([resolve(target), deadline])
        .then((ticketed) => {
          if (this.done) return;
          const real = new Native(ticketed);
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
        })
        .finally(() => clearTimeout(timer));
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
  return TicketSocket as unknown as typeof WebSocket;
}
