# Clean-line Fix Batch (2026-10-08) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix D-005, D-007, D-008 and D-002 at the earliest clean line that ships each feature, carry every fix upward so corrected lower lines are real ancestors of the upper lines, add the Window-menu pins (Keep Sidebar Open on v5, Keep Rita Open on v6), and requalify v3, v4, v5 and v6 with receipts.

**Architecture:** v3 fixes go on a new branch `claude/clean-v3-fixbatch`, cut from `3abc906` (D-005, already built) in the standalone v3 repo. The shared v4/v5/v6 repo fetches that branch and merges it into v4. v4 is then merged into v5, and v5 into v6, the same way v4 and v5 were assembled. Each line adds its own home-line work on top of the merge and then runs its declared gates. The Window-menu pins are native Tauri `CheckMenuItem`s. The UI owns pin state and pushes each checkmark through one small command (`set_window_pin`).

**Tech Stack:** React 19 + zustand + vitest 2.1 (jsdom), Playwright, Tauri 2.11.5 (Rust, `tauri::menu`), pnpm, node `--test`.

**Spec:** the user-approved scope below (2026-10-08), plus the defect records in `docs/releases/validation/v6/regression/defects.md` (D-002, D-005, D-007, D-008) on `codex/clean-v6`.

---

## Approved scope (user, 2026-10-08): what this plan implements

The rule is "fix at the earliest line that ships the feature, carry into every later line". Everything stays local: no push, no tags.

| Item | Home | Carry | Root cause → fix |
|---|---|---|---|
| D-005 | v3 (done: `3abc906`) | v4, v5, v6 | `DashboardGrid` lets react-grid-layout compact vertically, and `onLayoutChange` persists the result. Fix: `compactType={null}` plus a real-RGL test. |
| D-008 | v3 | v4, v5, v6 | `appsJson.ts` blanks a non-string group `defaultValue`. Fix: `paramString(rawGroup.defaultValue) ?? ""`. Dropping unjoined groups is correct and stays. |
| D-002 | v3 | v4, v5, v6 | `web/browser-smoke.mjs` waits for features this line never had. Fix: scope it to the Grouping tab's Parameter echo round trip, then gate `test:web:browser` after `build:web`. |
| D-007 | v4 | v5, v6 | `appsExtensionsV4.ts:157` stores curated `pivot-v1` as a worker-only `tableDefinition.analytical`. Fix (option A): `extras: { pivot: recipe }` and drop the `migratePivot` import. Backend tables stay off the client worker. |
| Window ▸ Keep Sidebar Open | v5 | v6 | New CheckMenuItem that toggles the active workspace's `railsOpen.left` through `setRailsOpen`. Disabled when no workspace is active. |
| Window ▸ Keep Rita Open | v6 | — | New CheckMenuItem that toggles `chatStore.pinned` through `togglePinned`, with accelerator `CmdOrCtrl+Shift+A`. The JS handler must not double-toggle in the native app. |

## Decisions this plan makes (read before executing)

1. **The v3 fix branch is cut from `3abc906`, not from the tip of `codex/clean-v3-repair`.** The brief asked for the tip. At planning time the tip was 31 commits deep and moving: `fc6d881`, then `7f92e2c` within the hour. It carries an in-progress Workspace-connection programme (`5ab98df`…`7f92e2c`, 52 files, +7462/−489). The carry is a merge, so cutting from the tip would merge that unreviewed programme into v4, v5 and v6. `3abc906` is a direct child of `277c9a5`, which v4, v5 and v6 already contain, so merging the fix branch brings exactly D-005, D-008, D-002 and their receipts. Cost if wrong: the Workspace programme reaches v4+ later through its own merge, which is what that workstream would do anyway.
2. **How the v3 commits reach `codex/clean-v3-repair`:** they stay on `claude/clean-v3-fixbatch` for that workstream to merge. A fast-forward is impossible because the branch has diverged, and that checkout has uncommitted edits. Task 3 proves the merge is clean and that the D-002 smoke passes on the merged tip seed (`src/lib/bootstrap.ts` differs at the tip). It records the result in the v3 receipts for the other workstream. This plan never touches `codex/clean-v3-repair`, its checkout, its stash or its tags.
3. **Carry by merge, not cherry-pick.** v4 merged v3 (`d333753`: "Merge commit 'refs/integration/v3-browser-help'") and v5 merged v4 (`325e1d4`). `v5-reconciliation.md` and `provenance.md` require that corrected lower lines be actual ancestors. v6 was branched from v5 `8988979`, so merging the updated v5 into v6 keeps the same rule. Cherry-picks would leave v4+ without the v3 commits in their ancestry.
4. **Merge conflicts were dry-run on 2026-10-08** in a throwaway clone with `git merge-tree`, using a simulated D-008 + D-002 commit on `3abc906`. In all three lines the only conflict is `src/components/DashboardGrid.tsx`: v4+ added `margin`/`containerPadding` props where `3abc906` added `compactType={null}`. The resolution is to keep both hunks (exact text in Task 4). `src/lib/appsJson.ts` and `web/browser-smoke.mjs` merged cleanly. `web/browser-smoke.mjs`, `web/bootstrap.mjs`, `web/README.md` and `.github/workflows/ci.yml` are byte-identical on `3abc906`, the v3 tip, v4, v5 and v6.
5. **The declared gate set is `.github/workflows/ci.yml`.** It is identical on all four lines, and there is no remote, so it is the written record. `test:web:browser` goes into its `e2e` job after Playwright Chromium is installed and after `pnpm build:web`. The `build` job has no browser, and `vercel.json`'s buildCommand is a deploy command, so neither changes. `web/README.md` says the smoke "runs by hand, not in CI", and that sentence is corrected. Because the edit is made on v3, it merges upward.
6. **Behaviour change to flag to the user (not decided here):** on macOS the native `⌘⇧A` accelerator fires while the focus is in a text field and while a dialog is open. Today the JS handler ignores both cases, and Help documents that. In the desktop app, Help will now say the shortcut works anywhere. The browser build keeps the old behaviour. If the user wants the old behaviour in the desktop app, drop the accelerator from the menu item and keep the JS handler. That is a one-line change in Task 11.
7. **Per-line receipts go in new files** under `docs/releases/validation/<line>/fixbatch-2026-10-08/`. Merges never conflict on new files. One gate script is committed on v3, and every line runs that same file with its own output directory.

## Global Constraints

