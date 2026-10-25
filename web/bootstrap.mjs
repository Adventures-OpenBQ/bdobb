// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Web-only: what the preview seeds into a fresh (or lapsed-session) browser
 * tab before the app's own modules evaluate. Split out of web/policy.mjs
 * (Task 10 of the funnel-gateway plan) because policy.mjs is now the
 * vendored stack contract, verbatim from openbq-docker's funnel-gateway --
 * this file is never vendored, and nothing here changes what a route admits.
 *
 * From 8.0.0 (paired stack: openbq-docker v8.0.0) the policy serves /api,
 * /state and the /news family, with /news/ws/news a socket target beside the
 * reference's /ref/live_grid_ws (v3), so the ticket flag is set (when a
 * gateway is configured; src/browser-shim/socket.ts) and the reference backend
 * is seeded. The seed is the built-ins dashboard, which
 * needs no backend, no key and no sign-up, plus a News tab whenever the
 * preview has approved feeds to show and a gateway to relay them.
 *
 * Episode 10 adds live-grid's /grid family: a `preview-grid` backend on
 * <origin>/grid and a Live quotes tab with one live_grid card, seeded only
 * with a gateway AND a vendored policy that serves the grid socket
 * (server.mjs gridSocketServed). The vendored openbq-docker v10.0.0 policy
 * serves it; under a policy without the grid rules (v8.0.0's) the tab is never
 * seeded, so nothing names a backend the door refuses (donor c183f880).
 */

/**
 * `saved` is the signed-in user's stored state (server.mjs savedState): an object of
 * file name -> text, empty when nothing is saved yet, or null/undefined when the store
 * is off or could not be read -- in which case the page must NOT save, because its
 * first save would replace whatever is really in the store with these defaults.
 */
export function bootstrap(config, saved, { grid = false } = {}) {
  const liveGrid = Boolean(grid && config.backend);
  // The AI Library's defaults: Rita on the door's /ai (PREVIEW_RITA) and the stack's MCP server
  // on its /mcp (PREVIEW_MCP), at this origin.
  const services = aiDefaults(config);
  const seed = {
    "settings.json": JSON.stringify(services),
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
      ...(liveGrid ? [{
        id: "preview-grid", name: "Live grid (preview)", baseUrl: config.origin + "/grid",
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
        // Feeds and a gateway both: without the gateway the card could only show an error.
        ...(Object.keys(config.feeds).length && config.backend
          ? [{
              id: "news", name: "News", cards: [
                {
                  // No server URL of its own: the page has exactly one it can reach, and
                  // __bdobbNewsServer below names it (src/lib/news.ts defaultNewsBase).
                  id: "preview-news", widgetId: "news", backendId: "builtin",
                  params: {}, layout: { x: 0, y: 0, w: 40, h: 8 },
                  news: { feeds: Object.keys(config.feeds).map(url => ({ url, name: "", tab: "" })) },
                },
              ],
            }]
          : []),
        ...(liveGrid
          ? [{
              id: "live", name: "Live quotes", cards: [
                {
                  // live-grid's own widget id, from its widgets.json (relayed as
                  // /grid/widgets.json), not one this process invents. The card
                  // fetches /grid/live_grid for its snapshot and opens
                  // /grid/live_grid_ws on a ticket (src/browser-shim/socket.ts).
                  id: "preview-live-grid", widgetId: "live_grid", backendId: "preview-grid",
                  params: { symbol: "AAPL,MSFT,NVDA,BTC-USD,EURUSD" },
                  layout: { x: 0, y: 0, w: 40, h: 14 },
                },
              ],
            }]
          : []),
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
  // Read by src/browser-shim/socket.ts: same-origin sockets (the wire's, and the
  // grid's once the policy serves it) fetch a ticket and open on the gateway
  // instead of here. Without a gateway there is no socket to ticket.
  const tickets = config.backend ? "window.__bdobbSocketTickets=true;\n" : "";
  // Read by src/browser-shim/fs.ts: writes to the app's JSON stores are mirrored to /state.
  const persist = saved ? "window.__bdobbPersist=true;\n" : "";
  // Read by src/lib/news.ts: a News card with no server of its own uses this.
  // Feeds and a gateway both, like the News tab: without the gateway /news only answers 503.
  const news = config.backend && Object.keys(config.feeds).length ? `window.__bdobbNewsServer=${JSON.stringify(config.origin + "/news")};\n` : "";
  // Saved state REPLACES the default seed: merged, a dashboard the user deleted would return.
  const files = saved && Object.keys(saved).length ? withServices(saved, services) : seed;
  const notice = saved ? "Changes are saved to your account" : "Changes reset on reload";
  return `${tickets}${persist}${news}window.__bdobbSeed=${JSON.stringify(files).replaceAll("<", "\\u003c")};
document.addEventListener("DOMContentLoaded",()=>{
 const bar=document.createElement("div");
 bar.className="web-preview-notice";
 bar.append("Private web preview · ${notice} · ");
 const link=document.createElement("a"); link.href="/auth/signout"; link.textContent="Sign out";
 bar.append(link); document.body.prepend(bar);
});`;
}

/**
 * What the AI Library starts with on the preview: the door's Rita and its MCP server -- what
 * VITE_DEFAULT_RITA_URL / VITE_DEFAULT_MCP_URL give a desktop build, MCP's writing tools off.
 */
function aiDefaults(config) {
  const out = {};
  if (config.rita && config.backend) out.ritaUrl = config.origin + "/ai";
  if (config.mcp && config.backend) {
    const url = config.origin + "/mcp";
    out.mcpServers = [{ id: "openbq-mcp", name: "OpenBQ MCP", url, enabled: true }];
    out.mcpDisabledTools = { [url]: ["install_skill", "run_pipeline"] };
  }
  return out;
}

/**
 * Saved state gains each default only where it names nothing of its own: no settings file, no
 * key, or the app's own empty default ("" for ritaUrl, [] for mcpServers -- DEFAULT_SETTINGS,
 * which every save writes, so "cleared" and "never set" look the same). On the preview these are
 * the only Rita and MCP it can reach, so empty is read as unset. An unreadable file is left as it is.
 */
function withServices(saved, services) {
  if (!Object.keys(services).length) return saved;
  const text = saved["settings.json"];
  let settings = {};
  if (text !== undefined) {
    try { settings = JSON.parse(text); } catch { return saved; }
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return saved;
  }
  const out = { ...settings };
  const needsRita = services.ritaUrl && !(typeof settings.ritaUrl === "string" && settings.ritaUrl !== "");
  const needsMcp = services.mcpServers && !(Array.isArray(settings.mcpServers) && settings.mcpServers.length);
  // Nothing to add: the user's own bytes, not a re-serialisation of them.
  if (!needsRita && !needsMcp) return saved;
  if (needsRita) out.ritaUrl = services.ritaUrl;
  if (needsMcp) {
    out.mcpServers = services.mcpServers;
    const kept = typeof settings.mcpDisabledTools === "object" && settings.mcpDisabledTools !== null && !Array.isArray(settings.mcpDisabledTools) ? settings.mcpDisabledTools : {};
    out.mcpDisabledTools = { ...kept, ...services.mcpDisabledTools };
  }
  return { ...saved, "settings.json": JSON.stringify(out) };
}
