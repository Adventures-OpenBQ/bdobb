// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

/**
 * B6: desktop and iPad open the study socket through the web build's TicketSocket, acting
 * only on the gateway connection's origin plus /ta_series_ws (under its base path). Each
 * (re)connect asks the door for a fresh single-use ticket (P1-A), `GET /charts/ws_ticket?target=`,
 * with the connection's header credential, and appends it LAST, as ticketedWsUrl does for /grid.
 * Not installed in `vite --mode browser`: there the preview's own shim is the global (src/browser-shim/socket.ts).
 */
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { useBackendsStore } from "../../stores/backendsStore";
import { authHeaders, joinUrl } from "../dataClient";
import { makeTicketSocket } from "../ticketSocket";
import { artsChartsConnections } from "./connection";

const gateway = () => {
  const b = artsChartsConnections(useBackendsStore.getState().backends).active;
  return b && b.door === "gateway" && b.headerName && b.headerValue ? b : null;
};

export function installChartsSocketShim(): () => void {
  const native = globalThis.WebSocket;
  globalThis.WebSocket = makeTicketSocket({
    native,
    matches: (u) => {
      const b = gateway();
      if (b === null) return false;
      const base = new URL(joinUrl(b.baseUrl, ""));
      return u.origin.replace(/^ws/, "http") === base.origin && u.pathname === joinUrl(base.pathname, "ta_series_ws");
    },
    resolve: async (u) => {
      const b = gateway();
      if (b === null) throw new Error("no gateway connection");
      const ask = new URL(joinUrl(b.baseUrl, "charts/ws_ticket"));
      const base = new URL(joinUrl(b.baseUrl, "")).pathname.replace(/\/$/, "");
      ask.searchParams.set("target", u.pathname.slice(base.length) + u.search);
      const r = await httpFetch(ask.toString(), { headers: authHeaders(b), connectTimeout: 10_000 } as RequestInit);
      if (!r.ok) throw new Error(String(r.status));
      const { ticket } = (await r.json()) as { ticket?: unknown };
      if (typeof ticket !== "string") throw new Error("no ticket");
      return `${u.href}${u.search ? "&" : "?"}ticket=${encodeURIComponent(ticket)}`;
    },
  });
  return () => { globalThis.WebSocket = native; };
}