- Repos and checkouts:
  - v3: standalone repo `~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v3-repair`. New worktree `~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v3-fixbatch`, branch `claude/clean-v3-fixbatch`. Never edit, stash, commit in or reset the `bdobb-clean-v3-repair` checkout. Its uncommitted edits belong to another workstream.
  - v4: `~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v4-integration` (`codex/clean-v4-integration`, `d3337532d7938193f258fd945425d6f633bab1c5`).
  - v5: `~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v5-reconciled` (`codex/clean-v5-reconciled`, `89889791bad5b44c857f3efe4b528231dd299560`).
  - v6: `~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v6` (`codex/clean-v6`, at or after `416c75c09d7911a254cc97c00ca6267acd84ebd5` plus this plan's commit).
- Work the lines strictly in order: v3, then v4, then v5, then v6. A line's merge starts only after the line below has committed its gate receipts.
- No push, no tags, no tag moves, no edits outside these repos. Scratch files go in the session scratchpad.
- Before every commit run `git rev-parse --show-toplevel` and compare it with the checkout named in the task. Stop on a mismatch, because the shell can revert to another checkout.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never write a tailnet hostname (`*.ts.net`), tailnet IP, token or secret into a tracked file. Receipts replace `$HOME` with `<home>`. The public `scrub` patterns do not catch `*.ts.net` service names, so each receipt task greps for them explicitly.
- TDD: each code change starts with a test that fails for the stated reason.
- A changed or removed existing assertion is logged as a user-approved assertion change in that line's assembly doc. The D-007 change is the only one this plan authorises. Any other is a ⚠ stop-and-ask.
- Do not run NAS live gates. The one exception is the optional, labelled v6 live Rita gate at the end of Task 12.
- Unit suite: `pnpm exec vitest run --maxWorkers=2 --minWorkers=1 --testTimeout=60000` takes 3–10 minutes. Check `uptime` first. If a pass needed reruns, record it as COMPOSITE EVIDENCE that names each rerun file, never as one green run.
- Native QA bundle (v6 only): identifier `com.artcashin.bdobb.clean.v6`, product name `BDOBB Clean v6`, through the gitignored overlay `.superpowers/qa-v6-overlay.json`. Never use the production identifier.

## Review Focus

1. **⌘⇧A while typing or behind a dialog in the desktop app.** The native accelerator now toggles the Rita pin in both cases, and the browser build still ignores them. Pinned by Task 11's shortcut test (native: the JS handler never toggles) and by the existing browser-path test (typing target ignored). Help text changes in Task 11. Decision 6 asks the user.
2. **A pin write that fails.** macOS flips the checkmark on click. If `setRailsOpen` rejects, the checkmark must go back to the stored value. Pinned by Task 8's "a pin write that fails puts the checkmark back".
3. **The active workspace closes or is switched.** "Keep Sidebar Open" must follow the new active workspace's pin, and must be disabled and unchecked with none. Pinned by Task 8's "follows the active workspace" test.
4. **A curated pivot exported and re-imported.** After D-007, `table.pivot` must survive `exportCompatibleApp` → `importApps`. Pinned by Task 5's round-trip test.
5. **Group defaults that `paramString` cannot render** (an empty array, an object). These must still import as `""` without throwing, which is today's behaviour for them. Pinned by Task 1's third D-008 test.

---

## File map

| Line | File | Change |
|---|---|---|
| v3 | `src/lib/appsJson.ts` (~:705) | D-008 one-liner |
| v3 | `src/lib/appsJson.d008.test.ts` | new: D-008 tests |
| v3 | `web/browser-smoke.mjs` | D-002 rewrite (full text in Task 2) |
| v3 | `.github/workflows/ci.yml` | `e2e` job: `build:web` + `test:web:browser` |
| v3 | `web/README.md` | the smoke paragraph |
| v3 | `docs/releases/validation/v3-repair/fixbatch-2026-10-08/{run-gates.sh,README.md,*.log,gates.tsv,head.txt}` | new: gate script and receipts |
| v4 | merge of `refs/integration/v3-fixbatch-2026-10-08` | `DashboardGrid.tsx` conflict: keep both |
| v4 | `src/lib/appsExtensionsV4.ts:9,157` | D-007 |
| v4 | `src/lib/appsJson.d007.test.ts` | new: D-007 tests |
| v4 | `src/lib/appsJson.cleanV4.test.ts:46-49` | user-approved assertion change |
| v4 | `docs/releases/provenance.md:74`, `docs/releases/v4-integration.md` (append), `docs/reference-manual/v4/README.md:39` | ruling correction and ledger |
| v4 | `docs/releases/validation/v4-integration/fixbatch-2026-10-08/` | receipts |
| v5 | merge of `codex/clean-v4-integration` | expected clean |
| v5 | `src-tauri/src/lib.rs` | Window ▸ Keep Sidebar Open, `set_window_pin` |
| v5 | `src/hooks/useWindowMenuPins.ts` (+ `.test.tsx`) | new: menu ↔ store sync |
| v5 | `src/browser-shim/core.ts` (+ `shims.test.ts`) | `isTauri` export |
| v5 | `src/App.tsx` | mount the hook |
| v5 | `src/help/topics/{keyboard-shortcuts,workspaces}.md`, `src/help/guide/{keyboard-shortcuts,workspaces}.md`, `src/help/windowMenu.test.ts` (new) | Help |
| v5 | `docs/releases/v5-reconciliation.md` (append), `docs/releases/validation/v5-reconciled/fixbatch-2026-10-08/` | ledger and receipts |
| v6 | merge of `codex/clean-v5-reconciled` | resolve as Task 10 says |
| v6 | `src-tauri/src/lib.rs`, `src/hooks/useWindowMenuPins.ts` (+ test), `src/hooks/useDashboardShortcuts.ts` (+ test) | Keep Rita Open, single toggle |
| v6 | `src/help/topics/{keyboard-shortcuts,rita}.md`, `src/help/guide/{keyboard-shortcuts,rita-chat}.md`, `src/help/windowMenu.test.ts` | Help |
| v6 | `docs/releases/v6-assembly.md` (append, plus a review-warning row), `docs/releases/validation/v6/fixbatch-2026-10-08/` | ledger, receipts, native bundle |

---

### Task 1: v3 worktree and D-008 (array group default)

**Files:**
- Create: `src/lib/appsJson.d008.test.ts`
- Modify: `src/lib/appsJson.ts` (the line `const defaultValue = typeof rawGroup.defaultValue === "string" ? rawGroup.defaultValue : "";`, ~:705)

**Interfaces:**
- Consumes: `importApps(json, registry)` from `./appsJson`, `effectiveParams(card, groups, widget, groupsDisabled)` from `./paramGroups`, `widget(over)` from `../test/fixtures`, and `paramString(value): string | undefined` from `./widgetsJson` (already imported in appsJson.ts).
- Produces: branch `claude/clean-v3-fixbatch` in worktree `$W3`, used by Tasks 2–4.

- [ ] **Step 1: Create the worktree from `3abc906`**

```bash
V3R=~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v3-repair
W3=~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v3-fixbatch
git -C "$V3R" cat-file -t 3abc906d0ee400fc4c51e01cb550738684902d44   # expect: commit
git -C "$V3R" worktree add -b claude/clean-v3-fixbatch "$W3" 3abc906d0ee400fc4c51e01cb550738684902d44
cd "$W3" && git log --oneline -2   # expect 3abc906 then 277c9a5
pnpm install --frozen-lockfile --prefer-offline
```
If `claude/clean-v3-fixbatch` already exists, stop and ask; never reset it. `git -C "$V3R" status --short` must show the same files before and after this step, because the other workstream's edits must stay untouched.

- [ ] **Step 2: Write the failing test** `src/lib/appsJson.d008.test.ts`

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { expect, it } from "vitest";

import { importApps } from "./appsJson";
import { effectiveParams } from "./paramGroups";
import { widget } from "../test/fixtures";

// D-008: the groups and the Search Series card exactly as OPENBQ_API serves
// "U.S. Bureau of Labor Statistics" (regression run 2). Group 3's default is
// an array, the shape openbb-api emits for an endpoint param.
const series = widget({
  id: "bls_series_bls_obb",
  params: [
    { paramName: "symbol", type: "endpoint" },
    { paramName: "category", type: "text", value: "cpi" },
  ],
});
const app = {
  name: "U.S. Bureau of Labor Statistics",
  tabs: {
    "search-series": {
      name: "Search Series",
      layout: [{
        i: "bls_series_bls_obb", x: 0, y: 2, w: 40, h: 20,
        groups: ["BLS Survey Category", "Group 3"],
        state: { params: { category: "nfp", symbol: ["CES0500000023"] } },
      }],
    },
  },
  groups: [
    { name: "BLS Survey Category", type: "param", paramName: "category", defaultValue: "nfp" },
    { name: "BLS Symbol", type: "endpointParam", paramName: "symbol", defaultValue: "CES0500000023" },
    { name: "Group 3", type: "endpointParam", paramName: "symbol", defaultValue: ["CES0500000023"] },
  ],
};

it("D-008: an array group default imports as its joined value, and the member requests it", () => {
  const d = importApps([structuredClone(app)], [series]).dashboards[0];
  expect(d.groups?.find((g) => g.name === "Group 3")?.value).toBe("CES0500000023");
  const card = d.tabs[0].cards[0];
  expect(effectiveParams(card, d.groups, series, d.groupsDisabled).symbol).toBe("CES0500000023");
});

it("D-008: still drops the unjoined BLS Symbol group", () => {
  const d = importApps([structuredClone(app)], [series]).dashboards[0];
  expect(d.groups?.map((g) => g.name)).toEqual(["BLS Survey Category", "Group 3"]);
});

it("D-008: a default paramString cannot render still imports as empty, without throwing", () => {
  for (const defaultValue of [[], {}, [{ a: 1 }]]) {
    const odd = structuredClone(app);
    odd.groups[2] = { ...odd.groups[2], defaultValue: defaultValue as never };
    const d = importApps([odd], [series]).dashboards[0];
    expect(d.groups?.find((g) => g.name === "Group 3")?.value).toBe("");
  }
});
```

- [ ] **Step 3: Run it and confirm it fails for the right reason**

Run: `pnpm exec vitest run src/lib/appsJson.d008.test.ts`
Expected: test 1 FAILS with `AssertionError: expected '' to be 'CES0500000023'`, and tests 2 and 3 pass. This RED was observed on `3abc906` during planning.

- [ ] **Step 4: Fix** — in `src/lib/appsJson.ts`, replace

```ts
      const defaultValue = typeof rawGroup.defaultValue === "string" ? rawGroup.defaultValue : "";
```
with
```ts
      // openbb-api serves an endpoint param's default as an array
      // (["CES0500000023"]); the group value is the same comma-joined string
      // a card param gets (D-008). Anything paramString cannot render is "".
      const defaultValue = paramString(rawGroup.defaultValue) ?? "";
```

- [ ] **Step 5: Run the test and the owning suite**

Run: `pnpm exec vitest run src/lib/appsJson.d008.test.ts src/lib/appsJson.test.ts src/lib/paramGroups.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
cd "$W3"; test "$(git rev-parse --show-toplevel)" = "$W3" || { echo WRONG CHECKOUT; exit 1; }
git add src/lib/appsJson.ts src/lib/appsJson.d008.test.ts
git commit -m "fix(v3): keep an array group default when importing apps.json (D-008)

OPENBQ_API serves Group 3's default as [\"CES0500000023\"]; the import kept
only string defaults, so the group value became \"\" and its member card
requested symbol=\"\". Join it the way card params are joined (paramString).
Groups no card joins are still dropped, as specified.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: v3 D-002 (browser smoke scoped to this line) and the CI gate

**Files:**
- Modify: `web/browser-smoke.mjs` (whole file, given below)
- Modify: `.github/workflows/ci.yml` (`e2e` job)
- Modify: `web/README.md` (the paragraph that starts "`pnpm test:web:browser` runs a reproducible Playwright smoke test")

**Interfaces:**
- Consumes: the seeded built-ins dashboard in `web/bootstrap.mjs`: a Grouping tab whose two Parameter echo cards share the Ticker group `g1`, value `AAPL`.
- Produces: a passing `pnpm test:web:browser`, which every line's gate script (Task 3) runs after `pnpm build:web`.

- [ ] **Step 1: Confirm the RED**

Run: `cd "$W3" && pnpm build:web && pnpm test:web:browser`
Expected: FAIL with a Playwright timeout waiting for the AAPL cell in the quote card (`.widget-card` with an `Exchange` textbox), as recorded in v6 regression D-002.

- [ ] **Step 2: Replace `web/browser-smoke.mjs` with exactly this content**

```js
/**
 * Real HTTPS/browser auth smoke test. Synthetic identities and quote data only.
 * Requires the web build, Playwright Chromium and openssl; never calls GitHub.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { encode } from "@auth/core/jwt";
import { createPreviewServer } from "./server.mjs";
import { readConfig, SESSION_COOKIE } from "./config.mjs";

const dir = await mkdtemp(join(tmpdir(), "bdobb-browser-"));
let server, browser;
try {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "1",
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
  server = createServer({ key: await readFile(join(dir, "key.pem")), cert: await readFile(join(dir, "cert.pem")) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = `https://localhost:${server.address().port}`;
  const config = readConfig({
    APP_ORIGIN: origin, AUTH_SECRET: randomBytes(32).toString("hex"),
    AUTH_GITHUB_ID: "synthetic-client", AUTH_GITHUB_SECRET: "synthetic-secret",
    SESSION_EPOCH: "browser-test", GITHUB_ALLOWED_USER_IDS: "42",
    BACKEND_GATEWAY_ORIGIN: "https://gateway.example.com",
    BACKEND_GATEWAY_TOKEN: randomBytes(32).toString("base64url"),
  });
  // The gateway's per-user state store, in memory: what the page saves, and is seeded from.
  const saved = new Map();
  const app = createPreviewServer({ config, fetchUpstream: async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/state/")) {
      const name = parsed.pathname.split("/").slice(3).join("/");
      if (!name) return json({ files: Object.fromEntries(saved) });
      if (init.method === "PUT") saved.set(name, init.body.toString()); else saved.delete(name);
      return new Response(null, { status: 204 });
    }
    return new Response("unrouted", { status: 404 });
  } });
  function json(body) {
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  }
  server.on("request", (req, res) => app.emit("request", req, res));
  server.on("upgrade", (req, socket, head) => app.emit("upgrade", req, socket, head));
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
  // A mistaken external request must never reach GitHub or a live provider.
  const external = [];
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(origin);
  assert.equal((await context.request.get(origin + "/api/widgets.json")).status(), 401);
  await page.getByRole("link", { name: "Continue with GitHub" }).click();
  await page.getByRole("button", { name: /Sign in with GitHub/ }).waitFor();
  const value = await encode({
    token: { githubId: "42", epoch: config.epoch, deadline: Date.now() / 1000 + 3600 },
    secret: config.secret, salt: SESSION_COOKIE, maxAge: 3600,
  });
  await context.addCookies([{ name: SESSION_COOKIE, value, domain: "localhost", path: "/",
    secure: true, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(origin);
  // The seed at this line is the built-ins dashboard (web/bootstrap.mjs): no /api
  // card, so the edit-save-reseed round trip runs on the Grouping tab's Parameter
  // echo card (found by its Ticker field: the Note above it names the card in its
  // text), whose Ticker starts at the group's AAPL.
  const grouping = page.getByRole("tab", { name: "Grouping" });
  const echoCard = page.locator(".widget-card")
    .filter({ has: page.getByRole("textbox", { name: "Ticker" }) }).first();
  const echoed = text => echoCard.getByRole("definition").filter({ hasText: new RegExp(`^${text}$`) }).waitFor();
  await grouping.click();
  await echoed("AAPL");
  // The notice bar takes 28px off the top of the page, and the app shell is sized
  // from the VIEWPORT (100dvh), not from #root -- so unless the web build gives
  // those 28px back, the shell runs past the bottom and carries the rail's last
  // bottom-pinned row, Help, below the fold. Found 2026-09-20 ("no help on the app").
  const helpBox = await page.getByRole("button", { name: "Help", exact: true }).boundingBox();
  assert.ok(helpBox && helpBox.y + helpBox.height <= page.viewportSize().height,
    `Help is below the fold: ${JSON.stringify(helpBox)} in ${JSON.stringify(page.viewportSize())}`);
  await echoCard.getByRole("textbox", { name: "Ticker" }).fill("MSFT");
  await echoCard.getByRole("textbox", { name: "Ticker" }).press("Enter");
  await echoed("MSFT");
  // "vercel is not saving the configuration" (2026-09-20): the change is mirrored to the
  // signed-in user's state -- the whole store on this first save, the seeded dashboard included.
  for (let i = 0; i < 50 && !saved.get("dashboards/preview.json")?.includes("MSFT"); i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(saved.get("dashboards/preview.json")?.includes("MSFT"), JSON.stringify([...saved.keys()]));
  assert.ok(saved.has("backends.json"), JSON.stringify([...saved.keys()]));
  // A session that lapses while the app is open (it is a hard one-hour deadline): the next
  // request to this origin answers 401, and the app goes to the sign-in page rather than
  // reporting every backend offline, which is what it did until 2026-09-20.
  const session = await context.cookies();
  await context.clearCookies();
  await echoCard.getByRole("textbox", { name: "Ticker" }).fill("NVDA");
  await echoCard.getByRole("textbox", { name: "Ticker" }).press("Enter");
  await page.waitForURL(/\/auth\/signin/);
  await context.addCookies(session);
  await page.goto(origin);
  await grouping.click();
  await echoed("MSFT");
  assert.ok(!saved.get("dashboards/preview.json").includes("NVDA"));
  await page.getByRole("link", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("link", { name: "Continue with GitHub" }).waitFor();
  assert.equal((await context.cookies()).filter(c => c.name === SESSION_COOKIE).length, 0);
  assert.equal((await context.request.get(origin + "/api/widgets.json")).status(), 401);
  await page.setViewportSize({ width: 375, height: 812 });
  // Runs in the page's browser context, not this Node process: window is a
  // page global there, not a lint violation.
  /* eslint-disable no-undef */
  assert.equal(await page.evaluate(
    () => window.document.documentElement.scrollWidth > window.innerWidth), false);
  /* eslint-enable no-undef */
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log("PASS: HTTPS login form, private assets, seeded built-ins dashboard, per-user state saved + reseeded on reload, lapsed session goes to sign-in, CSRF logout, mobile login; no external requests.");
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(dir, { recursive: true, force: true });
}
```
This is the verified scratch diff `D-002-smoke.diff` (+17/−194) applied to `3abc906`. `git diff --stat` must show `web/browser-smoke.mjs | 213 +++---…` (20 insertions, 195 deletions).

- [ ] **Step 3: Gate it in CI.** In `.github/workflows/ci.yml`, in the `e2e` job, insert between `- run: pnpm exec playwright install --with-deps chromium` and `- run: pnpm e2e`:

```yaml
      # The web preview's real-browser smoke (web/browser-smoke.mjs) serves
      # dist/web, so it runs after build:web. It needs the Chromium installed
      # just above, which the build job does not have.
      - run: pnpm build:web
      - run: pnpm test:web:browser
```

- [ ] **Step 4: Correct `web/README.md`.** Replace the whole paragraph that begins "`pnpm test:web:browser` runs a reproducible Playwright smoke test" with:

```md
`pnpm test:web:browser` runs a reproducible Playwright smoke test against a real loopback HTTPS server with a synthetic session and an in-memory per-user state store. It verifies the sign-in form, denied anonymous metadata, the seeded built-ins dashboard (the Grouping tab's Parameter echo card: AAPL edited to MSFT, saved to the user's state and reseeded after a reload), a lapsed session sending the next edit to sign-in, CSRF sign-out clearing the cookie and returning to login, and mobile login width. It blocks external requests, so it does not complete a real GitHub OAuth exchange. Run `pnpm build:web` first and install Playwright Chromium. CI runs it in the `e2e` job after `pnpm build:web`.
```

- [ ] **Step 5: Run the smoke and the web unit tests**

Run: `pnpm build:web && pnpm test:web:browser && pnpm test:web && pnpm lint`
Expected: `PASS: HTTPS login form, … no external requests.`, then `test:web` with 31 pass, then lint exit 0.

- [ ] **Step 6: Commit**

```bash
cd "$W3"; test "$(git rev-parse --show-toplevel)" = "$W3" || { echo WRONG CHECKOUT; exit 1; }
git add web/browser-smoke.mjs web/README.md .github/workflows/ci.yml
git commit -m "test(v3): scope the web browser smoke to this line's seed; gate it in CI (D-002)

The smoke waited for a Quote card, grid sockets, feeds and a Rita route this
line's seeded dashboard and server never had. It now runs the edit-save-reseed
round trip on the Grouping tab's Parameter echo card and keeps the auth, lapse,
logout, mobile and no-external-request checks. CI's e2e job runs it after
build:web.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: v3 requalification, the tip-merge check and receipts

**Files:**
- Create: `docs/releases/validation/v3-repair/fixbatch-2026-10-08/run-gates.sh`
- Create: `docs/releases/validation/v3-repair/fixbatch-2026-10-08/README.md` plus the gate logs, `gates.tsv`, `head.txt` and `tip-merge-web-browser.log`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `run-gates.sh [OUTDIR]`. It runs from the repo root, writes one `<gate>.log` per gate plus `gates.tsv` and `head.txt` to `OUTDIR` (default: its own directory), and Tasks 6, 9 and 12 call the same file. After the merge it lives at the same path in v4, v5 and v6.

- [ ] **Step 1: Write the gate script** `docs/releases/validation/v3-repair/fixbatch-2026-10-08/run-gates.sh`

```bash
#!/bin/bash
# Fix batch 2026-10-08: runs every declared gate at HEAD, one log per gate plus
# gates.tsv (name|exit|duration|load|command). Run from the repository root.
# Usage: run-gates.sh [OUTDIR]   (default: this script's directory)
set -u
O=${1:-$(cd "$(dirname "$0")" && pwd)}
mkdir -p "$O"
git rev-parse HEAD > "$O/head.txt"
: > "$O/gates.tsv"
run(){ n=$1; shift; s=$(date +%s); l=$(uptime | sed 's/.*averages: //'); "$@" > "$O/$n.log" 2>&1; e=$?; echo "$n|exit=$e|dur=$(( $(date +%s)-s ))s|load=$l|cmd=$*" >> "$O/gates.tsv"; }
run typecheck pnpm typecheck
run lint pnpm lint
run unit pnpm exec vitest run --maxWorkers=2 --minWorkers=1 --testTimeout=60000
run build pnpm build
run e2e env BDOBB_BROWSER_PORT="${BDOBB_BROWSER_PORT:-4383}" BDOBB_MOCK_PORT="${BDOBB_MOCK_PORT:-4384}" pnpm e2e
run web pnpm test:web
run build-web pnpm build:web
run web-browser pnpm test:web:browser
run cargo cargo check --manifest-path src-tauri/Cargo.toml --locked --offline -j 2
run scrub pnpm scrub
run help pnpm exec vitest run src/help scripts/help-shots.test.mjs --maxWorkers=2 --minWorkers=1 --testTimeout=60000
echo DONE >> "$O/gates.tsv"
```

- [ ] **Step 2: Run the gates** (check `uptime` first; under very high load expect unit and e2e reruns)

```bash
cd "$W3"; G=docs/releases/validation/v3-repair/fixbatch-2026-10-08
chmod +x $G/run-gates.sh && bash $G/run-gates.sh
cat $G/gates.tsv
```
Expected: every line `exit=0`. For a non-zero gate, rerun only that gate's failing file with the same flags and save the result as `<gate>-rerun-<n>.log`. Never edit the original log. Then record the pass as COMPOSITE EVIDENCE in the README. A failure that reproduces on rerun is a real defect: stop and report it.

- [ ] **Step 3: Tip-merge check (proves decision 2; the tip seed differs in `src/lib/bootstrap.ts`)**

```bash
SCR=<session scratchpad>/v3-tip-check
TIP=$(git -C "$V3R" rev-parse codex/clean-v3-repair)
git -C "$V3R" worktree add --detach "$SCR" "$TIP"
cd "$SCR"
git diff --quiet 3abc906 "$TIP" -- package.json pnpm-lock.yaml && ln -s "$W3/node_modules" node_modules || pnpm install --frozen-lockfile --prefer-offline
git merge --no-edit claude/clean-v3-fixbatch; echo "merge $?"
{ echo "tip $TIP merged with $(git -C "$W3" rev-parse HEAD)"; pnpm build:web && pnpm test:web:browser; echo "exit $?"; } > "$W3/docs/releases/validation/v3-repair/fixbatch-2026-10-08/tip-merge-web-browser.log" 2>&1
pnpm exec vitest run src/lib/appsJson.d008.test.ts src/components/DashboardGrid.layout.test.tsx >> "$W3/docs/releases/validation/v3-repair/fixbatch-2026-10-08/tip-merge-web-browser.log" 2>&1
cd "$W3"; git -C "$V3R" worktree remove --force "$SCR"; git -C "$V3R" worktree prune
```
Expected: `merge 0`, the smoke `PASS: …`, `exit 0`, and both vitest files pass. The merge commit lives only on that detached worktree and is discarded with it. If the merge conflicts or the smoke fails at the tip, record that in the README as the finding for the other workstream. Do not change the fix branch to suit the tip.

- [ ] **Step 4: Sanitise and check the receipts**

```bash
G=docs/releases/validation/v3-repair/fixbatch-2026-10-08
LC_ALL=C sed -i '' "s#$HOME#<home>#g" $G/*.log
! grep -rnE '\.ts\.net|tskey-|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]+\.[0-9]+' $G || { echo "tailnet data in receipts"; exit 1; }
```

- [ ] **Step 5: Write `README.md`** for the receipts. Fill every angle-bracket field and the table from `gates.tsv` and the logs:

```md
# v3 fix batch 2026-10-08 — receipts

Branch `claude/clean-v3-fixbatch` (worktree `bdobb-clean-v3-fixbatch`), base `3abc906` (D-005). HEAD: see `head.txt`.
Fixes: D-005 `3abc906` (no automatic grid compaction), D-008 (array group default joined), D-002 (browser smoke scoped to this line's seed; `test:web:browser` in CI after `build:web`).

| Gate | Result | Notes |
|---|---|---|
| typecheck … help | from gates.tsv | unit: files/tests/skips; e2e: passed/failed/skipped; any rerun named, "COMPOSITE EVIDENCE" if used |

Tip-merge check (`tip-merge-web-browser.log`): `codex/clean-v3-repair` at <TIP> merged with this branch: <clean | conflicts in …>; smoke <PASS | FAIL …>.

Delivery: these commits are NOT on `codex/clean-v3-repair`. That branch has diverged (Workspace connection programme) and its checkout holds another workstream's uncommitted edits. That workstream merges `claude/clean-v3-fixbatch` when ready. v4, v5 and v6 take this branch by merge (`refs/integration/v3-fixbatch-2026-10-08`). No tag moved.
```

- [ ] **Step 6: Commit**

```bash
cd "$W3"; test "$(git rev-parse --show-toplevel)" = "$W3" || { echo WRONG CHECKOUT; exit 1; }
git add docs/releases/validation/v3-repair/fixbatch-2026-10-08
git commit -m "chore(v3): fix-batch 2026-10-08 gate receipts and tip-merge check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: v4 merge of the v3 fix branch

**Files:**
- Merge: `refs/integration/v3-fixbatch-2026-10-08` into `codex/clean-v4-integration`
- Conflict: `src/components/DashboardGrid.tsx`

**Interfaces:**
- Consumes: `claude/clean-v3-fixbatch` HEAD from Task 3.
- Produces: v4 with `compactType={null}`, the D-008 fix, the D-002 smoke, the CI gate and `run-gates.sh` at `docs/releases/validation/v3-repair/fixbatch-2026-10-08/run-gates.sh`.

- [ ] **Step 1: Preflight and fetch**

```bash
W4=~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v4-integration
cd "$W4"; git status --short   # must be empty; stop and ask otherwise
git rev-parse HEAD             # expect d3337532d7938193f258fd945425d6f633bab1c5, or ask
git fetch "$W3" claude/clean-v3-fixbatch:refs/integration/v3-fixbatch-2026-10-08
git log --oneline HEAD..refs/integration/v3-fixbatch-2026-10-08   # expect exactly: receipts, D-002, D-008, 3abc906
```

- [ ] **Step 2: Merge**

```bash
git merge --no-ff refs/integration/v3-fixbatch-2026-10-08
```
Expected: `CONFLICT (content): Merge conflict in src/components/DashboardGrid.tsx`, with appsJson.ts and browser-smoke.mjs auto-merged. Any other conflict means this plan's dry-run no longer holds: stop and ask.

- [ ] **Step 3: Resolve by keeping both hunks.** The conflicted region sits inside `<GridLayout …>`, after `rowHeight={GRID_ROW_HEIGHT}`. The result must read:

```tsx
        rowHeight={GRID_ROW_HEIGHT}
        // The gap between cards, x and y alike (D1/D2). react-grid-layout's
        // own default is [10, 10], which is also this setting's default, so
        // an untouched install is spaced exactly as it was before. The
        // maximized card is `position: fixed` and so unaffected.
        margin={[widgetGap, widgetGap]}
        // Pinned, and NOT derived from widgetGap: react-grid-layout defaults
        // `containerPadding` to whatever `margin` is
        // (`containerPadding || margin`, ReactGridLayout.js), so leaving it
        // unset would make the slider silently move the grid's OUTER inset
        // too -- the first card would jump from 10px off the container edge
        // to 25px. [10, 10] is the effective value today (the library's
        // default margin), so this keeps the outer padding exactly as it has
        // always been while the slider changes only the gap between cards.
        containerPadding={[10, 10]}
        // No automatic compaction: an imported app's coordinates are the
        // layout (the reference apps reserve rows 0-1), and vertical
        // compaction pulled every card up on first display and then wrote
        // that back through onLayoutChange (bdobb#6). Collisions during a
        // drag still push the other card down.
        compactType={null}
        // react-grid-layout 1.5's own gates: per item it computes
```
Then: `grep -c '<<<<<<<\|>>>>>>>' src/components/DashboardGrid.tsx` must print `0`.

- [ ] **Step 4: Run the carried tests on this line** (planning ran the same files on a merged v6 tree: all passed)

Run: `pnpm exec vitest run src/components/DashboardGrid.layout.test.tsx src/components/DashboardGrid.test.tsx src/lib/appsJson.d008.test.ts src/lib/appsJson.test.ts && pnpm typecheck && pnpm lint`
Expected: all PASS, exit 0.

- [ ] **Step 5: Commit the merge**

```bash
cd "$W4"; test "$(git rev-parse --show-toplevel)" = "$W4" || { echo WRONG CHECKOUT; exit 1; }
git add src/components/DashboardGrid.tsx
git commit --no-edit
git commit --amend -m "Merge commit 'refs/integration/v3-fixbatch-2026-10-08' into codex/clean-v4-integration

Carries v3 D-005 (3abc906), D-008 and D-002 plus the CI browser-smoke gate.
DashboardGrid.tsx: kept this line's margin/containerPadding and v3's
compactType={null} side by side.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1; git rev-parse HEAD^2   # HEAD^2 must equal the fetched v3 HEAD
```

---

### Task 5: v4 D-007 (curated pivot-v1 on backend tables)

**Files:**
- Create: `src/lib/appsJson.d007.test.ts`
- Modify: `src/lib/appsExtensionsV4.ts:9` (drop the import), `:157`
- Modify: `src/lib/appsJson.cleanV4.test.ts:46-49` (user-approved assertion change)
- Modify: `docs/releases/provenance.md:74`, `docs/reference-manual/v4/README.md:39`; append to `docs/releases/v4-integration.md`

**Interfaces:**
- Consumes: `importApps`, `exportCompatibleApp` from `./appsJson`; `isWorkerTableProducer(card)` from `./tableExecution/eligibility`; `pivotTable({ rows, columns, kinds, order, config, sorting })` from `./pivotTable`; `tableColumns(rows, spec)` from `./tableColumns`.
- Produces: an imported curated overlay lands at `card.table.pivot` (a `PivotConfig`), and `card.tableDefinition` is left unset.

- [ ] **Step 1: Write the failing tests** `src/lib/appsJson.d007.test.ts`

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

// D-007: curated pivot-v1 overlays on BACKEND tables must land where
// TableRenderer reads them (card.table.pivot), not in a worker-only
// tableDefinition.analytical that a backend card never executes.
import { expect, it } from 'vitest';
import { exportCompatibleApp, importApps } from './appsJson';
import { isWorkerTableProducer } from './tableExecution/eligibility';

// Verbatim tabs from REFERENCE_CURATED "Episode 3 — Pivot examples" (sha-1978c19).
const overlay = (pivot: object) => ({ bdobb: { version: 1, profile: 'pivot-v1', pivot } });
const item = (i: string, pivot: object) => ({ i, x: 0, y: 0, w: 20, h: 10, state: { params: {} }, extensions: overlay(pivot) });
const app = { name: 'Episode 3 — Pivot examples', tabs: {
  'monthly-ohlc': { name: 'Monthly OHLC', layout: [item('openbq_demo_prices', { enabled: true, grouping: ['asset', 'date'], split: [], buckets: { date: 'month' }, aggregationFns: { open: 'first', high: 'max', low: 'min', close: 'last', volume: 'sum' } })] },
  'cross-tab': { name: 'Asset cross-tab', layout: [item('openbq_demo_prices', { enabled: true, grouping: ['date'], split: ['asset'], buckets: { date: 'month' }, aggregationFns: { volume: 'sum', close: 'mean' } })] },
  'mean-count': { name: 'Mean and Count', layout: [item('openbq_demo_prices', { enabled: true, grouping: ['asset'], split: [], measures: [{ id: 'mean', sourceFieldId: 'volume', aggregation: 'mean' }, { id: 'count', sourceFieldId: 'volume', aggregation: 'count' }] })] },
  'null-handling': { name: 'Null handling', layout: [item('openbq_demo_nulls', { enabled: true, grouping: ['asset'], split: [], measures: [{ id: 'mean', sourceFieldId: 'value', aggregation: 'mean' }, { id: 'count', sourceFieldId: 'value', aggregation: 'count' }, { id: 'sum', sourceFieldId: 'value', aggregation: 'sum' }] })] },
} };

it('D-007: curated pivot-v1 on a backend table imports as the in-thread pivot TableRenderer applies', () => {
  const dashboard = importApps([structuredClone(app)], []).dashboards[0];
  for (const [index, tab] of dashboard.tabs.entries()) {
    const card = tab.cards[0];
    const source = Object.values(app.tabs)[index].layout[0].extensions.bdobb.pivot;
    expect(isWorkerTableProducer(card)).toBe(false); // backend table: TableRenderer, never the worker
    expect(card.table?.pivot, tab.name).toEqual(source);
    expect(card.tableDefinition?.analytical, tab.name).toBeUndefined();
  }
});

it('D-007: the imported recipes pivot in-thread through pivotTable', async () => {
  const { pivotTable } = await import('./pivotTable');
  const { tableColumns } = await import('./tableColumns');
  const rows = [
    { asset: 'A', date: '2024-01-02', open: 1, high: 3, low: 1, close: 2, volume: 10, value: 1 },
    { asset: 'A', date: '2024-01-03', open: 2, high: 4, low: 2, close: 3, volume: 20, value: null },
    { asset: 'B', date: '2024-02-01', open: 5, high: 6, low: 4, close: 5, volume: 30, value: 3 },
  ];
  const columns = tableColumns(rows, undefined);
  const kinds = new Map<string, 'text' | 'date' | 'number'>([['asset', 'text'], ['date', 'date'], ...['open', 'high', 'low', 'close', 'volume', 'value'].map(f => [f, 'number'] as [string, 'number'])]);
  for (const tab of importApps([structuredClone(app)], []).dashboards[0].tabs) {
    const result = pivotTable({ rows, columns, kinds, order: columns.map(c => c.field), config: tab.cards[0].table!.pivot!, sorting: [] });
    expect(result?.ok, tab.name).toBe(true);
  }
});

it('D-007: the imported pivots survive a compatible export and re-import', () => {
  const dashboard = importApps([structuredClone(app)], []).dashboards[0];
  const exported = exportCompatibleApp(dashboard);
  if (!exported.ok) throw new Error(exported.issue.message);
  const again = importApps([exported.value], []).dashboards[0];
  expect(again.tabs.map((t) => t.cards[0].table?.pivot)).toEqual(dashboard.tabs.map((t) => t.cards[0].table?.pivot));
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm exec vitest run src/lib/appsJson.d007.test.ts`
Expected: test 1 FAILS (`card.table?.pivot` is `undefined`; `analytical` is set), and test 2 fails with a TypeError on `table!.pivot!`.

- [ ] **Step 3: Fix** `src/lib/appsExtensionsV4.ts`. Delete line 9, `import { migratePivot } from './tableModel/migration';` (its only use is the line below). Replace line 157:

```ts
      legacySlots.push({ tab, index, extras: { tableDefinition: { table: {}, search: '', analytical: migratePivot(recipe) } } });
```
with
```ts
      // The overlay belongs to a backend table, which TableRenderer pivots
      // in-thread from card.table.pivot; a worker analytical definition would
      // never run there (D-007, user ruling 2026-10-08: backend tables stay
      // off the client worker until server execution).
      legacySlots.push({ tab, index, extras: { pivot: recipe } });
```

- [ ] **Step 4: Rewrite the assertion that pinned the defect (user-approved 2026-10-08).** In `src/lib/appsJson.cleanV4.test.ts`, replace the whole test `it('reference pivot-v1 layout overlays become editable analytical definitions in v4', …)` (lines 46–49) with:

```ts
it('reference pivot-v1 layout overlays import as the in-thread pivot their backend table runs (D-007)', () => {
  // User-approved assertion change 2026-10-08 (D-007): this asserted a worker
  // tableDefinition.analytical, which a backend table never executes.
  const imported = importApps([{ name: 'Reference', tabs: { t: { name: 'T', layout: [{ i: 'prices', x: 0, y: 0, w: 10, h: 8, extensions: { bdobb: { version: 1, profile: 'pivot-v1', pivot: { enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'sum' } } } } }] } } }], []).dashboards[0];
  expect(imported.tabs[0].cards[0].table?.pivot).toEqual({ enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'sum' } });
  expect(imported.tabs[0].cards[0].tableDefinition?.analytical).toBeUndefined();
});
```

- [ ] **Step 5: Run GREEN and the owning suites**

Run: `pnpm exec vitest run src/lib/appsJson.d007.test.ts src/lib/appsJson.cleanV4.test.ts src/lib/appsJson.test.ts src/lib/appsExtensionsV4 src/lib/tableModel && pnpm typecheck && pnpm lint`
Expected: all PASS (planning observed d007 3/3 and cleanV4 8/8 on a merged v6 tree). If `appsExtensionsV4` matches no test file, vitest reports it as a filter with no match and the rest still runs.

- [ ] **Step 6: Correct the ruling and the docs.**
  - `docs/releases/provenance.md:74`: replace the line `- Local curated reference pivot-v1 layout overlays migrate to worker analytical definitions in v4. Clean v3 remains a no-write refusal for the same source.` with:
    ```md
    - ~~Local curated reference pivot-v1 layout overlays migrate to worker analytical definitions in v4.~~ Corrected 2026-10-08 (user-approved, D-007): those overlays sit on backend tables, which never run on the client worker, so the analytical definition was never executed. They now import as the table's own Pivot (`card.table.pivot`), which TableRenderer applies; backend tables stay off the worker until server execution. Clean v3 remains a no-write refusal for the same source.
    ```
  - `docs/reference-manual/v4/README.md:39`: replace the sentence `The curated reference's supported \`pivot-v1\` layout overlay migrates to an editable v4 analytical definition.` with `The curated reference's supported \`pivot-v1\` layout overlay imports as the table's own Pivot settings, applied by the table itself; backend tables do not run on the in-app table worker.`
  - Append to `docs/releases/v4-integration.md`:
    ```md

    ## Fix batch 2026-10-08 (user-approved)

    - Carried by merge from v3 `claude/clean-v3-fixbatch` (`refs/integration/v3-fixbatch-2026-10-08`): D-005 `3abc906` (no automatic grid compaction; the DashboardGrid conflict with this line's `margin`/`containerPadding` resolved by keeping both), D-008 (array group default joined) and D-002 (browser smoke scoped to the built-ins seed; `test:web:browser` in CI after `build:web`).
    - D-007 (home v4): curated `pivot-v1` layout overlays on backend tables import as `card.table.pivot`, which TableRenderer applies, instead of a worker-only `tableDefinition.analytical`. Backend tables stay off the client worker (user ruling: SSRM/server execution later). Reverses the provenance.md ruling, corrected there with a dated note.
    - USER-APPROVED ASSERTION CHANGE (2026-10-08): `src/lib/appsJson.cleanV4.test.ts` "reference pivot-v1 layout overlays become editable analytical definitions in v4" asserted `tableDefinition.analytical`. Renamed "…import as the in-thread pivot their backend table runs (D-007)", it now asserts `table.pivot` equals the source recipe and `analytical` is undefined. The old expectation was the defect.
    - Receipts: [validation/v4-integration/fixbatch-2026-10-08](validation/v4-integration/fixbatch-2026-10-08/).
    ```

- [ ] **Step 7: Commit**

```bash
cd "$W4"; test "$(git rev-parse --show-toplevel)" = "$W4" || { echo WRONG CHECKOUT; exit 1; }
git add src/lib/appsExtensionsV4.ts src/lib/appsJson.d007.test.ts src/lib/appsJson.cleanV4.test.ts docs/releases/provenance.md docs/releases/v4-integration.md docs/reference-manual/v4/README.md
git commit -m "fix(v4): import curated pivot-v1 overlays as the backend table's own pivot (D-007)

Backend tables render through TableRenderer, which applies card.table.pivot;
the worker-only tableDefinition.analytical the import wrote never ran, so all
four Episode 3 tabs showed raw rows. Backend tables stay off the worker.
User-approved assertion change in appsJson.cleanV4.test.ts, logged in
v4-integration.md; provenance ruling corrected with a dated note.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: v4 requalification

**Files:**
- Create: `docs/releases/validation/v4-integration/fixbatch-2026-10-08/{README.md,*.log,gates.tsv,head.txt}`

**Interfaces:**
- Consumes: `docs/releases/validation/v3-repair/fixbatch-2026-10-08/run-gates.sh` (carried by Task 4).

- [ ] **Step 1: Run the gates**

```bash
cd "$W4"; G=docs/releases/validation/v4-integration/fixbatch-2026-10-08
bash docs/releases/validation/v3-repair/fixbatch-2026-10-08/run-gates.sh $G; cat $G/gates.tsv
```
Expected: every gate `exit=0`. Handle reruns as in Task 3 Step 2 (COMPOSITE EVIDENCE, original logs kept).

- [ ] **Step 2: Sanitise and check**

```bash
G=docs/releases/validation/v4-integration/fixbatch-2026-10-08
LC_ALL=C sed -i '' "s#$HOME#<home>#g" $G/*.log
! grep -rnE '\.ts\.net|tskey-|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]+\.[0-9]+' $G || { echo "tailnet data in receipts"; exit 1; }
```

- [ ] **Step 3: Write `README.md`.** Use the same shape as Task 3 Step 5, titled "v4 fix batch 2026-10-08 — receipts". Name the merge commit (the D-007 commit's parent), the D-007 commit and the gate table. Add the line: "USER-APPROVED ASSERTION CHANGE: appsJson.cleanV4.test.ts pivot-v1 test now asserts `table.pivot` (D-007; see v4-integration.md)."

- [ ] **Step 4: Commit**

```bash
cd "$W4"; test "$(git rev-parse --show-toplevel)" = "$W4" || { echo WRONG CHECKOUT; exit 1; }
git add docs/releases/validation/v4-integration/fixbatch-2026-10-08
git commit -m "chore(v4): fix-batch 2026-10-08 gate receipts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: v5 merge of v4

**Files:**
- Merge: `codex/clean-v4-integration` into `codex/clean-v5-reconciled`

- [ ] **Step 1: Preflight and merge**

```bash
W5=~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v5-reconciled
cd "$W5"; git status --short   # must be empty
git rev-parse HEAD             # expect 89889791bad5b44c857f3efe4b528231dd299560, or ask
git merge --no-ff codex/clean-v4-integration
```
Expected: a clean merge. At planning time, v4 and v5 had byte-identical `DashboardGrid.tsx` conflict regions, `appsExtensionsV4.ts`, `appsJson.cleanV4.test.ts`, `v4-integration.md` and `web/`. If a file conflicts, resolve it by keeping both sides' intent and name every resolution in the merge message. A conflict in a test assertion is a stop-and-ask.

- [ ] **Step 2: Run the carried tests**

Run: `pnpm exec vitest run src/components/DashboardGrid.layout.test.tsx src/components/DashboardGrid.test.tsx src/lib/appsJson.d008.test.ts src/lib/appsJson.d007.test.ts src/lib/appsJson.cleanV4.test.ts && pnpm typecheck && pnpm lint`
Expected: all PASS.

- [ ] **Step 3: Commit (if the merge stopped for a resolution) or amend the message**

```bash
cd "$W5"; test "$(git rev-parse --show-toplevel)" = "$W5" || { echo WRONG CHECKOUT; exit 1; }
git commit --amend -m "Merge branch 'codex/clean-v4-integration' into codex/clean-v5-reconciled

Carries the 2026-10-08 fix batch: v3 D-005/D-008/D-002 and v4 D-007.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: v5 Window ▸ Keep Sidebar Open

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src/hooks/useWindowMenuPins.ts`, `src/hooks/useWindowMenuPins.test.tsx`, `src/help/windowMenu.test.ts`
- Modify: `src/browser-shim/core.ts`, `src/browser-shim/shims.test.ts`, `src/App.tsx`
- Modify: `src/help/topics/keyboard-shortcuts.md`, `src/help/guide/keyboard-shortcuts.md`, `src/help/topics/workspaces.md`, `src/help/guide/workspaces.md`

**Interfaces:**
- Consumes: `useWorkspacesStore` (`activeWorkspace(): Workspace | undefined`, `setRailsOpen(id: string, left: boolean): Promise<void>`, `subscribe`), `Workspace.railsOpen?: { left: boolean }`, `invoke` and `isTauri` from `@tauri-apps/api/core`, `listen` from `@tauri-apps/api/event`, and `logError` from `../lib/logger`.
- Produces:
  - Rust: menu item id `window-keep-sidebar-open`, event `menu://toggle-sidebar-pin`, and command `set_window_pin(id: String, checked: bool, enabled: bool) -> Result<(), String>`.
  - TS: `SIDEBAR_PIN = { id: "window-keep-sidebar-open", event: "menu://toggle-sidebar-pin" }`, a private `bindPin(pin, read, subscribe, toggle): () => void`, and `useWindowMenuPins(enabled: boolean): void`. Task 11 extends these.

- [ ] **Step 1: Write the failing hook tests** `src/hooks/useWindowMenuPins.test.tsx`

```tsx
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  native: true,
  invoke: vi.fn(async (_cmd: string, _args?: unknown) => undefined),
  handlers: new Map<string, () => void>(),
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => tauri.native,
  invoke: tauri.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (event: string, handler: () => void) => {
    tauri.handlers.set(event, handler);
    return () => tauri.handlers.delete(event);
  },
}));

import { __resetLoggerForTests } from "../lib/logger";
import type { Workspace } from "../lib/workspacesFile";
import { useWorkspacesStore } from "../stores/workspacesStore";
import { SIDEBAR_PIN, useWindowMenuPins } from "./useWindowMenuPins";

const workspace = (id: string, left: boolean): Workspace => ({ id, name: id, preset: "full-screen", slots: [], railsOpen: { left } });
/** What the menu item shows now: the last set_window_pin for that id. */
const sentFor = (id: string) =>
  tauri.invoke.mock.calls.map((call) => call[1] as { id: string } | undefined).filter((sent) => sent?.id === id).at(-1);
const chooseMenuItem = (event: string) => act(async () => { tauri.handlers.get(event)!(); });

let failWrite = false;
beforeEach(() => {
  __resetLoggerForTests();
  tauri.native = true;
  tauri.invoke.mockClear();
  tauri.handlers.clear();
  failWrite = false;
  useWorkspacesStore.setState({
    workspaces: [workspace("w1", false), workspace("w2", true)],
    activeWorkspaceId: null,
    // The real setRailsOpen also writes workspaces/<id>.json; the store change is what the menu follows.
    setRailsOpen: vi.fn(async (id: string, left: boolean) => {
      if (failWrite) throw new Error("disk full");
      useWorkspacesStore.setState((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, railsOpen: { left } } : w)) }));
    }),
  });
});

