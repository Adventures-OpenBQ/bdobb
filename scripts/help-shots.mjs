#!/usr/bin/env node
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
/* global window, document */

/**
 * Regenerates every screenshot the help topics reference, in both themes.
 *
 *   pnpm help:shots                      every takeable shot, both themes
 *   pnpm help:shots --only tables        one slug
 *   pnpm help:shots --theme dark         one theme
 *
 * Run it once per release, after every feature branch has merged, then look at
 * the diff and commit. A shot whose UI did not change still re-renders; an
 * unchanged-looking PNG with a changed hash is normal and is not a signal.
 *
 * NOT a CI job, and deliberately (D12): text rasterisation depends on the OS
 * and its installed font versions, so two machines produce visually identical
 * but byte-different PNGs. Even on ONE machine and the same inputs, a re-run
 * is visually identical rather than byte-identical: measured, a handful of the
 * thirty-six come back a few dozen bytes different, because a card's
 * antialiased border may land a pixel either way. Enough to regenerate a
 * release's shots and read the diff, not enough to gate a pull request on.
 *
 * Requires Node >= 23.6 (type stripping) to import e2e/fixtures.ts directly,
 * exactly as scripts/browser.mjs already imports src/test/mockServer.ts.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { defaultSeed, openRail, openSettingsTab, MOCK_URL } from "../e2e/fixtures.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOPICS_DIR = resolve(ROOT, "src/help/topics");
const SHOTS_DIR = resolve(ROOT, "src/help/shots");

const VITE_PORT = Number(process.env.BDOBB_BROWSER_PORT ?? 4173);
const MOCK_PORT = Number(process.env.BDOBB_MOCK_PORT ?? 4174);
const APP_URL = `http://localhost:${VITE_PORT}/`;

/**
 * pdf.js's worker, served from disk rather than through vite.
 *
 * vite's `server.fs.allow` defaults to the project root, and `node_modules`
 * in a git worktree is a symlink to the main checkout's copy. vite resolves
 * the realpath, so the worker file lands OUTSIDE the allow list and the dev
 * server answers 403 -- pdf.js then never paints, and a PDF shot comes back
 * as an empty card that looks like a rendering bug rather than a serving one.
 * Fulfilling the request with the very same file the resolver points at keeps
 * the shot a real pdf.js render, and is a no-op in a normal checkout where
 * vite would have served those exact bytes itself.
 */
const PDF_WORKER = createRequire(import.meta.url).resolve("pdfjs-dist/build/pdf.worker.min.mjs");
/**
 * pdf_viewer.css's own icons live next to the worker, under web/images/.
 * Unlike the worker route above, this one is NOT a no-op on a normal
 * checkout: Playwright's page.route intercepts every matching request at the
 * browser layer, unconditionally, before it ever reaches vite -- there is no
 * "vite would have served those exact bytes itself" case to fall back to
 * here, worktree or not. It always serves these files by hand.
 */
const PDFJS_DIR = resolve(dirname(PDF_WORKER), "..");

/** web/images/ ships only these; extend if pdfjs-dist ever adds a new one. */
const IMAGE_CONTENT_TYPES = {
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".png": "image/png",
};

/** The content-type for a pdf.js web/images/ asset, keyed by its extension. */
export function imageContentType(name) {
  const type = IMAGE_CONTENT_TYPES[extname(name)];
  if (!type) throw new Error(`help-shots: no known content-type for pdfjs asset "${name}"`);
  return type;
}

/** Serve pdfjs-dist's raw files -- worker and viewer images -- off disk. */
async function servePdfAssets(page) {
  await page.route("**/pdf.worker.min.mjs*", (route) =>
    route.fulfill({ contentType: "text/javascript", body: readFileSync(PDF_WORKER) }),
  );
  await page.route("**/pdfjs-dist/web/images/**", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/web/images/")[1];
    const path = resolve(PDFJS_DIR, "web/images", name);
    let body;
    try {
      body = await readFile(path);
    } catch {
      throw new Error(`help-shots: missing pdfjs asset "${name}" at ${path}`);
    }
    await route.fulfill({ contentType: imageContentType(name), body });
  });
}

/** Matches src/help/shots.ts's PENDING_MARKER. Re-stated rather than imported:
 * shots.ts carries an import.meta.glob, which is Vite syntax and not Node's. */
const PENDING_MARKER = /^\[shot-pending\]:[ \t]*\S+[ \t]*$/m;

/** After the RSS fixture's newest pubDate (25 Aug 2026 14:30 GMT), so relative
 * timestamps render as a fixed "23h ago" rather than drifting per run. */
const FIXED_TIME = new Date("2026-08-26T13:30:00Z");
const SEED = 20260829;
/** The market's zone: FIXED_TIME then reads 09:30, the session open the period shots show. */
const TIMEZONE = "America/New_York";
const VIEWPORT = { width: 1280, height: 800 };

