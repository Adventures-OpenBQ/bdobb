// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";

/**
 * Canned backend for `vite --mode browser`. Shapes follow src/lib/widgetsJson.ts
 * (widgets.json) and the row shapes the renderers already have unit tests for.
 * Widget ids are load-bearing: e2e/fixtures.ts seeds dashboard cards by them.
 */
const days = ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"];
const prices = days.map((date, i) => ({
  date,
  open: 100 + i,
  high: 103 + i,
  low: 98 + i,
  close: 101 + i,
  volume: 1_000_000 + i * 50_000,
}));

/**
 * The cascade fixture. `chamber` has no dependencies; `committee` is
 * templated on it, and /committees answers per `?chamber=` — which is what
 * mockServer's function routes exist for (routing itself is by pathname).
 */
const CHAMBERS = [
  { label: "House", value: "house" },
  { label: "Senate", value: "senate" },
];
const HOUSE_COMMITTEES = [
  { label: "Ways and Means", value: "wm" },
  { label: "Financial Services", value: "fs" },
];
const SENATE_COMMITTEES = [
  { label: "Finance", value: "fin" },
  { label: "Banking", value: "bank" },
];

/**
 * The tabs and form fixtures. Both routes are functions so the ROWS say which
 * question the card last asked -- a static route would answer the same rows
 * whatever was sent, and the spec could only ever count requests.
 */
function tabbedFor(url) {
  return [{ period: url.searchParams.get("period") ?? "", note: "tabbed" }];
}

function formedFor(url) {
  return [{ symbol: url.searchParams.get("symbol") ?? "", note: "formed" }];
}

/** A switch, not an index lookup, so inherited Object.prototype keys answer nothing. */
function committeesFor(url) {
  switch (url.searchParams.get("chamber")) {
    case "house":
      return HOUSE_COMMITTEES;
    case "senate":
      return SENATE_COMMITTEES;
    default:
      return [];
  }
}

/**
 * key-maint's own contract, which a static route could not express: the
 * vendors are contacted -- and a row carries a `test` result -- ONLY for
 * `run_tests=true` (key-maint/app/server.py). Without that distinction every
 * tone the app publishes from this path would be grey, and no spec could tell
 * a probe from a plain status read.
 *
 * FMP comes back rejected on purpose. The app's own start-up probe hits
 * /quote and turns FMP green, so amber here is visibly key-maint's answer and
 * not a leftover from that.
 */
function keysFor(url) {
  const rows = [
    { provider: "FMP", env_var: "FMP_API_KEY", status: "set", demo: false, value: "sk-FIXTURE" },
    { provider: "EODHD", env_var: "EODHD_API_KEY", status: "empty" },
  ];
  if (url.searchParams.get("run_tests") !== "true") return { tier: 3, rows };
  return {
    tier: 3,
    rows: [
      { ...rows[0], test: { result: "auth_failed", detail: "HTTP 200, rejected by body" } },
      { ...rows[1], test: { result: "skipped", detail: "key not set" } },
    ],
  };
}

/**
 * Far more rows than any card can show at once: e2e/table.spec.ts asserts that
 * only a window of them is ever in the DOM. Two string columns, so what the
 * spec asserts on is the literal cell text — formatCell would abbreviate a
 * number (4999 renders as "5K").
 */
const BIG_ROWS = Array.from({ length: 5000 }, (_, i) => ({
  label: `row-${i}`,
  bucket: `b-${i % 7}`,
}));

/**
 * The columnsDefs fixture, for e2e/table-toolkit.spec.ts. Four sectors x 30
 * so a "contains" filter on `sector` lands on exactly 30 of 120 rows; `chg`
 * alternates sign so greenRed produces both classes AND so a "minimum 0"
 * range lands on exactly the 60 even rows; `internal_id` is the column the
 * spec ships hidden; "Number 1 " (with the trailing space) occurs in exactly
 * one `name`, row 1, which is also an Energy row.
 *
 * The names are long on purpose. Measured in Chromium and WebKit: a table at
 * `width: 100%` IGNORES declared column widths that exceed its container and
 * shrinks the columns to fit, so a full-width card never scrolls sideways and
 * there would be no sticky offset to measure. What forces the scrollbar is
 * min-content width under `white-space: nowrap` — with these names the table
 * measures ~658px, and the spec's card is deliberately 14 grid columns wide
 * (~404px of body), which scrolled 254px in both engines.
 */
const SECTORS = ["Technology", "Energy", "Health Care", "Financials"];
const SCREENER_ROWS = Array.from({ length: 120 }, (_, i) => ({
  symbol: `S${String(i).padStart(3, "0")}`,
  name: `Sample Company Number ${i} Incorporated of the Greater Metropolitan Region`,
  // A fraction, as normalizedPercent expects: 0.001 renders as "0.1 %".
  chg: ((i % 2 === 0 ? 1 : -1) * ((i % 25) + 1)) / 1000,
  sector: SECTORS[i % 4],
  internal_id: `id-${i}`,
}));