it("is disabled and unchecked outside a workspace, and follows the active workspace's pin", () => {
  renderHook(() => useWindowMenuPins(true));
  expect(sentFor(SIDEBAR_PIN.id)).toEqual({ id: SIDEBAR_PIN.id, checked: false, enabled: false });
  act(() => useWorkspacesStore.setState({ activeWorkspaceId: "w2" }));
  expect(sentFor(SIDEBAR_PIN.id)).toEqual({ id: SIDEBAR_PIN.id, checked: true, enabled: true });
  act(() => useWorkspacesStore.setState({ activeWorkspaceId: "w1" }));
  expect(sentFor(SIDEBAR_PIN.id)).toEqual({ id: SIDEBAR_PIN.id, checked: false, enabled: true });
  act(() => useWorkspacesStore.setState({ activeWorkspaceId: null }));
  expect(sentFor(SIDEBAR_PIN.id)).toEqual({ id: SIDEBAR_PIN.id, checked: false, enabled: false });
});

it("choosing the item toggles the active workspace's pin once and checks it", async () => {
  useWorkspacesStore.setState({ activeWorkspaceId: "w1" });
  renderHook(() => useWindowMenuPins(true));
  await waitFor(() => expect(tauri.handlers.has(SIDEBAR_PIN.event)).toBe(true));
  await chooseMenuItem(SIDEBAR_PIN.event);
  await waitFor(() => expect(useWorkspacesStore.getState().setRailsOpen).toHaveBeenCalledWith("w1", true));
  expect(useWorkspacesStore.getState().setRailsOpen).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(sentFor(SIDEBAR_PIN.id)).toEqual({ id: SIDEBAR_PIN.id, checked: true, enabled: true }));
});