/** A blinking caret and a scrollbar that appears on hover are the two things
 * that make otherwise-identical runs differ. */
const STILL = `
*,*::before,*::after{transition:none!important;animation:none!important}
*{caret-color:transparent!important}
::-webkit-scrollbar{width:0!important;height:0!important}
`;

export const USAGE = `usage: pnpm help:shots [--only <slug>] [--theme light|dark] [--help]

  --only <slug>          take just that topic's shot (default: every shot)
  --theme light|dark     take just that theme (default: both)
  --help, -h             print this and exit`;

export function parseArgs(argv) {
  const args = { only: null, theme: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    // A flag with nothing after it used to read as `null`, which is the value
    // that means "all of them" -- so `--only` with a typo'd slug dropped took
    // every shot instead of saying so.
    const value = (flag) => {
      const next = argv[++i];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`${flag} needs a value`);
      }
      return next;
    };
    if (argv[i] === "--help" || argv[i] === "-h") args.help = true;
    else if (argv[i] === "--only") args.only = value("--only");
    else if (argv[i] === "--theme") args.theme = value("--theme");
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (args.theme !== null && args.theme !== "light" && args.theme !== "dark") {
    throw new Error(`--theme must be light or dark, not ${args.theme}`);
  }
  return args;
}

/** browser.mjs hard-codes both ports and passes --strictPort, so a running
 * `pnpm e2e` would make vite exit instantly and leave this script waiting on a
 * poll it can never satisfy. Say so in one line instead. */
function portFree(port) {
  return new Promise((res) => {
    const probe = createServer();
    probe.once("error", () => res(false));
    probe.once("listening", () => probe.close(() => res(true)));
    probe.listen(port, "127.0.0.1");
  });
}

function seedWith(files) {
  return { ...defaultSeed(), ...files };
}

/** The usual seed: dashboard "Main" whose one tab, "Main", holds `cards`. */
function mainSeed(...cards) {
  return seedWith({ "dashboards/d1.json": dashboard("d1", "Main", [{ id: "t1", name: "Main", cards }]) });
}

/** A dashboard seed, spelled the way e2e/fixtures.ts spells one. */
function dashboard(id, name, tabs) {
  return JSON.stringify({ id, name, tabs });
}

function card(id, widgetId, params, layout, backendId = "b1") {
  return { id, widgetId, backendId, params, layout };
}

/** A built-in card: no backend behind it, so backendId is the reserved id. */
function builtin(id, widgetId, params, layout) {
  return card(id, widgetId, params, layout, "builtin");
}

// The Period echo alone, every period control on `T` (the range from Jan 1);
// the two period shots differ only in the year end.
const periodSeed = (fyEnd) => mainSeed(
  builtin("c-period", "period_echo", {
    fy_end: fyEnd, quarter: "T", fiscal_year: "T", week: "T", asof: "T",
    start_date: "2026-01-01/T", session: "09:30:00",
  }, { x: 0, y: 0, w: 24, h: 8 }),
);

/** The mock's fiscal_table: AAPL, so its year end comes from the lookup (September). */
const fiscalSeed = (span) => mainSeed(
  card("c-fiscal", "fiscal_table", { symbol: "AAPL", asof: "FQ0", quarter: "T", span }, { x: 0, y: 0, w: 24, h: 9 }),
);

/**
 * The grid itself, which frames exactly the cards on the tab and nothing
 * else -- no tab bar, no empty dashboard below them. Preferred over a
 * hand-measured `clip` for every shot whose subject is "these cards": the
 * frame then follows the cards rather than a guess at where they land.
 */
function grid(page) {
  return page.locator(".react-grid-layout").screenshot({ animations: "disabled" });
}

/** A fixed top-left window of the page, for shots whose subject is not the grid. */
function clip(page, width, height) {
  return page.screenshot({ clip: { x: 0, y: 0, width, height }, animations: "disabled" });
}

/**
 * A card's controls row, one per visible parameter, sits under the title and
 * is always on screen -- there is nothing left to open. Waiting for it keeps
 * every caller's intent (the parameters must be visible before the shot)
 * without pretending there is still a toggle to click.
 */
async function openParams(page, title) {
  const cardBox = page.locator(".react-grid-item", { hasText: title }).first();
  await cardBox.locator(".card-params").waitFor();
}

/**
 * The shot list. `take` gets the prepared page and returns a Buffer.
 * Anything whose fixture arrives with an unmerged branch is simply absent
 * here AND still carries a [shot-pending] line in its topic; the two are
 * cross-checked by the pending() call in main().
 */