/**
 * The cell-click grouping fixture. Three symbols: e2e/grouping.spec.ts clicks
 * a DIFFERENT one to move the group, and the same one to prove forceUpdate
 * refetches a source whose own params did not change. `price` is a second,
 * non-clickable column so "plain cells elsewhere" has something to be true of.
 */
const GROUPED_ROWS = [
  { symbol: "AAPL", price: 187.25 },
  { symbol: "MSFT", price: 411.5 },
  { symbol: "NVDA", price: 120.75 },
];

/**
 * The run-button fixture's rows, echoing the symbol the request actually
 * carried. A function route (see mockServer's MockRouteFn) rather than a
 * static one so e2e/run-button.spec.ts can read the TABLE to see which
 * question the card last ran, not only count how many it asked.
 */
function runRowsFor(url) {
  return [{ symbol: url.searchParams.get("symbol") ?? "", price: 187.25 }];
}

/**
 * The v5.3.0 calendar fixture. XNYS only; any other exchange is a 404, which
 * the app remembers as "no calendar on this backend". One fabricated Official
 * closure on Tue 25 Aug 2026 — the day before e2e's pinned clock — so a `bd`
 * step visibly lands on Monday the 24th when THIS calendar answered, and on
 * the 25th when the bundled NYSE file did. Every year in range answers; only
 * 2026 carries the closure.
 */
function calendarFor(url) {
  if (url.searchParams.get("exchange") !== "XNYS") return { __status: 404 };
  const year = Number(url.searchParams.get("year"));
  if (!Number.isInteger(year) || year < 1990 || year > 2040) return { __status: 404 };
  return {
    data: {
      Name: "Mock NYSE",
      Code: "US",
      OperatingMIC: "XNYS",
      Timezone: "America/New_York",
      TradingHours: { Open: "09:30:00", Close: "16:00:00", WorkingDays: "Mon, Tue, Wed, Thu, Fri" },
      ExchangeHolidays: year === 2026 ? { "2026-08-25": { Holiday: "Fixture Day", Type: "Official" } } : {},
    },
  };
}

/** Echoes the `trade` date the request carried, so the spec reads the table, not only the query log. */
function calendarRowsFor(url) {
  return [{ trade: url.searchParams.get("trade") ?? "", note: "calendar" }];
}

/**
 * The v5.4.0 fiscal-year-end lookup, openbb-docker's fundamentals route. AAPL
 * ends its year in September; every other symbol is a 404, which the app
 * remembers for the session and answers with December and a ⚠.
 */
function fiscalYearEndLookup(url) {
  return url.searchParams.get("symbol") === "AAPL" ? { fiscalYearEnd: "September" } : { __status: 404 };
}

/** Echoes what the fiscal_table card sent, so the spec reads the table as well as the query log. */
function fiscalRowsFor(url) {
  const q = (name) => url.searchParams.get(name) ?? "";
  return [{ asof: q("asof"), quarter: q("quarter"), span: q("span"), span_end: q("span_end"), note: "fiscal" }];
}

/**
 * A genuinely valid one-page PDF — catalog, pages node, one /Page, no content
 * stream — 329 bytes, as a base64 literal so the pdf card renders through real
 * pdf.js rather than a stub. Verified to decode to bytes beginning "%PDF-1.4"
 * and to open in Chromium with numPages 1 and a 200x200 viewport.
 */
const TINY_PDF =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMjAwXSA+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDQgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjE4NgolJUVPRgo=";

/**
 * Two pages, each with a real Helvetica text stream ("Alpha report" on page 1,
 * "Omega appendix" on page 2) so pdf.js's text layer has glyphs to build spans
 * from, and a /Link annotation on page 1 whose /GoTo destination is page 2.
 * 1023 bytes, as a base64 literal for the same reason TINY_PDF is one. Pages
 * are 400x800pt so page 2 is below the fold of a `h: 16` card and the link
 * rect sits in the upper half of page 1, clickable without scrolling.
 *
 * Verified before it was committed: loaded through pdfjs-dist in Node it
 * reports numPages 2, the two strings above from getTextContent, and one Link
 * annotation on page 1 with an explicit destination into page 2.
 */
const TWO_PAGE_PDF =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUiA0IDAgUl0gL0NvdW50IDIgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA0MDAgODAwXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA3IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgL0Fubm90cyBbOCAwIFJdID4+CmVuZG9iago0IDAgb2JqCjw8IC9UeXBlIC9QYWdlIC9QYXJlbnQgMiAwIFIgL01lZGlhQm94IFswIDAgNDAwIDgwMF0gL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNyAwIFIgPj4gPj4gL0NvbnRlbnRzIDYgMCBSID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNDMgPj4Kc3RyZWFtCkJUIC9GMSAyOCBUZiA0MCA3MDAgVGQgKEFscGhhIHJlcG9ydCkgVGogRVQKZW5kc3RyZWFtCmVuZG9iago2IDAgb2JqCjw8IC9MZW5ndGggNDUgPj4Kc3RyZWFtCkJUIC9GMSAyOCBUZiA0MCA3MDAgVGQgKE9tZWdhIGFwcGVuZGl4KSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjcgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago4IDAgb2JqCjw8IC9UeXBlIC9Bbm5vdCAvU3VidHlwZSAvTGluayAvUmVjdCBbNDAgNTYwIDM2MCA2NjBdIC9Cb3JkZXIgWzAgMCAwXSAvQSA8PCAvUyAvR29UbyAvRCBbNCAwIFIgL1hZWiAwIDgwMCBudWxsXSA+PiA+PgplbmRvYmoKeHJlZgowIDkKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDEyMSAwMDAwMCBuIAowMDAwMDAwMjYzIDAwMDAwIG4gCjAwMDAwMDAzODkgMDAwMDAgbiAKMDAwMDAwMDQ4MiAwMDAwMCBuIAowMDAwMDAwNTc3IDAwMDAwIG4gCjAwMDAwMDA2NDcgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA5IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo3ODAKJSVFT0YK";