it("follows a pin changed by the rail's own button", () => {
  useWorkspacesStore.setState({ activeWorkspaceId: "w1" });
  renderHook(() => useWindowMenuPins(true));
  act(() => void useWorkspacesStore.getState().setRailsOpen("w1", true));
  expect(sentFor(SIDEBAR_PIN.id)).toEqual({ id: SIDEBAR_PIN.id, checked: true, enabled: true });
});

it("a pin write that fails puts the checkmark back", async () => {
  useWorkspacesStore.setState({ activeWorkspaceId: "w1" });
  renderHook(() => useWindowMenuPins(true));
  await waitFor(() => expect(tauri.handlers.has(SIDEBAR_PIN.event)).toBe(true));
  failWrite = true;
  tauri.invoke.mockClear();
  await chooseMenuItem(SIDEBAR_PIN.event);
  // macOS already flipped the native checkmark on the click; the stored pin is still false.
  await waitFor(() => expect(sentFor(SIDEBAR_PIN.id)).toEqual({ id: SIDEBAR_PIN.id, checked: false, enabled: true }));
});

it("choosing the item outside a workspace writes nothing", async () => {
  renderHook(() => useWindowMenuPins(true));
  await waitFor(() => expect(tauri.handlers.has(SIDEBAR_PIN.event)).toBe(true));
  await chooseMenuItem(SIDEBAR_PIN.event);
  expect(useWorkspacesStore.getState().setRailsOpen).not.toHaveBeenCalled();
});

