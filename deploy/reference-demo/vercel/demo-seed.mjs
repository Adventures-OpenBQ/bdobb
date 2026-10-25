// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// The browser-mode seed for the public demo: an empty settings file (no user
// JSONs — the original ask), a single Reference backend pointed at the funnel
// URL, and one demo dashboard whose tabs exercise the v3.3 renderers against
// the reference backend's own widgets. Widget ids are the reference backend's
// (verified against its /widgets.json); built-ins use backendId "builtin".
const DASH = "d1f0a2c3-0000-4a22-8c33-referencedemo1";
const BACKEND_ID = "ref-backend-0000";

const card = (id, widgetId, backendId, params, layout) => ({ id, widgetId, backendId, params, layout });
const ref = (id, widgetId, params, layout) => card(id, widgetId, BACKEND_ID, params, layout);

export function buildSeed(backendUrl) {
  const dashboard = {
    id: DASH,
    name: "BDOBB v3.3 — Reference Demo",
    tabs: [
      {
        id: "tab-overview",
        name: "Overview",
        cards: [
          card("c-md", "markdown", "builtin", {
            text: "# BDOBB — Reference Demo\n\nThis is the **v3.3** client running in the browser against OpenBB's public **reference backend**, over Tailscale Funnel. Every tab renders a reference-backend widget:\n\n- **Charts** — native Plotly, a heatmap, a Vega-Lite bar and a Highcharts column (translated to Plotly).\n- **Data** — a table, and a streaming **live grid**.\n- **News** — a sample news feed.\n- **Video** — the Video Library: a YouTube card; pick a video.\n- **Omni** — a prompt widget; pick a Content Type and Submit.\n\nNo keys, no account — synthetic demo data.",
          }, { x: 0, y: 0, w: 24, h: 16 }),
          card("c-clock", "clock", "builtin", {}, { x: 24, y: 0, w: 16, h: 12 }),
        ],
      },
      {
        id: "tab-charts",
        name: "Charts",
        cards: [
          ref("c-plotly", "plotly_chart", {}, { x: 0, y: 0, w: 20, h: 11 }),
          ref("c-heat", "plotly_heatmap", {}, { x: 20, y: 0, w: 20, h: 11 }),
          ref("c-vega", "vega_bar", {}, { x: 0, y: 11, w: 20, h: 11 }),
          ref("c-high", "chains_highchart", {}, { x: 20, y: 11, w: 20, h: 11 }),
        ],
      },
      {
        id: "tab-data",
        name: "Data",
        cards: [
          ref("c-table", "table_widget_from_api_endpoint", {}, { x: 0, y: 0, w: 40, h: 9 }),
          ref("c-grid", "live_grid_data", { symbol: "AAPL,MSFT,TSLA" }, { x: 0, y: 9, w: 26, h: 12 }),
        ],
      },
      {
        id: "tab-news",
        name: "News",
        cards: [ref("c-news", "sample_newsfeed", {}, { x: 0, y: 0, w: 26, h: 18 })],
      },
      {
        id: "tab-video",
        name: "Video",
        // The reference backend's own Video Library. Its widget id is its
        // endpoint (core.py register_widget: widgetId defaults to endpoint), so
        // it carries the leading slash, unlike the others' bare endpoints.
        cards: [ref("c-video", "/get_video", { video_name: "OpenBB Workspace Demo" }, { x: 0, y: 0, w: 20, h: 12 })],
      },
      {
        id: "tab-omni",
        name: "Omni",
        cards: [ref("c-omni", "omni-widget", { type: "markdown" }, { x: 0, y: 0, w: 30, h: 12 })],
      },
    ],
  };

  return {
    "settings.json": JSON.stringify({ theme: "dark", dashboardOrder: [DASH] }),
    "backends.json": JSON.stringify([
      { id: BACKEND_ID, name: "Reference", baseUrl: backendUrl, authLocation: "header", validateWidgets: true },
    ]),
    [`dashboards/${DASH}.json`]: JSON.stringify(dashboard),
  };
}

/**
 * The synchronous <script> that sets window.__bdobbSeed. Every `<` in the JSON
 * is written as \u003c, which JSON.parse reads back unchanged, so a value
 * holding "</script>" (the backend URL is an environment variable) cannot end
 * the tag early.
 */
export function seedScript(seed) {
  return `<script>window.__bdobbSeed = ${JSON.stringify(seed).replace(/</g, "\\u003c")};</script>`;
}

/** `html` with `tag` just before </head>. A function replacement, so a `$&` or `$'` in the tag is inserted as written. */
export function injectIntoHead(html, tag) {
  return html.replace("</head>", () => `${tag}</head>`);
}
