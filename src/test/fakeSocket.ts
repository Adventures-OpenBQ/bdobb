// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A spec-accurate stand-in for `WebSocket` for a test that stubs the global
 * constructor: the web preview's socket shim (`src/browser-shim/shims.test.ts`),
 * the News wire's ticketed path (`src/hooks/useNewsWire.tickets.test.tsx`) and,
 * since v10, the live grid (`LiveGridRenderer.test.tsx`), which drives the real
 * useReconnectingSocket through it.
 * `useNewsWire.test.tsx` predates it and keeps its own richer fake, whose seed
 * and reply plumbing this one has no use for.
 */
export class FakeSocket {
  static last: FakeSocket | null = null;
  static all: FakeSocket[] = [];
  static OPEN = 1;
  sent: string[] = [];
  closed = false;
  // Spec-accurate: a real WebSocket starts CONNECTING (0) and only reaches
  // OPEN (1) asynchronously, after the handshake -- never synchronously in
  // the constructor. `open()` is what every test uses to simulate that.
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
    FakeSocket.all.push(this);
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  send(data: string) {
    this.sent.push(data);
  }
  /** Simulates an inbound frame: JSON-stringifies `payload` and delivers it via onmessage. */
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  close() {
    this.closed = true;
    this.readyState = 3;
    // A real socket's close() fires onclose asynchronously once the closing
    // handshake finishes; this is what lets a test exercise the hook's own
    // cleanup calling close() and triggering its own onclose handler.
    this.onclose?.();
  }
}