it("does nothing in the browser build or in a viewer window", async () => {
  tauri.native = false;
  renderHook(() => useWindowMenuPins(true));
  tauri.native = true;
  renderHook(() => useWindowMenuPins(false));
  await act(async () => {});
  expect(tauri.invoke).not.toHaveBeenCalled();
  expect(tauri.handlers.size).toBe(0);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm exec vitest run src/hooks/useWindowMenuPins.test.tsx`
Expected: FAIL with `Failed to resolve import "./useWindowMenuPins"`.

- [ ] **Step 3: Implement** `src/hooks/useWindowMenuPins.ts`

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { logError } from "../lib/logger";
import { useWorkspacesStore } from "../stores/workspacesStore";

/**
 * The desktop app's Window-menu pins. Each id and event is kept in sync by
 * hand with KEEP_*_ID / KEEP_*_EVENT in src-tauri/src/lib.rs -- a bare string
 * has no shared type across the two sides.
 */
export const SIDEBAR_PIN = { id: "window-keep-sidebar-open", event: "menu://toggle-sidebar-pin" } as const;

type PinState = { checked: boolean; enabled: boolean };

/** The ACTIVE workspace's rail pin. Outside a workspace there is nothing to pin. */
function sidebarPin(): PinState {
  const workspace = useWorkspacesStore.getState().activeWorkspace();
  return { checked: workspace?.railsOpen?.left ?? false, enabled: workspace !== undefined };
}

/** What the rail's "Pin the rail open" button does (LeftRail.tsx). */
async function toggleSidebarPin(): Promise<void> {
  const workspace = useWorkspacesStore.getState().activeWorkspace();
  if (!workspace) return;
  await useWorkspacesStore.getState().setRailsOpen(workspace.id, !(workspace.railsOpen?.left ?? false));
}

/**
 * Keeps one native check item equal to `read()` whenever `subscribe` reports
 * a change, from any source, and runs `toggle` when the item is chosen. The
 * state is re-sent after every toggle, success or not: macOS flips the
 * checkmark itself on the click, so a write that fails must put it back.
 */
function bindPin(
  pin: { id: string; event: string },
  read: () => PinState,
  subscribe: (listener: () => void) => () => void,
  toggle: () => unknown,
): () => void {
  let sent = "";
  const push = (force = false) => {
    const state = read();
    const key = JSON.stringify(state);
    if (key === sent && !force) return;
    sent = key;
    void invoke("set_window_pin", { id: pin.id, ...state }).catch((err) =>
      logError(`failed to update the Window menu: ${err}`),
    );
  };
  push();
  const unsubscribe = subscribe(() => push());
  const listening = listen(pin.event, () => {
    void Promise.resolve()
      .then(toggle)
      .catch((err) => logError(`failed to toggle ${pin.id}: ${err}`))
      .finally(() => push(true));
  }).catch((err) => {
    void logError(`failed to subscribe to ${pin.event}: ${err}`);
    return null;
  });
  return () => {
    unsubscribe();
    void listening.then((unlisten) => unlisten?.());
  };
}

/**
 * Binds the Window menu's pins to the stores. `enabled` is false in a viewer
 * window, which has no rail and no Rita pane; the browser build has no
 * native menu, so the hook is inert there too.
 */
export function useWindowMenuPins(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !isTauri()) return;
    return bindPin(SIDEBAR_PIN, sidebarPin, useWorkspacesStore.subscribe, toggleSidebarPin);
  }, [enabled]);
}
```

- [ ] **Step 4: Run GREEN**

Run: `pnpm exec vitest run src/hooks/useWindowMenuPins.test.tsx`
Expected: 6/6 PASS.

- [ ] **Step 5: Add `isTauri` to the browser shim (RED, then GREEN).** In `src/browser-shim/shims.test.ts`, inside `describe("core shim", …)`, add:

```ts
  it("reports that it is not the native app, so native-only paths stay off", async () => {
    const { isTauri } = await import("./core");
    expect(isTauri()).toBe(false);
  });
```
Run `pnpm exec vitest run src/browser-shim/shims.test.ts`. It FAILS with `isTauri is not a function`. Then append to `src/browser-shim/core.ts`:

```ts

/** The browser build is never the native app (useWindowMenuPins, useDashboardShortcuts). */
export function isTauri(): boolean {
  return false;
}
```
Re-run: PASS.

- [ ] **Step 6: Mount the hook in `src/App.tsx`.** Add `import { useWindowMenuPins } from "./hooks/useWindowMenuPins";` beside the `useDashboardShortcuts` import. Directly after the `useDashboardShortcuts(…);` statement (~:308-312), add:

```tsx
  // Window ▸ Keep Sidebar Open: main window only (a viewer has no rail).
  useWindowMenuPins(viewerId === null);
```
Run: `pnpm exec vitest run src/App.test.tsx src/hooks && pnpm typecheck`. Expected: PASS (jsdom has no `isTauri`, so the hook is inert).

- [ ] **Step 7: Native side** `src-tauri/src/lib.rs`
  - Below `NEW_WORKSPACE_MENU_EVENT`, add:
    ```rust
    // Window ▸ Keep Sidebar Open. Kept in sync by hand with SIDEBAR_PIN in
    // src/hooks/useWindowMenuPins.ts.
    #[cfg(desktop)]
    const KEEP_SIDEBAR_OPEN_ID: &str = "window-keep-sidebar-open";
    #[cfg(desktop)]
    const KEEP_SIDEBAR_OPEN_EVENT: &str = "menu://toggle-sidebar-pin";

    /// The Window menu's check items, so `set_window_pin` can reach them:
    /// `Menu::get` searches the top level only, never a submenu.
    #[cfg(desktop)]
    struct WindowPins(Vec<tauri::menu::CheckMenuItem<tauri::Wry>>);
    ```
  - Replace the doc comment and body of `install_new_workspace_menu_item` with this function, and rename it:
    ```rust
    /// Edits the stock menu bar: "New Workspace…" at the top of File, and the
    /// pin toggles at the bottom of Window, below its own Minimize/Zoom items.
    ///
    /// `#[cfg(desktop)]` because `tauri::menu` exists only on desktop targets.
    /// This line builds none other, so the attribute changes nothing here; it is
    /// kept so this code is main's and v7.0.0's, where the iPad build needs it.
    #[cfg(desktop)]
    fn install_menu_items(app: &tauri::AppHandle) -> tauri::Result<()> {
        use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};

        let menu = Menu::default(app)?;
        let new_workspace =
            MenuItem::with_id(app, NEW_WORKSPACE_MENU_ID, "New Workspace…", true, None::<&str>)?;
        // Disabled and unchecked until the UI reports the active workspace's
        // pin (useWindowMenuPins): no workspace is open at launch.
        let keep_sidebar_open = CheckMenuItem::with_id(
            app, KEEP_SIDEBAR_OPEN_ID, "Keep Sidebar Open", false, false, None::<&str>,
        )?;

        // Start from the default menu and edit it, rather than rebuilding the bar:
        // App/Edit/View/Window/Help all carry platform behaviour we would have to
        // reproduce by hand, and silently lose if we got it wrong.
        for kind in menu.items()? {
            if let Some(submenu) = kind.as_submenu() {
                match submenu.text()?.as_str() {
                    "File" => submenu.insert(&new_workspace, 0)?,
                    "Window" => {
                        submenu.append(&PredefinedMenuItem::separator(app)?)?;
                        submenu.append(&keep_sidebar_open)?;
                    }
                    _ => {}
                }
            }
        }

        app.manage(WindowPins(vec![keep_sidebar_open]));
        app.set_menu(menu)?;
        Ok(())
    }

    /// Sets a Window-menu pin's checkmark and whether it can be chosen. The UI
    /// owns the pin and calls this whenever it changes, from any source.
    #[tauri::command]
    fn set_window_pin(app: tauri::AppHandle, id: String, checked: bool, enabled: bool) -> Result<(), String> {
        #[cfg(desktop)]
        if let Some(pins) = app.try_state::<WindowPins>() {
            if let Some(item) = pins.0.iter().find(|item| item.id().0 == id) {
                item.set_checked(checked).map_err(|e| e.to_string())?;
                item.set_enabled(enabled).map_err(|e| e.to_string())?;
            }
        }
        #[cfg(not(desktop))]
        let _ = (app, id, checked, enabled);
        Ok(())
    }
    ```
  - `invoke_handler`: `tauri::generate_handler![video_wrapper::video_wrapper_port, set_window_pin]`.
  - In `setup`: replace the `install_new_workspace_menu_item` call and its message with
    ```rust
            #[cfg(desktop)]
            if let Err(error) = install_menu_items(app.handle()) {
                eprintln!("menu: cannot edit the menu bar: {error}");
            }
    ```
  - In `on_menu_event`, after the closing brace of `if event.id() == NEW_WORKSPACE_MENU_ID { … }`, add:
    ```rust
             else if event.id() == KEEP_SIDEBAR_OPEN_ID {
                // The UI flips the active workspace's pin and sends the
                // checkmark back through set_window_pin.
                let _ = app.emit(KEEP_SIDEBAR_OPEN_EVENT, ());
            }
    ```

Run: `cargo check --manifest-path src-tauri/Cargo.toml --locked --offline -j 2 && cargo test --manifest-path src-tauri/Cargo.toml --locked --offline -j 2`
Expected: exit 0 with no new warnings. (`tauri::menu` is not unit-testable without a running app. The native behaviour is checked in the v6 QA bundle, Task 12 Step 3.)

- [ ] **Step 8: Help — failing test first.** Create `src/help/windowMenu.test.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { expect, it } from "vitest";
import { GUIDE_PAGES, GUIDE_PREFIX } from "./guide";
import { TOPICS } from "./index";

const guide = (slug: string) => GUIDE_PAGES.find((p) => p.slug === `${GUIDE_PREFIX}${slug}`)!.body;
const topic = (slug: string) => TOPICS.find((t) => t.slug === slug)!.body;

it("documents Window ▸ Keep Sidebar Open on the shortcut and workspace pages", () => {
  for (const body of [guide("keyboard-shortcuts"), topic("keyboard-shortcuts"), guide("workspaces"), topic("workspaces")]) {
    expect(body).toContain("Keep Sidebar Open");
  }
});
```
Run `pnpm exec vitest run src/help/windowMenu.test.ts`. It FAILS on the first page.

- [ ] **Step 9: Write the Help text.**
  - `src/help/topics/keyboard-shortcuts.md`: insert before `## What Escape does when more than one thing is open`:
    ```md
    ## In the desktop app's Window menu

    - **Window ▸ Keep Sidebar Open** — Pin the left rail open for the workspace
      you are in, the same as the rail's **Pin the rail open** button. The
      checkmark follows the pin however you change it. Greyed out when no
      workspace is open, because the pin belongs to a workspace. No shortcut.

    ```
  - `src/help/guide/keyboard-shortcuts.md`: insert before `## What Escape does when more than one thing is open`:
    ```md
    ## In the desktop app's Window menu

    - **Window ▸ Keep Sidebar Open** — Pin the left rail open for the workspace you are in, the same as the rail's **Pin the rail open** button. The checkmark follows the pin however you change it. Greyed out when no workspace is open, because the pin belongs to a workspace. No shortcut.

    ```
  - Append to both `src/help/topics/workspaces.md` and `src/help/guide/workspaces.md`:
    ```md

    In a workspace the left rail can be pinned open with the lock beside the rail's first section label, or with **Window ▸ Keep Sidebar Open** in the desktop app. The pin is saved with the workspace, so each workspace remembers its own. Outside a workspace the menu item is greyed out.
    ```
  Run: `pnpm exec vitest run src/help`. Expected: all PASS, with windowMenu 1/1.

- [ ] **Step 10: Commit**

```bash
cd "$W5"; test "$(git rev-parse --show-toplevel)" = "$W5" || { echo WRONG CHECKOUT; exit 1; }
git add src-tauri/src/lib.rs src/hooks/useWindowMenuPins.ts src/hooks/useWindowMenuPins.test.tsx src/browser-shim/core.ts src/browser-shim/shims.test.ts src/App.tsx src/help
git commit -m "feat(v5): Window > Keep Sidebar Open pins the active workspace's rail

A native check item, disabled outside a workspace. The UI owns the pin
(workspacesStore railsOpen.left via setRailsOpen, as the rail's lock button)
and pushes the checkmark through set_window_pin whenever it changes, from
any source; a failed write puts it back.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: v5 requalification

**Files:**
- Create: `docs/releases/validation/v5-reconciled/fixbatch-2026-10-08/{README.md,*.log,gates.tsv,head.txt}`; append to `docs/releases/v5-reconciliation.md`

- [ ] **Step 1: Run the gates** — `bash docs/releases/validation/v3-repair/fixbatch-2026-10-08/run-gates.sh docs/releases/validation/v5-reconciled/fixbatch-2026-10-08`. Every gate must be `exit=0`, with reruns handled as in Task 3.
- [ ] **Step 2: Sanitise and check**

```bash
cd "$W5"; G=docs/releases/validation/v5-reconciled/fixbatch-2026-10-08
LC_ALL=C sed -i '' "s#$HOME#<home>#g" $G/*.log
! grep -rnE '\.ts\.net|tskey-|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]+\.[0-9]+' $G || { echo "tailnet data in receipts"; exit 1; }
```
- [ ] **Step 3: Ledger.** Append to `docs/releases/v5-reconciliation.md`:
  ```md

  ## Fix batch 2026-10-08 (user-approved)

  Merged `codex/clean-v4-integration` (v3 D-005/D-008/D-002, v4 D-007 and its user-approved `appsJson.cleanV4.test.ts` assertion change, logged in v4-integration.md). Added Window ▸ Keep Sidebar Open (home v5): a native check item bound to the active workspace's `railsOpen.left`, disabled outside a workspace, kept in sync through `set_window_pin`. No assertion changed on this line. Receipts: [validation/v5-reconciled/fixbatch-2026-10-08](validation/v5-reconciled/fixbatch-2026-10-08/).
  ```
  Write the receipts `README.md` in the Task 3 Step 5 shape.
- [ ] **Step 4: Commit**

```bash
cd "$W5"; test "$(git rev-parse --show-toplevel)" = "$W5" || { echo WRONG CHECKOUT; exit 1; }
git add docs/releases/validation/v5-reconciled/fixbatch-2026-10-08 docs/releases/v5-reconciliation.md
git commit -m "chore(v5): fix-batch 2026-10-08 gate receipts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: v6 merge of v5

**Files:**
- Merge: `codex/clean-v5-reconciled` into `codex/clean-v6`

- [ ] **Step 1: Preflight and merge**

```bash
W6=~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v6
cd "$W6"; git status --short   # must be empty
git merge --no-ff codex/clean-v5-reconciled
```
Expected touch points, with their resolutions:
- `src-tauri/src/lib.rs`: identical on v5 `8988979` and v6, so it merges clean.
- `src/App.tsx`: v6 rewrote the region around `useDashboardShortcuts(…)`. Keep v6's call exactly, and put the v5 import plus the `useWindowMenuPins(viewerId === null);` line directly after it.
- `src/help/guide/keyboard-shortcuts.md` and `src/help/topics/keyboard-shortcuts.md`: keep v6's lines and v5's new `## In the desktop app's Window menu` section.
- `DashboardGrid.tsx`, `appsJson*`, `appsExtensionsV4.ts`, `web/`, ci.yml: expected clean. They are identical to v5 at the merge base.

Any conflict in a test file assertion is a stop-and-ask.

- [ ] **Step 2: Run the carried tests**

Run: `pnpm exec vitest run src/components/DashboardGrid.layout.test.tsx src/lib/appsJson.d008.test.ts src/lib/appsJson.d007.test.ts src/lib/appsJson.cleanV4.test.ts src/hooks src/browser-shim src/help && pnpm typecheck && pnpm lint && cargo check --manifest-path src-tauri/Cargo.toml --locked --offline -j 2`
Expected: all PASS, exit 0.

- [ ] **Step 3: Commit or amend the merge message** — `Merge branch 'codex/clean-v5-reconciled' into codex/clean-v6`. The body names the batch and every hand resolution, and ends with the Co-Authored-By line. Run the top-level check first.

---

### Task 11: v6 Window ▸ Keep Rita Open and the single-toggle shortcut

**Files:**
- Modify: `src-tauri/src/lib.rs`, `src/hooks/useWindowMenuPins.ts`, `src/hooks/useWindowMenuPins.test.tsx`, `src/hooks/useDashboardShortcuts.ts` (:79-86), `src/hooks/useDashboardShortcuts.test.tsx`, `src/help/windowMenu.test.ts`
- Modify: `src/help/topics/keyboard-shortcuts.md`, `src/help/guide/keyboard-shortcuts.md`, `src/help/topics/rita.md` (:12), `src/help/guide/rita-chat.md` (:20)

**Interfaces:**
- Consumes: `bindPin` and `SIDEBAR_PIN` (Task 8); `useChatStore` (`pinned: boolean`, `togglePinned(): void`, `subscribe`); `useDashboardShortcuts(onOpenLibrary, onOpenHelp, onNewWorkspace?)`.
- Produces: `RITA_PIN = { id: "window-keep-rita-open", event: "menu://toggle-rita-pin" }`, plus Rust `KEEP_RITA_OPEN_ID` / `KEEP_RITA_OPEN_EVENT` with accelerator `CmdOrCtrl+Shift+A`.

- [ ] **Step 1: Failing tests, part 1.** In `src/hooks/useWindowMenuPins.test.tsx`: add `import { useChatStore } from "../stores/chatStore";` and `import { useDashboardShortcuts } from "./useDashboardShortcuts";`. Change the hook import to `import { RITA_PIN, SIDEBAR_PIN, useWindowMenuPins } from "./useWindowMenuPins";`, add `useChatStore.setState({ pinned: false });` to `beforeEach`, and append:

```tsx
it("Keep Rita Open follows the Rita pin from any source", () => {
  renderHook(() => useWindowMenuPins(true));
  expect(sentFor(RITA_PIN.id)).toEqual({ id: RITA_PIN.id, checked: false, enabled: true });
  act(() => useChatStore.getState().togglePinned()); // the pane's Lock button
  expect(sentFor(RITA_PIN.id)).toEqual({ id: RITA_PIN.id, checked: true, enabled: true });
});

it("⌘⇧A in the desktop app toggles the Rita pin exactly once", async () => {
  // macOS: the accelerator chooses Window ▸ Keep Rita Open; if the keydown also
  // reaches the page, the two together must still be one toggle.
  renderHook(() => {
    useWindowMenuPins(true);
    useDashboardShortcuts(() => {}, () => {});
  });
  await waitFor(() => expect(tauri.handlers.has(RITA_PIN.event)).toBe(true));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "A", code: "KeyA", metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  await chooseMenuItem(RITA_PIN.event);
  expect(useChatStore.getState().pinned).toBe(true);
  await waitFor(() => expect(sentFor(RITA_PIN.id)).toEqual({ id: RITA_PIN.id, checked: true, enabled: true }));
});
```

- [ ] **Step 2: Failing tests, part 2.** In `src/hooks/useDashboardShortcuts.test.tsx`, add above the existing imports of app modules:

```tsx
const native = vi.hoisted(() => ({ on: false }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => native.on,
}));
```
In that file's top-level `beforeEach`, add `native.on = false;`. If the file has none, add `beforeEach(() => { native.on = false; });` after the helpers. Next to the existing "⌘⇧A toggles the Rita pin…" test, append:

```tsx
  it("in the desktop app leaves ⌘⇧A to Window ▸ Keep Rita Open (no double toggle)", () => {
    native.on = true;
    useChatStore.setState({ pinned: false });
    render(<Harness />);
    const event = pressCommandShift("KeyA");
    expect(event.defaultPrevented).toBe(true);
    expect(useChatStore.getState().pinned).toBe(false);
  });
```
Run: `pnpm exec vitest run src/hooks/useWindowMenuPins.test.tsx src/hooks/useDashboardShortcuts.test.tsx`
Expected: three FAILs. The two new hook tests throw `TypeError: Cannot read properties of undefined (reading 'id')` because `RITA_PIN` does not exist yet. The new shortcut test fails with `expected true to be false`, because the JS handler still toggles in the native app.

- [ ] **Step 3: Implement the shortcut guard.** In `src/hooks/useDashboardShortcuts.ts`, add `import { isTauri } from "@tauri-apps/api/core";` and replace the ⌘⇧A block (:79-86) with:

```ts
      // ⌘⇧A / Ctrl+Shift+A pins the Rita pane. Repeat is ignored so a held
      // key does not flap the pin. In the desktop app the shortcut belongs to
      // Window ▸ Keep Rita Open, whose native accelerator toggles through the
      // menu event (useWindowMenuPins); toggling here too would undo it. The
      // browser build has no native menu, so the toggle stays here for it.
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.code === "KeyA") {
        if (event.repeat) return;
        event.preventDefault();
        if (!isTauri()) useChatStore.getState().togglePinned();
        return;
      }
```

- [ ] **Step 4: Implement the Rita pin.** In `src/hooks/useWindowMenuPins.ts`, add `import { useChatStore } from "../stores/chatStore";`. Below `SIDEBAR_PIN`, add:

```ts
export const RITA_PIN = { id: "window-keep-rita-open", event: "menu://toggle-rita-pin" } as const;
```
Replace the effect body in `useWindowMenuPins` with:

```ts
    if (!enabled || !isTauri()) return;
    const unbindSidebar = bindPin(SIDEBAR_PIN, sidebarPin, useWorkspacesStore.subscribe, toggleSidebarPin);
    const unbindRita = bindPin(
      RITA_PIN,
      () => ({ checked: useChatStore.getState().pinned, enabled: true }),
      useChatStore.subscribe,
      () => useChatStore.getState().togglePinned(),
    );
    return () => {
      unbindSidebar();
      unbindRita();
    };
```
Update the App.tsx comment from Task 8 to `// Window ▸ Keep Sidebar Open / Keep Rita Open: main window only (a viewer has neither).`

- [ ] **Step 5: Native side.** In `src-tauri/src/lib.rs`:
  - Below the sidebar constants, add:
    ```rust
    // Window ▸ Keep Rita Open, ⌘⇧A. Kept in sync by hand with RITA_PIN in
    // src/hooks/useWindowMenuPins.ts; the accelerator is the shortcut
    // useDashboardShortcuts handles in the browser build.
    #[cfg(desktop)]
    const KEEP_RITA_OPEN_ID: &str = "window-keep-rita-open";
    #[cfg(desktop)]
    const KEEP_RITA_OPEN_EVENT: &str = "menu://toggle-rita-pin";
    ```
  - In `install_menu_items`, after `keep_sidebar_open`, add:
    ```rust
        let keep_rita_open = CheckMenuItem::with_id(
            app, KEEP_RITA_OPEN_ID, "Keep Rita Open", true, false, Some("CmdOrCtrl+Shift+A"),
        )?;
    ```
    In the `"Window"` arm, after `submenu.append(&keep_sidebar_open)?;`, add `submenu.append(&keep_rita_open)?;`. Change the manage line to `app.manage(WindowPins(vec![keep_sidebar_open, keep_rita_open]));`.
  - In `on_menu_event`, after the sidebar branch, add:
    ```rust
             else if event.id() == KEEP_RITA_OPEN_ID {
                let _ = app.emit(KEEP_RITA_OPEN_EVENT, ());
            }
    ```
  Run: `cargo check --manifest-path src-tauri/Cargo.toml --locked --offline -j 2`. Expected: exit 0.

- [ ] **Step 6: Run GREEN**

Run: `pnpm exec vitest run src/hooks src/browser-shim src/App.test.tsx`
Expected: all PASS. That includes the existing "⌘⇧A toggles the Rita pin, ignores key repeat and typing targets" test, unchanged, because jsdom is not native.

- [ ] **Step 7: Help — failing test, then text.** Append to `src/help/windowMenu.test.ts`:

```ts
it("documents Window ▸ Keep Rita Open and where ⌘⇧A works in the desktop app", () => {
  for (const body of [guide("keyboard-shortcuts"), topic("keyboard-shortcuts"), guide("rita-chat"), topic("rita")]) {
    expect(body).toContain("Keep Rita Open");
  }
  expect(guide("keyboard-shortcuts")).not.toContain("`⌘⇧A` does nothing while the message box has focus, like every global shortcut");
});
```
Run `pnpm exec vitest run src/help/windowMenu.test.ts`. It FAILS. Then make these edits:
  - `src/help/topics/keyboard-shortcuts.md`. Replace the Global bullet `- \`⌘⇧A\` — Lock or unlock the Rita pane. Ctrl+Shift+A on Windows and Linux.` with:
    ```md
    - `⌘⇧A` — Lock or unlock the Rita pane. Ctrl+Shift+A on Windows and Linux.
      In the desktop app this is the shortcut of **Window ▸ Keep Rita Open**, so
      it works even while you are typing or a dialog is open; in the web preview
      it follows the rule above.
    ```
    In `## In the desktop app's Window menu`, append the bullet:
    ```md
    - **Window ▸ Keep Rita Open** (`⌘⇧A`) — Lock the Rita pane open, the same as
      the **Lock** button in its header. The checkmark follows the lock however
      you change it.
    ```
  - `src/help/guide/keyboard-shortcuts.md`. Replace the table row's text `Lock or unlock the Rita pane (Ctrl+Shift+A on Windows and Linux). Needs a Rita URL, or there is no pane to lock.` with `Lock or unlock the Rita pane (Ctrl+Shift+A on Windows and Linux). Needs a Rita URL, or there is no pane to lock. In the desktop app it is the shortcut of **Window ▸ Keep Rita Open** and works everywhere, typing included.` Replace the Rita-pane bullet `- \`⌘⇧A\` does nothing while the message box has focus, like every global shortcut; use the lock button in the pane header there.` with `- In the desktop app \`⌘⇧A\` locks or unlocks the pane even while the message box has focus (it belongs to **Window ▸ Keep Rita Open**). In the web preview it does nothing there, like every global shortcut; use the lock button in the pane header.` Append to the Window menu section: `- **Window ▸ Keep Rita Open** (\`⌘⇧A\`) — Lock the Rita pane open, the same as the **Lock** button in its header. The checkmark follows the lock however you change it.`
  - `src/help/guide/rita-chat.md:20`. Replace `The shortcut is ignored while you are typing in a field.` with `In the desktop app the shortcut belongs to **Window ▸ Keep Rita Open** and works anywhere, typing included; in the web preview it is ignored while you are typing in a field.`
  - `src/help/topics/rita.md:12`. After `click **Lock** in the pane header to`, keep the sentence, and add as the paragraph's last sentence: `In the desktop app the same lock is **Window ▸ Keep Rita Open**, whose checkmark follows it.`
  Run: `pnpm exec vitest run src/help`. Expected: all PASS. The existing `guide.test.ts` assertion `toContain("⌘⇧A")` still holds.

- [ ] **Step 8: Commit**

```bash
cd "$W6"; test "$(git rev-parse --show-toplevel)" = "$W6" || { echo WRONG CHECKOUT; exit 1; }
git add src-tauri/src/lib.rs src/hooks src/App.tsx src/help
git commit -m "feat(v6): Window > Keep Rita Open owns the native ⌘⇧A

A native check item with accelerator CmdOrCtrl+Shift+A toggles chatStore.pinned
through the menu event; the checkmark follows the pin from any source. In the
native app the JS shortcut no longer toggles (the accelerator already did), and
the browser build keeps it. Help says where ⌘⇧A works in each build.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: v6 requalification, native QA bundle and the optional live gate

**Files:**
- Create: `docs/releases/validation/v6/fixbatch-2026-10-08/{README.md,*.log,gates.tsv,head.txt,bundle.txt,build.log,native-menu.md}`
- Modify: `docs/releases/v6-assembly.md` (append a section, plus row 9 in the review-warning index)

- [ ] **Step 1: Run the gates** — `bash docs/releases/validation/v3-repair/fixbatch-2026-10-08/run-gates.sh docs/releases/validation/v6/fixbatch-2026-10-08`. Every gate must be `exit=0`, with reruns handled as in Task 3. This is the first v6 run where `web-browser` is expected to pass (D-002).

- [ ] **Step 2: Rebuild the native QA bundle** (never the production identifier)

```bash
cd "$W6"; N=docs/releases/validation/v6/fixbatch-2026-10-08
mkdir -p .superpowers && printf '{"identifier":"com.artcashin.bdobb.clean.v6","productName":"BDOBB Clean v6"}\n' > .superpowers/qa-v6-overlay.json
CARGO_BUILD_JOBS=2 pnpm tauri build --config .superpowers/qa-v6-overlay.json --bundles app > $N/build.log 2>&1; echo "bundle $?"
APP=$(ls -d src-tauri/target/release/bundle/macos/*.app | head -1)
{ echo "$APP"; /usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' -c 'Print CFBundleShortVersionString' "$APP/Contents/Info.plist"; shasum -a 256 "$APP/Contents/MacOS/"*; codesign -dv "$APP" 2>&1 | grep -E 'Identifier|Signature|TeamIdentifier'; } | tee $N/bundle.txt
grep -l "window-keep-rita-open" dist/assets/*.js   # the build carries this batch (grep assets, not the binary)
```
Expected: `bundle 0`, identifier `com.artcashin.bdobb.clean.v6`, version `6.0.0`, a new binary SHA-256 (the previous one was `7b752cfa…1e67`), and at least one asset file listed.

- [ ] **Step 3: Native menu check (manual, recorded in `native-menu.md`).** Before launching, run `pgrep -fl "BDOBB Clean v6"`, because another session may be running a different build. Launch `$APP` with the existing QA profile; never reset a production profile. Use the computer-use `app_menu`/screenshot tools and record each result:
  1. The Window menu shows the stock items, then a separator, **Keep Sidebar Open** (greyed, unchecked) and **Keep Rita Open ⇧⌘A**.
  2. Open a workspace. **Keep Sidebar Open** becomes enabled, and its checkmark matches the rail lock.
  3. Choose it. The rail pins, and the lock glyph and checkmark both flip. Click the rail lock: the checkmark follows.
  4. Press ⌘⇧A once. The Rita pane locks, the checkmark appears, and it does not flicker back. Click the pane's Lock: the checkmark follows.
  5. Leave the workspace. **Keep Sidebar Open** greys out.

  Save one screenshot of the open Window menu as `native-window-menu.png` in the receipts dir. Quit the app.

- [ ] **Step 4 (OPTIONAL, LABELLED): live Rita gate.** Run it only if the user confirms the NAS openbq node is the target and supplies the hostnames at run time. Follow `docs/releases/validation/v6/live/env.txt`: Rita over HTTPS on 10443, MCP on 11443 at `/mcp` as `openbb=<url>`, the backend on its default port, and a dummy shell-only `OPENBB_NAS_AUTH`. Export the variables in the shell only, then run it unsandboxed:
  `pnpm test:live > docs/releases/validation/v6/fixbatch-2026-10-08/live-OPTIONAL.log 2>&1; echo "live $?"`
  Then replace every hostname in that log with `<nas>`. Record the result as "optional live gate", never as a required gate. A `rita-table-model-live` setup failure is the known D-006 model-conduct flake, not a regression from this batch.

- [ ] **Step 5: Sanitise and check** (covers `live-OPTIONAL.log` if it exists)

```bash
cd "$W6"; G=docs/releases/validation/v6/fixbatch-2026-10-08
LC_ALL=C sed -i '' "s#$HOME#<home>#g" $G/*.log $G/bundle.txt
! grep -rnE '\.ts\.net|tskey-|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]+\.[0-9]+' $G || { echo "tailnet data in receipts"; exit 1; }
```

- [ ] **Step 6: Ledger.** Append to `docs/releases/v6-assembly.md`:
  ```md

  ## Fix batch 2026-10-08 (user-approved)
  - Merged `codex/clean-v5-reconciled` (v3 D-005/D-008/D-002, v4 D-007, v5 Window ▸ Keep Sidebar Open). Hand resolutions: see the merge commit.
  - Window ▸ Keep Rita Open (home v6): native check item, accelerator `CmdOrCtrl+Shift+A`, bound to `chatStore.pinned`. In the native app the JS ⌘⇧A handler no longer toggles; the browser build keeps it. Behaviour change: in the desktop app ⌘⇧A now works while typing or behind a dialog (Help updated; flagged to the user).
  - D-002 closed: `test:web:browser` passes and is in ci.yml's e2e job after `build:web`.
  - Native QA bundle rebuilt: see `validation/v6/fixbatch-2026-10-08/bundle.txt`; Window-menu check in `native-menu.md`.
  - Receipts: `validation/v6/fixbatch-2026-10-08/`.
  ```
  In `## Review warning index`, add the row:
  `| 9 | \`appsJson.cleanV4.test.ts\` "reference pivot-v1 layout overlays become editable analytical definitions in v4" → asserts \`table.pivot\` | justified | User-approved 2026-10-08 (D-007, home v4; logged in v4-integration.md): the old expectation was the defect. |`
  Also add to `validation/v6/regression/defects.md`, after each of D-002, D-005, D-007 and D-008, a one-line status: `FIXED 2026-10-08 (fix batch; see v6-assembly.md)`.

- [ ] **Step 7: Write the receipts `README.md`** (Task 3 Step 5 shape, plus the bundle hash and the native-menu results), then commit:

```bash
cd "$W6"; test "$(git rev-parse --show-toplevel)" = "$W6" || { echo WRONG CHECKOUT; exit 1; }
git add docs/releases/validation/v6/fixbatch-2026-10-08 docs/releases/v6-assembly.md docs/releases/validation/v6/regression/defects.md
git commit -m "chore(v6): fix-batch 2026-10-08 gate receipts, native QA bundle and menu check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Final ancestry check (must print four OKs)**

```bash
cd "$W6"
V3H=$(git -C "$W3" rev-parse claude/clean-v3-fixbatch)
git merge-base --is-ancestor "$V3H" codex/clean-v4-integration && echo "OK v3 in v4"
git merge-base --is-ancestor codex/clean-v4-integration codex/clean-v5-reconciled && echo "OK v4 in v5"
git merge-base --is-ancestor codex/clean-v5-reconciled codex/clean-v6 && echo "OK v5 in v6"
git -C "$W3" merge-base --is-ancestor 3abc906d0ee400fc4c51e01cb550738684902d44 claude/clean-v3-fixbatch && echo "OK D-005 base"
git tag --points-at HEAD; git -C "$W3" tag --points-at HEAD   # expect nothing: no tags made
```