/**
 * The RSS built-in's feed. Served as real XML under a real feed content type
 * (see mockServer's __contentType), because the renderer parses it with the
 * browser's own DOMParser -- a JSON-encoded fixture would prove nothing about
 * the code path a live feed takes. Three items, one deliberately with no
 * <pubDate>, so e2e/rss.spec.ts can see both the relative time and the dash.
 */
const RSS_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Fixture Wire</title>
    <link>https://wire.example/</link>
    <item>
      <title>Rates hold steady</title>
      <link>https://wire.example/rates</link>
      <pubDate>Tue, 25 Aug 2026 14:30:00 GMT</pubDate>
    </item>
    <item>
      <title>Second story</title>
      <link>https://wire.example/second</link>
    </item>
    <item>
      <title>Third story</title>
      <link>https://wire.example/third</link>
    </item>
  </channel>
</rss>`;

/** What the fileSelector param's optionsEndpoint offers. */
const FILE_CHOICES = [
  { label: "Report A", value: "https://files.example/a.pdf" },
  { label: "Report B", value: "https://files.example/b.pdf" },
];

/**
 * The postMessage-protocol fixture, served as a real HTML document from the
 * mock backend's own origin so e2e/iframe.spec.ts exercises a genuinely
 * cross-origin frame rather than a same-origin stand-in. Under
 * SRC_FRAME_SANDBOX this frame keeps that origin, so it is the one fixture
 * that can be sent `openbb-auth`.
 *
 * It announces itself with `openbb-connect` and records what comes back, but
 * it records it CAREFULLY. Message types and parameter maps go into #got as
 * plain text (asserting on the DOM is far steadier in Playwright than reaching
 * into a framed page's globals). An `openbb-auth` never does: only the header
 * NAMES it carried and the LENGTH of each value reach #auth. That proves
 * delivery exactly, and puts no credential anywhere a test, a screenshot or a
 * Playwright trace can read it. One button pushes a parameter change back.
 *
 * It posts to `"*"` because a framed page does not know its parent's origin;
 * that is the page's business, not bdobb's. bdobb identifies it by
 * `event.source`, not by what it targets.
 *
 * The SAME document is what /embed_html returns as an HTML widget's PAYLOAD,
 * handed straight to HtmlRenderer's `srcdoc`. That frame is sandboxed with
 * FRAME_SANDBOX, without allow-same-origin, so it has no origin of its own
 * and must never be sent a credential -- which e2e/iframe.spec.ts asserts,
 * by header name, against this page's own DOM. Recording header names is
 * what lets that assertion fail: a fixture that never wrote them could not
 * catch the regression it exists to catch.
 */
const EMBED_PAGE = `<!doctype html>
<html>
  <head><title>Embed</title></head>
  <body>
    <pre id="got"></pre>
    <pre id="auth"></pre>
    <button id="set-msft" type="button">Set MSFT</button>
    <script>
      var got = [];
      window.addEventListener("message", function (e) {
        var d = e.data && typeof e.data === "object" ? e.data : {};
        if (d.type === "openbb-auth") {
          var h = d.headers || {};
          document.getElementById("auth").textContent = Object.keys(h)
            .sort()
            .map(function (k) { return k + ":" + String(h[k]).length; })
            .join(",");
          got.push("openbb-auth");
        } else if (d.type === "openbb-params-update") {
          got.push("openbb-params-update " + JSON.stringify(d.params || {}));
        } else {
          got.push(String(d.type));
        }
        document.getElementById("got").textContent = got.join(" | ");
      });
      document.getElementById("set-msft").addEventListener("click", function () {
        parent.postMessage(
          { type: "openbb:widget-params:update", paramName: "symbol", value: "MSFT" },
          "*"
        );
      });
      parent.postMessage({ type: "openbb-connect" }, "*");
    </script>
  </body>
