#!/usr/bin/env node
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

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
 * twenty-four come back a few dozen bytes different, because a card's
 * antialiased border may land a pixel either way. Enough to regenerate a
 * release's shots and read the diff, not enough to gate a pull request on.
 *
 * Requires Node >= 23.6 (type stripping) to import e2e/fixtures.ts directly,
 * exactly as scripts/browser.mjs already imports src/test/mockServer.ts.
 */
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { defaultSeed, openRail, openSettingsTab, MOCK_URL } from "../e2e/fixtures.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOPICS_DIR = resolve(ROOT, "src/help/topics");
const SHOTS_DIR = resolve(ROOT, "src/help/shots");

const VITE_PORT = 4173;
const MOCK_PORT = 4174;
const APP_URL = `http://localhost:${VITE_PORT}/`;

/** Matches src/help/shots.ts's PENDING_MARKER. Re-stated rather than imported:
 * shots.ts carries an import.meta.glob, which is Vite syntax and not Node's. */
const PENDING_MARKER = /^\[shot-pending\]:[ \t]*\S+[ \t]*$/m;

/** After the RSS fixture's newest pubDate (25 Aug 2026 14:30 GMT), so relative
 * timestamps render as a fixed "23h ago" rather than drifting per run. */
const FIXED_TIME = new Date("2026-08-26T13:30:00Z");
const SEED = 20260829;
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
    // all twenty-four shots instead of saying so.
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

/** A dashboard seed, spelled the way e2e/fixtures.ts spells one. */
function dashboard(id, name, tabs) {
  return JSON.stringify({ id, name, tabs });
}

function card(id, widgetId, params, layout) {
  return { id, widgetId, backendId: "b1", params, layout };
}

/**
 * The shot list. `take` gets the prepared page and returns a Buffer.
 * Anything whose fixture arrives with an unmerged branch is simply absent
 * here AND still carries a [shot-pending] line in its topic; the two are
 * cross-checked by the pending() call in main().
 */
const SHOTS = [
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
    take: async (page) =>
      page.screenshot({ clip: { x: 0, y: 0, width: 640, height: 800 }, animations: "disabled" }),
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
        id: "t1", name: "Main", cards: [card("c1", "screener", {}, { x: 0, y: 0, w: 40, h: 20 })],
      }]),
    }),
    prepare: async (page) => {
      await page.getByRole("columnheader", { name: /sector/i }).click({ button: "right" });
      await page.getByRole("menu").waitFor();
    },
    take: async (page) => page.screenshot({ animations: "disabled" }),
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
  return seedWith({
    "dashboards/d1.json": dashboard("d1", "Main", [{
      id: "t1", name: "Main",
      cards: [card("c-prices", "prices", { symbol: "AAPL" }, { x: 0, y: 0, w: 20, h: 12 })],
    }]),
  });
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
  });
  const page = await context.newPage();

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

  const files = { ...shot.seed(), "settings.json": JSON.stringify({ theme }) };
  await page.addInitScript((seed) => {
    window.__bdobbSeed = seed;
  }, files);

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

  for (const port of [VITE_PORT, MOCK_PORT]) {
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

  const child = spawn("node", ["scripts/browser.mjs"], {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
  });
  let childExited = false;
  child.on("exit", () => {
    childExited = true;
  });

  let browser = null;
  try {
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (!ready && Date.now() < deadline && !childExited) {
      try {
        execFileSync("curl", ["-sf", "-o", "/dev/null", APP_URL]);
        ready = true;
      } catch {
        await new Promise((r) => setTimeout(r, 300));
      }
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
    child.kill();
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
