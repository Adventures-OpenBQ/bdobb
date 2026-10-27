// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fetch } from "./http";
import "./registry";
import { makeTicketSocket } from "../lib/ticketSocket";

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
const TICKET_TIMEOUT_MS = 10_000;
if (window.__bdobbSocketTickets) {
  globalThis.WebSocket = makeTicketSocket({
    native: globalThis.WebSocket,
    matches: (u) => u.host === window.location.host,
    resolve: async (u) => {
      const r = await fetch("/socket-ticket?for=" + encodeURIComponent(u.pathname + u.search), { cache: "no-store", signal: AbortSignal.timeout(TICKET_TIMEOUT_MS) });
      if (!r.ok) throw new Error(String(r.status));
      return ((await r.json()) as { url: string }).url;
    },
  });
}