const SHOTS = [
  {
    slug: 'statement-view',
    seed: () => seedWith({
      'files/11111111-1111-4111-8111-111111111111.csv': 'fiscal_year,fiscal_period,net_cash_from_operating_activities,capital_expenditure\n2026,Q3,12,-5\n2026,TTM,33,-18\n',
      'dashboards/d1.json': dashboard('d1', 'Cash flow', [{ id: 't1', name: 'Main', cards: [{
        ...builtin('cash', 'local_table', { file: '11111111-1111-4111-8111-111111111111.csv', label: 'Cash flow' }, { x: 0, y: 0, w: 40, h: 8 }),
        view: 'statement', tableDefinition: { table: {}, search: '' },
      }] }]),
    }),
    prepare: page => page.getByRole('cell', { name: '-18', exact: true }).waitFor(),
    take: grid,
  },
  {
    slug: 'workspaces',
    seed: () => seedWith({
      'dashboards/d1.json': dashboard('d1', 'Main', [{ id: 't1', name: 'Quote', cards: [card('quote', 'quote', { symbol: 'AAPL' }, { x: 0, y: 0, w: 40, h: 12 })] }]),
      'dashboards/d2.json': dashboard('d2', 'Market history', [{ id: 't2', name: 'History', cards: [card('history', 'prices', { symbol: 'ACME' }, { x: 0, y: 0, w: 40, h: 18 })] }]),
      'workspaces/w1.json': JSON.stringify({ id: 'w1', name: 'Laptop', preset: 'laptop', slots: [{ slot: 'a', dashboardId: 'd1' }, { slot: 'b', dashboardId: 'd2' }] }),
    }),
    prepare: async page => {
      await page.mouse.move(20, 300);
      await page.locator('nav.left-rail button.rail-item', { hasText: 'Laptop' }).click();
      await page.locator('.workspace-grid').waitFor();
      await page.locator('.workspace-grid').getByText('Market history', { exact: true }).waitFor();
      await page.mouse.move(640, 400);
      await page.locator('nav.left-rail[data-expanded="false"]').waitFor();
    },
    take: page => page.locator('.workspace-view').screenshot({ animations: 'disabled' }),
  },
  {
    slug: "calendar-view",
    seed: () => seedWith({
      "dashboards/d1.json": dashboard("d1", "Calendar", [{id:"t1",name:"Main",cards:[{
        ...card("c1","prices",{symbol:"ACME"},{x:0,y:0,w:40,h:22}),
        view:"calendar",calendar:{cursor:"2026-08-26",dateField:"date",titleField:"event"},
      }]}]),
    }),
    route: async page => page.route("**/prices?*", route => route.fulfill({json:[
      {date:"2026-08-25",event:"Quarterly results",close:100},
      {date:"2026-08-26",event:"Investor presentation",close:101},
      {date:"2026-08-27",event:"Annual meeting",close:102},
    ]})),
    prepare: async page => page.locator(".calendar").getByText("Investor presentation",{exact:true}).waitFor(),
    take: grid,
  },
  {
    slug: "workspace-account",
    seed: defaultSeed,
    prepare: async (page) => {
      await openRail(page);
      await page.getByRole("button", { name: "Connections" }).click();
      await page.getByRole("dialog", { name: "Connections" }).waitFor();
    },
    take: async (page) => page.getByRole("region", { name: "Workspace connections" }).screenshot({ animations: "disabled" }),
  },

  {
    slug: "getting-started",
    seed: () => seedWith({
      "dashboards/d1.json": dashboard("d1", "Markets", [{
        id: "t1", name: "Overview", cards: [
          // w: 17, not 14 -- at 14 the Quote and Screener headers wrap their
          // maximize/close buttons onto a second line.
          card("c1", "quote", { symbol: "AAPL" }, { x: 0, y: 0, w: 17, h: 9 }),
          card("c2", "prices", { symbol: "AAPL" }, { x: 17, y: 0, w: 23, h: 14 }),
          card("c3", "screener", {}, { x: 0, y: 9, w: 17, h: 14 }),
        ],
      }]),
    }),
    take: async (page) => page.screenshot({ animations: "disabled" }),
  },
  {
    slug: "the-left-rail",
    seed: () => railSeed(),
    prepare: openRail,
    take: async (page) => page.locator("nav.left-rail").screenshot({ animations: "disabled" }),
  },
  {
    slug: "dashboards-and-folders",
    seed: () => railSeed(),
    // The topic's alt text is "the rail's DASHBOARD-row context menu", so the
    // right-click lands on a dashboard row, not on the folder: only the
    // dashboard variant carries Move to / Duplicate / Open in new window. The
    // folder is still in the seed, so Move to has somewhere to point.
    prepare: async (page) => {
      await openRail(page);
      await page.getByRole("button", { name: "Markets", exact: true }).click({ button: "right" });
      await page.getByRole("menu").waitFor();
    },
    take: (page) => clip(page, 640, 800),
  },
  {
    slug: "dashboard-tabs",
    seed: () => seedWith({
      "dashboards/d1.json": dashboard("d1", "Markets", [
        { id: "t1", name: "Overview", cards: [card("c1", "quote", { symbol: "AAPL" }, { x: 0, y: 0, w: 14, h: 9 })] },
        { id: "t2", name: "Prices", cards: [] },
        { id: "t3", name: "Screener", cards: [] },
        { id: "t4", name: "Notes", cards: [] },
      ]),
    }),
    take: async (page) => page.locator(".tab-bar").screenshot({ animations: "disabled" }),
  },
  {
    slug: "widget-library",
    seed: defaultSeed,
    prepare: async (page) => {
      await openRail(page);
      await page.getByRole("button", { name: "Widget Library" }).click();
      await page.getByRole("dialog", { name: "Widget library" }).waitFor();
      await page.getByLabel("Type").selectOption("table");
    },
    take: async (page) =>
      page.getByRole("dialog", { name: "Widget library" }).screenshot({ animations: "disabled" }),
  },
  {
    slug: "widget-cards",
    seed: () => cardSeed(),
    prepare: async (page) => {
      const cardBox = page.locator(".react-grid-item", { hasText: "Price History" }).first();
      await cardBox.getByRole("button", { name: "Card menu" }).click();
      await page.getByRole("menu").waitFor();
    },
    take: async (page) => page.screenshot({ clip: cardClip(720), animations: "disabled" }),
  },
  {
    slug: "tables",
    seed: () => seedWith({
      "dashboards/d1.json": dashboard("d1", "Markets", [{
        // h: 14, not 20 -- ten rows is as much of a table as a picture of a
        // column menu needs, and the rows are the expensive part of the PNG.
        id: "t1", name: "Main", cards: [card("c1", "screener", {}, { x: 0, y: 0, w: 40, h: 14 })],
      }]),
    }),
    prepare: async (page) => {
      // The pointer, not locator.click(): Sector runs past the card's right
      // edge, and click() first scrolls its target fully into view -- which
      // slides Company under the pinned Ticker. A user right-clicks the part
      // they can see, and the table does not move.
      const box = await page.getByRole("columnheader", { name: /sector/i }).boundingBox();
      await page.mouse.click(box.x + 10, box.y + box.height / 2, { button: "right" });
      await page.getByRole("menu").waitFor();
    },
    // The grid, not the page: the card is 20 rows tall on an 800px viewport,
    // so a full-page shot spends its bottom third on empty dashboard -- and
    // the column menu opens inside the card, not over the space below it.
    take: grid,
  },
  {
    slug: "charts",
    seed: () => seedWith({
      "dashboards/d1.json": dashboard("d1", "Markets", [{
        id: "t1", name: "Main", cards: [card("c1", "prices", { symbol: "AAPL" }, { x: 0, y: 0, w: 32, h: 18 })],
      }]),
    }),
    prepare: async (page) => page.locator(".js-plotly-plot").waitFor(),
    take: async (page) => page.locator(".react-grid-item").first().screenshot({ animations: "disabled" }),
  },
  {
    slug: "connections",
    seed: defaultSeed,
    prepare: async (page) => {
      await openRail(page);
      await page.getByRole("button", { name: "Connections" }).click();
      await page.getByRole("dialog", { name: "Connections" }).waitFor();
      await page.getByRole("button", { name: "Edit Mock" }).click();
      await page.getByRole("dialog", { name: "Edit backend" }).waitFor();
    },
    // The edit form is its own dialog over the list, so the shot is of it
    // alone; a bare ".bd-dialog" would now match both dialogs -- only the
    // editor carries the --editor modifier.
    take: async (page) => page.locator(".bd-dialog--editor").screenshot({ animations: "disabled" }),
  },
  {
    slug: "ai-library",
    // The mock backend also serves /agents.json (browser-fixtures.mjs), so
    // pointing the Rita URL at it makes discovery succeed in the shot.
    seed: () => ({ ...defaultSeed(), "settings.json": JSON.stringify({ ritaUrl: MOCK_URL }) }),
    prepare: async (page) => {
      await openRail(page);
      await page.getByRole("button", { name: "AI Library" }).click();
      await page.getByRole("dialog", { name: "AI Library" }).waitFor();
      await page.getByRole("heading", { name: "Agent Rita" }).waitFor();
    },
    take: async (page) =>
      page.getByRole("dialog", { name: "AI Library" }).screenshot({ animations: "disabled" }),
  },
  {
    slug: "rita",
    seed: () => ({ ...defaultSeed(), "settings.json": JSON.stringify({ ritaUrl: MOCK_URL }) }),
    prepare: async (page) => {
      await page.getByRole("complementary", { name: "Rita AI pane" }).hover();
      // The pane's pin became a lock at 6.0.3; the button's accessible name
      // is "Lock" either way (its tooltip is what flips).
      await page.getByRole("button", { name: "Lock" }).click();
      await page.getByRole("textbox", { name: "Message Rita" }).fill("What is a ticker?");
      await page.getByRole("button", { name: "Send" }).click();
      await page.getByText("A stock ticker symbol").waitFor();
    },
    take: async (page) =>
      page.getByRole("complementary", { name: "Rita AI pane" }).screenshot({ animations: "disabled" }),
  },
  {
    slug: "provider-keys",
    seed: defaultSeed,
    prepare: async (page) => {
      await openSettingsTab(page, "Provider API Keys");
      // The keys table was replaced by a card grid (Task B9); wait for the
      // first rendered card rather than a table that no longer exists.
      await page.locator(".bd-provider-card").first().waitFor();
    },
    take: async (page) => page.locator(".bd-dialog").screenshot({ animations: "disabled" }),
  },
  {
    slug: "settings-and-logs",
    seed: defaultSeed,
    prepare: async (page) => openSettingsTab(page, "General"),
    take: async (page) => page.locator(".bd-dialog").screenshot({ animations: "disabled" }),
  },
  {
    slug: "import-and-export",
    seed: () => cardSeed(),
    prepare: async (page) => {
      const cardBox = page.locator(".react-grid-item", { hasText: "Price History" }).first();
      await cardBox.getByRole("button", { name: "Card menu" }).click();
      // click, not hover: the Export row is a toggle (setExportSubOpen), and
      // the flyout is unmounted until it fires.
      await page.getByRole("menuitem", { name: /^Export/ }).click();
      await page.getByRole("menuitem", { name: "CSV" }).waitFor();
    },
    take: async (page) => page.screenshot({ clip: cardClip(720), animations: "disabled" }),
  },
  {
    slug: "card-parameters",
    // `congress` is the cascading pair (committee's options depend on
    // chamber); `form_table` is the form fixture, whose panel shows a query
    // param and a form side by side. Two panels open at once is the point:
    // the topic's subject is what a parameters panel IS, in both shapes.
    seed: () => mainSeed(
      card("c-congress", "congress", { chamber: "house", committee: "wm" }, { x: 0, y: 0, w: 20, h: 11 }),
      card("c-form", "form_table", { symbol: "AAPL" }, { x: 20, y: 0, w: 20, h: 11 }),
    ),
    prepare: async (page) => {
      await openParams(page, "Congress Committees");
      await openParams(page, "Form Table");
      // The cascading select only fills once /committees has answered.
      await page.getByLabel("Committee", { exact: true }).waitFor();
    },
    take: grid,
  },
  {
    slug: "period-quarter",
    seed: () => periodSeed("September"),
    prepare: async (page) => {
      // The trigger is named by its label, whatever quarter it shows.
      await page.getByRole("button", { name: "Quarter", exact: true }).click();
      await page.getByRole("dialog", { name: "Quarter" }).waitFor();
    },
    take: (page) => clip(page, 720, 420),
  },
  {
    slug: "period-datetime",
    seed: () => periodSeed("December"),
    prepare: async (page) => {
      await page.getByRole("button", { name: "As of", exact: true }).click();
      await page.getByRole("dialog", { name: "As of" }).waitFor();
    },
    take: (page) => clip(page, 720, 480),
  },
  {
    slug: "period-relative",
    seed: () => periodSeed("December"),
    prepare: async (page) => {
      await page.getByRole("button", { name: "Range", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Range" });
      await dialog.getByRole("tab", { name: "Relative" }).click();
      // A chip loaded, so the preview line has something to say.
      await dialog.getByRole("button", { name: "Last 7 days" }).click();
      await dialog.getByText(/resolves now to/).waitFor();
    },
    take: (page) => clip(page, 760, 560),
  },
  {
    slug: "period-quarter-range",
    // A literal range, so the popover opens on its Absolute grids.
    seed: () => fiscalSeed("2025-Q4/2026-Q4"),
    prepare: async (page) => {
      await page.getByRole("button", { name: "Span", exact: true }).click();
      await page.getByRole("dialog", { name: "Span" }).getByRole("group", { name: "Span end" }).waitFor();
    },
    take: (page) => clip(page, 760, 460),
  },
  {
    slug: "fy-ends",
    seed: () => fiscalSeed("FQ-4/FQ0"),
    prepare: async (page) => {
      // The lookup has answered once the Automatic option names the ticker.
      await page.getByLabel("FY ends").locator("option:checked", { hasText: "AAPL" }).waitFor({ state: "attached" });
    },
    take: grid,
  },
  {
    slug: "running-and-refreshing",
    seed: () => mainSeed(card("c-run", "run_table", { symbol: "AAPL" }, { x: 0, y: 0, w: 20, h: 11 })),
    // Edit the symbol and apply it WITHOUT running: that is precisely the
    // state the stale marker exists to describe -- the rows still say AAPL
    // while the field says MSFT.
    prepare: async (page) => {
      const cardBox = page.locator(".react-grid-item", { hasText: "Run Table" }).first();
      await cardBox.getByRole("cell", { name: "AAPL" }).first().waitFor();
      await openParams(page, "Run Table");
      const symbol = cardBox.getByLabel("Symbol", { exact: true });
      await symbol.fill("MSFT");
      await symbol.press("Enter");
      await cardBox.locator(".card-stale").waitFor();
    },
    // The card, not the grid: it is half the grid's width, and the empty
    // half would be half the picture.
    take: async (page) => page.locator(".react-grid-item").first().screenshot({ animations: "disabled" }),
  },
  {
    slug: "html-and-iframe-widgets",
    // `embed` is served from the mock's origin, so the frame is genuinely
    // cross-origin, as a real framed page would be; `embed_html` is the same
    // document delivered as a payload and put in a srcdoc.
    seed: () => mainSeed(
      card("c-iframe", "embed", { symbol: "AAPL" }, { x: 0, y: 0, w: 20, h: 10 }),
      card("c-html", "embed_html", { symbol: "AAPL" }, { x: 20, y: 0, w: 20, h: 10 }),
    ),
    prepare: async (page) => {
      // Both frames painted, and the framed document itself reached: an
      // iframe shot before load is a white rectangle that looks exactly like
      // a site refusing to embed. Only the `iframe` widget carries the hint
      // footer -- an html widget's payload came from the backend, so there is
      // no address to open externally.
      await page.waitForFunction(
        () => document.querySelectorAll(".widget-frame").length === 2,
        null,
        { timeout: 10_000 },
      );
      await page.locator(".iframe-hint").waitFor();
      for (const frame of await page.locator(".widget-frame").all()) {
        await frame.contentFrame().locator("body").waitFor();
      }
    },
    take: grid,
  },
  {
    slug: "built-in-widgets",
    // Five of the eight: note and clock on the first row, website and feed on
    // the second, markdown full width below; the two echoes (Parameter echo,
    // Period echo) are not pictured. The eighth -- Local file -- is created by
    // a file drop and hidden from the library, so it has no seedable shape
    // here that a reader would recognise as one of the set.
    seed: () => mainSeed(
      builtin("c-note", "note", {
        text: "## Desk notes\n\nEarnings on Thursday.\n\n- check the fails print\n- roll the hedge",
      }, { x: 0, y: 0, w: 20, h: 11 }),
      builtin("c-clock", "clock", {
        zones: "America/New_York,Europe/London,Asia/Tokyo",
        layout: "vertical",
        hourCycle: "24",
        face: "dots",
      }, { x: 20, y: 0, w: 20, h: 11 }),
      builtin("c-site", "website", { url: `${MOCK_URL}/embed` }, { x: 0, y: 11, w: 20, h: 11 }),
      builtin("c-rss", "rss", { url: `${MOCK_URL}/feed.xml`, limit: "6" }, { x: 20, y: 11, w: 20, h: 11 }),
      builtin("c-md", "markdown", {
        text: "# Trading plan\n\nSize down into the number.\n\n1. Confirm the print\n2. Fade the first move",
      }, { x: 0, y: 22, w: 40, h: 14 }),
    ),
    prepare: async (page) => {
      // Five cards deep, this tab's grid is taller than VIEWPORT.height: the
      // Markdown card's heading plus body text (the reason for h: 14 above)
      // pushes the total past what fits in one screen of `.dashboard-area`'s
      // own `overflow: auto`. A real page-scroll would still be within
      // grid()'s reach, but this is an internal scrollport -- content beyond
      // its current scroll position is genuinely clipped, not just unscrolled
      // -- so a taller viewport removes that inner scrollbar entirely rather
      // than asking grid() to capture around it.
      await page.setViewportSize({ width: VIEWPORT.width, height: 1200 });
      await page.locator(".markdown-editor h1").waitFor();
      // The feed is the slowest of the four and the only one that can still
      // be empty when the others have painted.
      await page.locator(".rss-item, .rss-list li").first().waitFor();
    },
    take: grid,
  },
  {
    slug: "date-expression",
    // The dashboard NAMES an exchange, because the card's calendar line is
    // half of what the shot is for. A built-in has no backend, so XNYS
    // resolves on the bundled NYSE file -- real data, and therefore no `⚠`,
    // which is the state a reader should recognise as normal.
    seed: () => seedWith({
      "dashboards/d1.json": JSON.stringify({
        id: "d1",
        name: "Main",
        exchange: "XNYS",
        tabs: [{
          id: "t1",
          name: "Main",
          cards: [builtin("c-probe", "date_probe", { expr: "T-1bd", fy_end: "12" }, { x: 0, y: 0, w: 20, h: 8 })],
        }],
      }),
    }),
    prepare: async (page) => {
      // Both projections painted: the calendar arrives asynchronously, and a
      // shot taken at mount catches the weekday-only state on its way past.
      await page.locator(".date-probe [data-testid='probe-calendar']").waitFor();
    },
    take: grid,
  },
  {
    slug: "documents-pdf-and-files",
    seed: () => mainSeed(card("c-pdf", "two_page_report", {}, { x: 0, y: 0, w: 26, h: 17 })),
    prepare: async (page) => {
      const cardBox = page.locator(".react-grid-item", { hasText: "Two Page Report" }).first();
      // A painted canvas, not just a mounted one: pdf.js renders on its own
      // loop, and a shot taken at mount is a blank page.
      await cardBox.locator(".pdf-body canvas").first().waitFor();
      await cardBox.getByRole("button", { name: "Find" }).click();
      await cardBox.getByLabel("Find in document").fill("Omega");
      await cardBox.locator(".pdf-find-count").waitFor();
    },
    // The card alone: the grid is 40 columns wide and this is 26 of them.
    take: async (page) => page.locator(".react-grid-item").first().screenshot({ animations: "disabled" }),
  },
  {
    slug: "troubleshooting",
    // A card whose backend has gone away: the topic's error-state section.
    // (Through v3 this shot also staged a refused ssrm_table card; v4 serves
    // server-side tables, so there is no refusal left to show.)
    seed: () => mainSeed(
      card("c-down", "bigtable", {}, { x: 0, y: 0, w: 20, h: 10 }),
    ),
    route: async (page) => {
      // The card's own endpoint refuses to connect, which is what a backend
      // that has gone away looks like from a card: an error state with Retry,
      // not an empty table.
      await page.route("**/bigtable*", (route) => route.abort("connectionrefused"));
    },
    prepare: async (page) => {
      await page.getByRole("button", { name: "Retry" }).first().waitFor();
    },
    take: grid,
  },
];

/** A clip wide enough for a card plus its open menu, anchored top-left of the
 * grid area rather than measured, so it does not move when a menu reflows. */
function cardClip(width) {
  return { x: 48, y: 0, width, height: 620 };
}

/** One card, hard against the left edge of the grid, for the two menu shots.
 * defaultSeed puts the prices card at grid x=20 -- the right half of a 1280px
 * viewport -- which cardClip's left-anchored 720px window misses entirely; the
 * first run of this script produced two byte-identical PNGs of the wrong card
 * that way. One card also keeps the menu the only open thing in frame. */
function cardSeed() {
  return mainSeed(card("c-prices", "prices", { symbol: "AAPL" }, { x: 0, y: 0, w: 20, h: 12 }));
}

/** Three dashboards and a folder, for the two rail shots.
 *
 * folders.json is a FoldersFile object -- {folders, folderOrder, placement,
 * collapsed} -- not a bare array. A bare array fails isFoldersFile, is
 * quarantined by loadJson, and the rail then renders no folder at all, which
 * is how the first draft of this seed silently produced a folder-less shot. */
function railSeed() {
  return {
    ...defaultSeed(),
    "folders.json": JSON.stringify({
      folders: [{ id: "f1", name: "Research", parentId: null }],
      folderOrder: ["f1"],
      // Watchlist lives in the folder, so the folder has something to hold.
      placement: { d3: "f1" },
      collapsed: [],
    }),
    "dashboards/d1.json": dashboard("d1", "Markets", [{ id: "t1", name: "Overview", cards: [] }]),
    "dashboards/d2.json": dashboard("d2", "Macro", [{ id: "t2", name: "Main", cards: [] }]),
    "dashboards/d3.json": dashboard("d3", "Watchlist", [{ id: "t3", name: "Main", cards: [] }]),
  };
}

/** Which slugs still declare [shot-pending], read straight off disk. */
function pending() {
  const out = new Set();
  for (const file of readdirSync(TOPICS_DIR)) {
    if (!file.endsWith(".md")) continue;
    const body = readFileSync(resolve(TOPICS_DIR, file), "utf8");
    if (PENDING_MARKER.test(body)) out.add(file.slice(0, -".md".length));
  }
  return out;
}

async function shoot(browser, shot, theme) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    // The app reads settings.theme, but any third-party CSS that consults
    // prefers-color-scheme must not disagree with it.
    colorScheme: theme,
    // Dates and clock faces render in the browser's zone, which is otherwise
    // the host's -- so a shot taken on another machine would move.
    timezoneId: TIMEZONE,
  });
  const page = await context.newPage();

  // A shot of an app that threw is still a PNG, and looks plausible until
  // someone reads the manual. Anything the page reports goes to stderr, so a
  // silently-broken frame leaves a trace beside the byte count.
  page.on("pageerror", (err) => console.error(`  ! ${shot.slug}: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error(`  ! ${shot.slug}: ${msg.text()}`);
  });
  // Deliberately not `requestfailed`: the troubleshooting shot aborts a
  // request on purpose, and a warning about the thing being demonstrated is
  // noise that trains the reader to ignore this channel.

  // Before goto: addInitScript applies to the NEXT navigation, and clock
  // install must precede the app's first Date read.
  await page.clock.install();
  // setFixedTime, deliberately NOT pauseAt: pausing also stops timers and
  // requestAnimationFrame, which would stall Plotly's and pdf.js's render
  // loops and freeze the rail's collapse timer mid-state. setFixedTime
  // freezes only what Date.now() reports.
  await page.clock.setFixedTime(FIXED_TIME);
  await page.addInitScript((seed) => {
    let state = seed;
    Math.random = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    let counter = 0;
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    });
  }, SEED);

  // theme wins over whatever the shot's own seed put in settings.json (it
  // must -- that is how a shot renders in both themes), but a shot that
  // seeds its own settings (e.g. ai-library's ritaUrl) needs the rest of
  // that object to survive, so this merges rather than replaces.
  const seeded = shot.seed();
  const settings = { ...JSON.parse(seeded["settings.json"] ?? "{}"), theme };
  const files = { ...seeded, "settings.json": JSON.stringify(settings) };
  await page.addInitScript((seed) => {
    window.__bdobbSeed = seed;
  }, files);

  await servePdfAssets(page);

  // scripts/browser-fixtures.mjs carries a fake settings service,
  // `fixture_settings` ("Fixture service"), that only the e2e specs need. Left
  // in the manifest it becomes a second tab in the Settings sidebar, and the
  // help would then show the reader a service that does not exist. Strip it
  // from the widgets.json the app sees; the e2e suite keeps it.
  await page.route("**/widgets.json*", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    delete json.fixture_settings;
    await route.fulfill({ response, json });
  });

  // Before goto for the same reason the init scripts are: a route installed
  // afterwards misses the discovery request the app makes on its first paint.
  if (shot.route) await shot.route(page);

  await page.goto(APP_URL);
  await page.locator(".dashboard-area").waitFor();
  await page.addStyleTag({ content: STILL });
  if (shot.prepare) await shot.prepare(page);

  const buffer = await shot.take(page);
  writeFileSync(resolve(SHOTS_DIR, `${shot.slug}-${theme}.png`), buffer);
  await context.close();
  console.log(`  ${shot.slug}-${theme}.png  ${buffer.length} bytes`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  // Explicit opt-in: borrow the already running qualification harness without owning its lifetime.
  const reuseServer = process.env.HELP_SHOTS_REUSE_SERVER === "1";
  for (const port of reuseServer ? [] : [VITE_PORT, MOCK_PORT]) {
    if (!(await portFree(port))) {
      console.error(
        `help-shots: port ${port} is in use. scripts/browser.mjs needs both ` +
          `${VITE_PORT} and ${MOCK_PORT}; stop any running \`pnpm e2e\` first.`,
      );
      process.exit(1);
    }
  }

  const stillPending = pending();
  const wanted = SHOTS.filter((s) => args.only === null || s.slug === args.only);
  if (args.only !== null && wanted.length === 0) {
    console.error(`help-shots: no shot named "${args.only}"`);
    process.exit(1);
  }
  const themes = args.theme === null ? ["light", "dark"] : [args.theme];

  mkdirSync(SHOTS_DIR, { recursive: true });

  const child = reuseServer ? null : spawn("node", ["scripts/browser.mjs"], {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
  });
  let childExited = false;
  child?.on("exit", () => {
    childExited = true;
  });

  let browser = null;
  try {
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (!ready && Date.now() < deadline && !childExited) {
      ready = await fetch(APP_URL).then((r) => r.ok, () => false);
      if (!ready) await new Promise((r) => setTimeout(r, 300));
    }
    if (!ready) throw new Error(`the harness never came up on ${APP_URL} (mock ${MOCK_URL})`);

    browser = await chromium.launch();
    for (const shot of wanted) {
      if (stillPending.has(shot.slug)) {
        // A slug that is in SHOTS and still marked pending is exactly the case
        // this run is here to fix, so it is taken -- the marker is removed by
        // hand afterwards. A slug marked pending and NOT in SHOTS is waiting
        // on a branch, and is silently absent because it is not in `wanted`.
        console.log(`taking ${shot.slug} (currently marked pending)`);
      }
      for (const theme of themes) {
        await shoot(browser, shot, theme);
      }
    }
  } finally {
    if (browser) await browser.close();
    // SIGTERM: browser.mjs handles it, kills vite and closes the mock server.
    child?.kill();
  }

  const notTaken = [...stillPending].filter((slug) => !SHOTS.some((s) => s.slug === slug));
  if (notTaken.length > 0) {
    console.log(`\nstill pending, waiting on an unmerged branch: ${notTaken.sort().join(", ")}`);
  }
}

// Same guard scripts/generate-capabilities.mjs uses: importing this module (its
// test does) must parse the file, not take twenty-four screenshots.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main();
}
