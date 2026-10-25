// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Web-only: what the preview seeds into a fresh (or lapsed-session) browser
 * tab before the app's own modules evaluate. Split out of web/policy.mjs
 * (Task 10 of the funnel-gateway plan) because policy.mjs is now the
 * vendored stack contract, verbatim from openbb-docker's funnel-gateway --
 * this file is never vendored, and nothing here changes what a route admits.
 *
 * At this line the policy serves /api, /state and the /ref family, with
 * /ref/live_grid_ws as the one socket target, so the ticket flag is set (when
 * a gateway is configured) and the reference backend is seeded. The seed is the built-ins
 * dashboard: it needs no backend, no key and no sign-up, so it is the one
 * thing the preview can show correctly with nothing configured.
 */

/**
 * `saved` is the signed-in user's stored state (server.mjs savedState): an object of
 * file name -> text, empty when nothing is saved yet, or null/undefined when the store
 * is off or could not be read -- in which case the page must NOT save, because its
 * first save would replace whatever is really in the store with these defaults.
 */
export function bootstrap(config, saved) {
  const seed = {
    "settings.json": "{}",
    "backends.json": JSON.stringify([
      {
        id: "preview-api", name: "OpenBB API (preview)", baseUrl: config.origin + "/api",
        authLocation: "header", validateWidgets: false,
      },
      ...(config.backend && config.tableRelayToken ? [{
        id: "preview-table", name: "Managed tables", baseUrl: config.origin + "/table",
        authLocation: "header", validateWidgets: false,
      }] : []),
      // Only with a gateway: /ref is relayed through it, so without one the backend would just 404.
      ...(config.backend ? [{
        id: "preview-ref", name: "OpenBQ Reference (preview)", baseUrl: config.origin + "/ref",
        authLocation: "header", validateWidgets: false,
      }] : []),
    ]),
    "dashboards/preview.json": JSON.stringify({
      id: "preview",
      name: "Web preview (temporary)",
      tabs: [
        {
          id: "note", name: "Note", cards: [
            { id: "preview-note", widgetId: "note", backendId: "builtin",
              params: { text: "This is a Note card. Its text is a hidden parameter, so it does not clutter the header's controls row and it travels with the dashboard on export." },
              layout: { x: 0, y: 0, w: 20, h: 10 } },
          ],
        },
        {
          id: "markdown", name: "Markdown", cards: [
            { id: "preview-markdown", widgetId: "markdown", backendId: "builtin",
              params: { text: "# Markdown card\n\nA rich-text note with a formatting toolbar.\n\n## What it can show\n\n- Headings\n- A bulleted list\n- **Bold**, *italic*, and a [link](https://docs.openbb.co/workspace)\n\n```\nconst example = \"a fenced code block\";\n```\n" },
              layout: { x: 0, y: 0, w: 26, h: 16 } },
          ],
        },
        {
          id: "clock", name: "Clock", cards: [
            { id: "preview-clock-v", widgetId: "clock", backendId: "builtin",
              params: { zones: "America/New_York,Europe/London,Asia/Tokyo", layout: "vertical", hourCycle: "24", face: "dots" },
              layout: { x: 0, y: 0, w: 18, h: 16 } },
            { id: "preview-clock-h", widgetId: "clock", backendId: "builtin",
              params: { zones: "America/New_York,Europe/London,Asia/Tokyo", layout: "horizontal", hourCycle: "24", face: "dots" },
              layout: { x: 18, y: 0, w: 22, h: 8 } },
          ],
        },
        {
          id: "website", name: "Website", cards: [
            { id: "preview-website", widgetId: "website", backendId: "builtin",
              params: { url: "https://docs.openbb.co/workspace" }, layout: { x: 0, y: 0, w: 40, h: 24 } },
          ],
        },
        {
          id: "rss", name: "RSS", cards: [
            { id: "preview-rss", widgetId: "rss", backendId: "builtin",
              params: { url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", limit: "20" },
              layout: { x: 0, y: 0, w: 22, h: 20 } },
          ],
        },
        {
          id: "grouping", name: "Grouping", cards: [
            { id: "preview-grouping-note", widgetId: "note", backendId: "builtin",
              params: { text: "The two Parameter echo cards below share a Ticker group: the chain-link beside each card's Ticker control opens the Groups menu, and editing either card's Ticker moves both." },
              layout: { x: 0, y: 0, w: 20, h: 8 } },
            { id: "preview-echo-1", widgetId: "param_echo", backendId: "builtin",
              params: { date: "$currentDate" }, bindings: [{ groupId: "g1", paramName: "ticker" }],
              layout: { x: 0, y: 8, w: 14, h: 6 } },
            { id: "preview-echo-2", widgetId: "param_echo", backendId: "builtin",
              params: { date: "$currentDate" }, bindings: [{ groupId: "g1", paramName: "ticker" }],
              layout: { x: 14, y: 8, w: 14, h: 6 } },
          ],
        },
      ],
      groups: [{ id: "g1", name: "Ticker", paramName: "ticker", groupType: "ticker", value: "AAPL" }],
    }),
  };
  // Read by src/browser-shim/socket.ts: same-origin sockets fetch a ticket and open
  // on the gateway instead of here. Without a gateway there is no socket to ticket.
  const tickets = config.backend ? "window.__bdobbSocketTickets=true;\n" : "";
  // Read by src/browser-shim/fs.ts: writes to the app's JSON stores are mirrored to /state.
  const persist = saved ? "window.__bdobbPersist=true;\n" : "";
  // Saved state REPLACES the default seed: merged, a dashboard the user deleted would return.
  const files = saved && Object.keys(saved).length ? saved : seed;
  const notice = saved ? "Changes are saved to your account" : "Changes reset on reload";
  return `${tickets}${persist}window.__bdobbSeed=${JSON.stringify(files).replaceAll("<", "\\u003c")};
document.addEventListener("DOMContentLoaded",()=>{
 const bar=document.createElement("div");
 bar.className="web-preview-notice";
 bar.append("Private web preview · ${notice} · ");
 const link=document.createElement("a"); link.href="/auth/signout"; link.textContent="Sign out";
 bar.append(link); document.body.prepend(bar);
});`;
}
