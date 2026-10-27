// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

/** Only the managed same-origin grid may use the browser's ticketed relay. */
export function chartTickRelay(baseUrl: string): string | null {
  if (!window.__bdobbChartTicks || !window.__bdobbSocketTickets) return null;
  try {
    const base = new URL(baseUrl);
    if (base.origin !== window.location.origin || base.pathname.replace(/\/$/, "") !== "/grid" ||
        base.search || base.hash || base.username || base.password) return null;
    const url = new URL("/grid/chart_ticks_ws", base);
    url.protocol = "wss:";
    return url.href;
  } catch { return null; }
}