</html>`;

/**
 * The apps.json fixture, for e2e/apps.spec.ts. Shape follows src/lib/appsJson.ts
 * (`App`), and it is deliberately the SMALLEST app that still exercises Open
 * end to end: two tabs, so the imported dashboard has a tab strip to assert
 * on, and one card per tab naming a widget this same file's widgets.json
 * serves — so the copy's cards resolve against the real registry and go and
 * fetch. `i` is the widget id; that is how apps.json identifies a card.
 *
 * The second tab's symbol differs from the first's so the two cards are
 * distinguishable in a request log, and both differ from the seeded
 * dashboard's AAPL cards where they can.
 *
 * One app, not several: a backend that serves none is the other case, and
 * every OTHER e2e spec is already that backend — nothing in this file
 * answered /apps.json until now, and an absent route 404s, which discovery
 * reads as "no apps" rather than an error.
 */
const FIXTURE_APP = {
  name: "Macro",
  description: "Quote and price history",
  img: "",
  img_dark: "",
  img_light: "",
  allowCustomization: false,
  tabs: {
    overview: {
      id: "overview",
      name: "Overview",
      layout: [
        {
          i: "quote",
          x: 0,
          y: 0,
          w: 20,
          h: 9,
          state: { params: { symbol: "AAPL" }, chartView: { enabled: false, chartType: "line" } },
        },
      ],
    },
    history: {
      id: "history",
      name: "History",
      layout: [
        {
          i: "prices",
          x: 0,
          y: 0,
          w: 20,
          h: 12,
          state: { params: { symbol: "MSFT" }, chartView: { enabled: false, chartType: "line" } },
        },
      ],
    },
  },
  groups: [],
  prompts: [],
};

/**
 * A fake settings service for the ui: "form" contract
 * (docs/settings-widgets.md): GET answers the section, PUT applies
 * `values.poll_seconds` and answers the full section plus a notice, and a
 * value under 10 is a 422 with a per-field message -- the three answers
 * e2e/settings-addins.spec.ts walks through. State is module-level, so it
 * lives as long as the mock server; the spec sets the value it asserts
 * rather than assuming a starting one.
 */
let fixturePollSeconds = 60;
function fixtureSection() {
  return {
    version: 1,
    title: "Fixture service",
    description: "A fake service proving the settings-widget contract.",
    fields: [
      { id: "poll_seconds", label: "Poll interval", type: "number", value: fixturePollSeconds, min: 10, max: 3600, unit: "s" },
      { id: "uploads", label: "Uploads", type: "boolean", value: false, readOnly: true, readOnlyReason: "Uploads are off on this server." },
    ],
  };
}
function fixtureSettings(_url, req) {
  if (req.method !== "PUT") return fixtureSection();
  const values = JSON.parse(req.body || "{}").values ?? {};
  // The contract sends only the CHANGED fields; the spec edits poll_seconds
  // alone, so any other key (e.g. the read-only uploads) means the app sent
  // the whole form, and the spec fails on the 400.
  if (Object.keys(values).some((k) => k !== "poll_seconds")) {
    return { __status: 400, __body: { error: "only changed fields are sent" } };
  }
  if ("poll_seconds" in values) {
    if (typeof values.poll_seconds !== "number" || values.poll_seconds < 10) {
      return { __status: 422, __body: { errors: { poll_seconds: "At least 10 seconds." } } };
    }
    // Normalised to a multiple of 10, so the 200 body visibly differs from
    // what was typed and a dialog that kept its local edit cannot pass.
    fixturePollSeconds = Math.floor(values.poll_seconds / 10) * 10;
  }
  return { ...fixtureSection(), notice: "Takes effect on restart." };
}

export const MOCK_PORT = Number(process.env.BDOBB_MOCK_PORT ?? 4174);
export const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;

// Rita's capture, served as the mock backend's "/agents.json".
const RITA_AGENTS_JSON = JSON.parse(
  readFileSync(new URL("../src/test/fixtures/rita/agents.json", import.meta.url), "utf8"),
);

// The OpenBQ MCP 2.0.1 captures (host and session id sanitized), served as a
// Streamable-HTTP stub at "/mcp": initialize, the initialized notification,
// the ten-tool list, and a canned call_tool result. A spec counts the
// "tools/call" requests the browser sent to prove a refused call was never forwarded.
const MCP_INITIALIZE = readFileSync(new URL("../src/test/fixtures/mcp/v2.0.1-initialize.sse", import.meta.url), "utf8");
const MCP_TOOLS_LIST = readFileSync(new URL("../src/test/fixtures/mcp/v2.0.1-tools-list.sse", import.meta.url), "utf8");
const SSE = "text/event-stream";

function mcpFor(_url, { body }) {
  let rpc;
  try {
    rpc = JSON.parse(body);
  } catch {
    return { __status: 400, __body: "bad json" };
  }
  if (rpc.method === "initialize") {
    return {
      __status: 200,
      __contentType: SSE,
      __body: MCP_INITIALIZE,
      __headers: { "mcp-session-id": "example", "access-control-expose-headers": "mcp-session-id" },
    };
  }
  if (rpc.method === "notifications/initialized") return { __status: 202, __contentType: "text/plain", __body: "" };
  if (rpc.method === "tools/list") return { __status: 200, __contentType: SSE, __body: MCP_TOOLS_LIST };
  if (rpc.method === "tools/call") {
    const result = { content: [{ type: "text", text: JSON.stringify({ stub: "call_tool result" }) }] };
    return { __status: 200, __contentType: SSE, __body: `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result })}\n\n` };
  }
  return { __status: 404, __body: "unknown method" };
}

const SIMPLE_TEXT = readFileSync(new URL("../src/test/fixtures/rita/simple-text.sse", import.meta.url), "utf8");

// A turn that asks the client to run call_tool for equity_price_historical,
// used only when the user's message carries the probe marker and no tool
// result is in the request yet; every other request gets the plain reply.
const PROXIED_CALL = `event: copilotFunctionCall
data: ${JSON.stringify({
  function: "execute_agent_tool",
  input_arguments: {
    server_id: "m1",
    tool_name: "call_tool",
    parameters: { name: "equity_price_historical", arguments: { symbol: "AAPL" } },
  },
})}

`;

function queryFor(_url, { body }) {
  const proxied = body.includes("proxied-tools-probe") && !body.includes('"role":"tool"');
  return { __status: 200, __contentType: SSE, __body: proxied ? PROXIED_CALL : SIMPLE_TEXT };
}

// The arrange-table round trip: describe_table, then arrange_table with the
// revision and field ids that describe returned, then a closing turn. The round
// comes from the tool messages already in the request, not a counter, so a
// retry or reload stays deterministic. __ARGS__ is the raw JSON input object.
const ARRANGE_TEMPLATE = readFileSync(new URL("../src/test/fixtures/rita/arrange-table.sse", import.meta.url), "utf8");
const toolCall = (tool, args) =>
  ARRANGE_TEMPLATE.replace("__TOOL__", () => tool).replace("__ARGS__", () => JSON.stringify(args));
function toolMessages(body) {
  return (JSON.parse(body || "{}").messages ?? []).filter((m) => m.role === "tool");
}
function lastToolResult(body) {
  const item = toolMessages(body).at(-1)?.data?.[0]?.items?.[0];
  const text = item?.content ?? item?.text;
  return text ? JSON.parse(text) : undefined;
}
function ritaArrange(_url, req) {
  const rounds = toolMessages(req.body).length;
  const reply = (__body) => ({ __status: 200, __contentType: SSE, __body });
  if (rounds === 0) return reply(toolCall("describe_table", { card_id: "csv1" }));
  if (rounds === 1) {
    const described = lastToolResult(req.body);
    return reply(
      toolCall("arrange_table", {
        card_id: "csv1",
        expected_revision: described?.revision,
        arrangement: {
          contract: "table-model/1",
          operations: [
            { op: "category.add", alias: "reg", name: "Region", source_field_id: described?.fields?.[0]?.id, transform: "native" },
            { op: "measure.add", alias: "rev", source_field_id: described?.fields?.[1]?.id, aggregation: "sum" },
            { op: "layout.set", rows: [{ alias: "reg" }], values: [{ alias: "rev" }] },
            { op: "model.enable", enabled: true },
          ],
        },
      }),
    );
  }
  return reply("event: done\ndata: \n\n");
}

export const routes = {
  "/widgets.json": {
    fails: {
      name: "Primary Dealer Fails",
      // A long unbroken URL: the library card must wrap it rather than let it run out of the card.
      description:
        "Statistics for fails to deliver. See https://www.federalreserve.gov/econres/notes/feds-notes/the-systemic-nature-of-settlement-fails-20170703.html for the research note.",
      endpoint: "quote",
      type: "table",
      category: "Fixture",
      gridData: { w: 20, h: 9 },
      params: [],
      source: ["Federal Reserve"],
    },
    quote: {
      name: "Quote",
      description: "One row per symbol",
      endpoint: "quote",
      type: "table",
      category: "Equity",
      gridData: { w: 20, h: 9 },
      params: [{ paramName: "symbol", label: "Symbol", type: "text", value: "AAPL" }],
      source: ["FMP"],
    },
    prices: {
      name: "Price History",
      description: "Daily OHLCV",
      endpoint: "prices",
      type: "chart",
      category: "Equity",
      gridData: { w: 20, h: 12 },
      params: [{ paramName: "symbol", label: "Symbol", type: "text", value: "AAPL" }],
      source: ["FMP"],
    },
    /**
     * key-maint's OWN table widget, served alongside the keys panel below
     * exactly as the real service serves both. Its id is the handle
     * providerKeysStore recognises a key-maint backend by
     * (KEY_MAINT_WIDGET_ID), so without it here no e2e ever reached the
     * startup branch that colours the Library from key-maint rather than from
     * this app's own vendor probes -- and `keysFor` below already honours
     * run_tests, so it answers this widget the same way it answers the panel.
     */
    provider_api_keys: {
      name: "Provider API Keys",
      description: "key-maint's own registry table",
      endpoint: "keys",
      type: "table",
      data: { dataKey: "rows" },
      category: "Admin",
      gridData: { w: 20, h: 9 },
      params: [{ paramName: "run_tests", value: "false" }],
      source: [],
    },
    // The prices rows as a table, for the date column filter in WebKit
    // (e2e/date-filter-webkit.spec.ts). `date` is pinned left and declared
    // cellDataType "date", as the BLS CPI card that V3-005 failed on.
    dated_table: {
      name: "Dated Table",
      description: "Daily OHLCV as a table",
      endpoint: "prices",
      type: "table",
      category: "Equity",
      gridData: { w: 40, h: 12 },
      params: [],
      source: ["FMP"],
      data: {
        table: {
          columnsDefs: [
            { field: "date", headerName: "Date", pinned: "left", cellDataType: "date" },
            { field: "open" },
            { field: "high" },
            { field: "low" },
            { field: "close" },
            { field: "volume" },
          ],
        },
      },
    },
    provider_api_keys_panel: {
      name: "Provider keys",
      description: "",
      endpoint: "keys",
      type: "keys",
      // Mirrors the real key-maint widgets.json, which unwraps to `rows`.
      data: { dataKey: "rows" },
      category: "Admin",
      gridData: { w: 20, h: 9 },
      params: [{ paramName: "run_tests", value: "false" }],
      source: [],
    },
    // What key-maint serves from openbb-docker v3.0.3: its keys panel as a
    // Settings section, labelled with this name. The dialog binds it to the
    // keys widget above (same backend), so there is exactly one Keys tab.
    provider_api_keys_settings: {
      name: "Provider API Keys",
      description: "",
      category: "Admin",
      type: "settings",
      endpoint: "keys",
      settings: { ui: { app: "keys" } },
      raw: false,
    },
    fixture_settings: {
      name: "Fixture service",
      description: "",
      category: "Admin",
      type: "settings",
      endpoint: "fixture_settings",
      settings: { ui: "form" },
    },
    bigtable: {
      name: "Big Table",
      description: "5,000 rows",
      endpoint: "bigtable",
      type: "table",
      category: "Equity",
      gridData: { w: 20, h: 12 },
      params: [],
      source: [],
    },
    screener: {
      name: "Screener",
      description: "columnsDefs: pinned left, hidden, normalizedPercent, greenRed",
      endpoint: "screener",
      type: "table",
      category: "Equity",
      // Narrow on purpose — see the SCREENER_ROWS comment above.
      gridData: { w: 14, h: 16 },
      params: [],
      source: [],
      data: {
        table: {
          columnsDefs: [
            { field: "symbol", headerName: "Ticker", pinned: "left", width: 90 },
            { field: "name", headerName: "Company", width: 700 },
            {
              field: "chg",
              headerName: "Change",
              suffix: " (d)",
              formatterFn: "normalizedPercent",
              renderFn: "greenRed",
              width: 140,
            },
            { field: "sector", headerName: "Sector", width: 520 },
            { field: "internal_id", headerName: "Internal id", hide: true },
          ],
        },
      },
    },
    grouped_table: {
      name: "Grouped Table",
      description: "columnsDefs: cellOnClick groupBy symbol",
      endpoint: "grouped",
      type: "table",
      category: "Equity",
      gridData: { w: 20, h: 9 },
      params: [{ paramName: "symbol", label: "Symbol", type: "text", value: "AAPL" }],
      source: [],
      data: {
        table: {
          columnsDefs: [
            {
              field: "symbol",
              headerName: "Ticker",
              // A bare string, as the manifest often sends it: toStringArray
              // in widgetsJson.ts normalises it to a list.
              renderFn: "cellOnClick",
              renderFnParams: { actionType: "groupBy", groupBy: { paramName: "symbol" } },
            },
            { field: "price", headerName: "Price" },
          ],
        },
      },
    },
    grouped_table_force: {
      name: "Grouped Table Force",
      description: "columnsDefs: cellOnClick groupBy symbol, forceUpdate",
      // Its own endpoint, so the spec can count requests for THIS card without
      // the other grouped card's requests landing in the same tally.
      endpoint: "grouped_force",
      type: "table",
      category: "Equity",
      gridData: { w: 20, h: 9 },
      params: [{ paramName: "symbol", label: "Symbol", type: "text", value: "AAPL" }],
      source: [],
      data: {
        table: {
          columnsDefs: [
            {
              field: "symbol",
              headerName: "Ticker",
              renderFn: "cellOnClick",
              renderFnParams: {
                actionType: "groupBy",
                groupBy: { paramName: "symbol", forceUpdate: true },
              },
            },
            { field: "price", headerName: "Price" },
          ],
        },
      },
    },
    period_table: {
      name: "Period Table",
      description: "A date_range sent as two params, and a quarter whose year end comes from an endpoint",
      endpoint: "period_rows",
      type: "table",
      category: "Fixture",
      gridData: { w: 20, h: 9 },
      params: [
        { paramName: "symbol", label: "Symbol", type: "text", value: "AAPL" },
        {
          paramName: "quarter",
          label: "Quarter",
          type: "quarter",
          value: "T",
          fiscalYearEndEndpoint: "fiscal_year_end",
          optionsParams: { symbol: "$symbol" },
        },
        {
          paramName: "start_date",
          label: "Range",
          type: "date_range",
          value: "2026-01-01/2026-03-31",
          rangeEnd: "end_date",
        },
      ],
      source: [],
    },
    run_table: {
      name: "Run Table",
      description: "runButton: does not execute on a parameter change",
      // Its own endpoint, so the spec can count requests for THIS card without
      // any other card's landing in the same tally.
      endpoint: "run",
      type: "table",
      category: "Equity",
      gridData: { w: 20, h: 9 },
      runButton: true,
      params: [{ paramName: "symbol", label: "Symbol", type: "text", value: "AAPL" }],
      source: [],
    },
    calendar_table: {
      name: "Calendar Table",
      description: "A date defaulting to T-1bd, resolved on the backend's XNYS calendar",
      endpoint: "calendar_rows",
      type: "table",
      category: "Fixture",
      gridData: { w: 20, h: 9 },
      params: [
        { paramName: "symbol", label: "Symbol", type: "text", value: "AAPL" },
        { paramName: "trade", label: "Trade date", type: "date", value: "T-1bd" },
      ],
      source: [],
    },
    fiscal_table: {
      name: "Fiscal Table",
      description: "One ticker, a date on FQ0, a quarter and a quarter range: the v5.4.0 fiscal lookup",
      endpoint: "fiscal_rows",
      type: "table",
      category: "Fixture",
      gridData: { w: 24, h: 9 },
      params: [
        { paramName: "symbol", label: "Symbol", type: "text", value: "AAPL" },
        { paramName: "asof", label: "As of", type: "date", value: "FQ0" },
        { paramName: "quarter", label: "Quarter", type: "quarter", value: "T" },
        { paramName: "span", label: "Span", type: "quarter_range", value: "FQ-4/FQ0", rangeEnd: "span_end" },
      ],
      source: [],
    },
    embed: {
      name: "Embedded Page",
      description: "postMessage protocol fixture",
      // An iframe widget's endpoint IS the URL, used verbatim as the frame
      // src (see fetchesData and WidgetCard's iframe branch) -- so it is an
      // absolute URL, and deliberately on the mock backend's origin rather
      // than vite's, to make the frame cross-origin.
      endpoint: `${MOCK_URL}/embed`,
      type: "iframe",
      category: "Fixture",
      gridData: { w: 20, h: 12 },
      params: [{ paramName: "symbol", label: "Symbol", type: "text", value: "AAPL" }],
      source: [],
    },
    embed_html: {
      name: "Embedded HTML",
      description: "postMessage protocol fixture, srcdoc",
      // An html widget DOES fetch: its payload is the document HtmlRenderer
      // puts in srcdoc. A bare string route is JSON-encoded by the mock
      // server's default branch and comes back as a string, which is exactly
      // what HtmlRenderer accepts.
      endpoint: "embed_html",
      type: "html",
      category: "Fixture",
      gridData: { w: 20, h: 12 },
      params: [{ paramName: "symbol", label: "Symbol", type: "text", value: "AAPL" }],
      source: [],
    },
    tabs_table: {
      name: "Tabbed Table",
      description: "A tabs param, rendered above the renderer",
      endpoint: "tabbed",
      type: "table",
      category: "Equity",
      gridData: { w: 20, h: 9 },
      params: [
        {
          paramName: "period",
          label: "Period",
          type: "tabs",
          value: "d",
          options: [
            { label: "Daily", value: "d" },
            { label: "Weekly", value: "w" },
          ],
        },
      ],
      source: [],
    },
    form_table: {
      name: "Form Table",
      description: "An input form, rendered above the renderer",
      endpoint: "formed",
      type: "table",
      category: "Equity",
      gridData: { w: 20, h: 12 },
      params: [
        // A query param AND a form field both named symbol: the form's is
        // stored as `order.symbol` and must never reach the GET.
        { paramName: "symbol", label: "Symbol", type: "text", value: "AAPL" },
        {
          paramName: "order",
          type: "form",
          endpoint: "orders/submit",
          inputParams: [
            { paramName: "symbol", type: "text", label: "Order symbol", value: "AAPL" },
            { paramName: "qty", type: "number", label: "Quantity", value: 10 },
            { paramName: "submit", type: "button", label: "Send" },
          ],
        },
      ],
      source: [],
    },
    // The same form with ONE field: HTML's implicit submission only fires for
    // a form whose fields amount to a single text or number control, so the
    // two-field fixture above cannot reproduce it. Enter in this field must
    // leave the page where it is.
    form_single: {
      name: "Form Single",
      description: "A one-field form — the implicit-submission case",
      endpoint: "formed",
      type: "table",
      category: "Equity",
      gridData: { w: 20, h: 12 },
      params: [
        {
          paramName: "order",
          type: "form",
          endpoint: "orders/submit",
          inputParams: [
            { paramName: "symbol", type: "text", label: "Order symbol", value: "AAPL" },
            { paramName: "submit", type: "button", label: "Send" },
          ],
        },
      ],
      source: [],
    },
    congress: {
      name: "Congress Committees",
      description: "Committee list, cascading from chamber",
      endpoint: "congress",
      type: "table",
      category: "Government",
      gridData: { w: 20, h: 9 },
      params: [
        {
          paramName: "chamber",
          label: "Chamber",
          type: "endpoint",
          optionsEndpoint: "chambers",
          value: "house",
        },
        {
          paramName: "committee",
          label: "Committee",
          type: "endpoint",
          optionsEndpoint: "committees",
          optionsParams: { chamber: "$chamber" },
          value: "wm",
        },
      ],
      source: [],
    },
    usda_report: {
      name: "USDA Report",
      description: "One PDF document",
      endpoint: "report",
      type: "pdf",
      category: "Government",
      gridData: { w: 20, h: 16 },
      params: [],
      source: [],
    },
    two_page_report: {
      name: "Two Page Report",
      description: "Two pages, with text, a link and something to find",
      endpoint: "two_page",
      type: "pdf",
      category: "Government",
      gridData: { w: 20, h: 16 },
      params: [],
      source: [],
    },
    filings: {
      name: "Filing Documents",
      description: "Several documents, chosen inside the card",
      endpoint: "documents",
      type: "multi_file_viewer",
      category: "Government",
      gridData: { w: 20, h: 16 },
      params: [
        {
          // show: false keeps it out of the params strip; roles is what the
          // renderer finds it by.
          paramName: "files",
          label: "Files",
          type: "endpoint",
          multiSelect: true,
          show: false,
          roles: ["fileSelector"],
          optionsEndpoint: "file_choices",
        },
      ],
      source: [],
    },
  },
  // Fetched by discovery alongside widgets.json, for every spec — the one
  // that opens it is e2e/apps.spec.ts.
  "/apps.json": [FIXTURE_APP],
  "/quote": [{ symbol: "AAPL", price: 187.25, change_percent: 1.23 }],
  "/grouped": GROUPED_ROWS,
  "/grouped_force": GROUPED_ROWS,
  "/period_rows": [{ symbol: "AAPL", rows: 3 }],
  /**
   * The fiscal-year-end source, in each shape the app accepts: AAPL answers
   * a month name (what EODHD sends), MSFT an object, anything else December
   * as a number. The reference backend has no such endpoint; this is the
   * only place the endpoint source is exercised end to end.
   */
  "/fiscal_year_end": (url) => {
    switch (url.searchParams.get("symbol")) {
      case "AAPL":
        return "September";
      case "MSFT":
        return { fiscalYearEnd: "June" };
      default:
        return 12;
    }
  },
  "/run": runRowsFor,
  "/calendar_rows": calendarRowsFor,
  "/api/v1/calendar/trading": calendarFor,
  "/fiscal_rows": fiscalRowsFor,
  "/api/v1/fundamentals/fiscal_year_end": fiscalYearEndLookup,
  "/screener": SCREENER_ROWS,
  "/bigtable": BIG_ROWS,
  "/prices": prices,
  "/congress": [{ chamber: "house", committee: "wm", members: 42 }],
  "/tabbed": tabbedFor,
  "/formed": formedFor,
  // A form endpoint is contracted on its STATUS: an empty 200 is a success,
  // and postForm deliberately does not parse the body.
  "/orders/submit": { __status: 200, __body: "" },
  "/chambers": CHAMBERS,
  "/committees": committeesFor,
  "/report": { content: TINY_PDF, data_format: { data_type: "pdf", filename: "psd.pdf" } },
  "/two_page": {
    content: TWO_PAGE_PDF,
    data_format: { data_type: "pdf", filename: "twopage.pdf" },
  },
  "/file_choices": FILE_CHOICES,
  "/embed": { __status: 200, __contentType: "text/html; charset=utf-8", __body: EMBED_PAGE },
  // Not a document: the html widget's PAYLOAD. The default branch JSON-encodes
  // it, so the app receives a string and HtmlRenderer puts it in srcdoc.
  "/embed_html": EMBED_PAGE,
  // The RSS built-in is not a widgets.json widget -- it has no entry above,
  // because a built-in has no backend behind it. This route exists only so
  // the card has somewhere real to point its own request.
  "/feed.xml": { __status: 200, __contentType: "application/rss+xml", __body: RSS_FEED },
  // Routing is by pathname, so this one static route answers the POST. No GET
  // ever reaches it: fetchesData is false for multi_file_viewer.
  "/documents": [
    { content: TINY_PDF, data_format: { data_type: "pdf", filename: "a.pdf" } },
    { content: TINY_PDF, data_format: { data_type: "pdf", filename: "b.pdf" } },
  ],
  "/fixture_settings": fixtureSettings,
  "/keys": keysFor,
  // So the AI Library's Agents tab has something to discover when the Rita
  // URL points at the mock backend. Evidence, never edited.
  "/agents.json": RITA_AGENTS_JSON,
  // A captured SSE turn, replayed verbatim for the help shot and e2e spec.
  "/v1/query": queryFor,
  "/mcp": mcpFor,
  "/rita-arrange/agents.json": RITA_AGENTS_JSON,
  "/rita-arrange/v1/query": ritaArrange,
};
