# See-through Locked Bands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-band "See-through where empty" switch in Settings ▸ Locked Widgets that lays a locked band over the dashboard's scroll region instead of taking a strip of the page column, with scroll room at that end and pointer input passing through empty band space.

**Architecture:** The switch is one optional field on the docks dashboard, `dockSeeThrough`, read and written through the paths that already carry `dockRows` (the docks file, the docks sync, the apps.json v8 `docks` member). `DockBand` decides per render whether its band floats (switch on, not capped by the window, no workspace shown — a pure function) and marks it `.dock-band-float`; a small hook publishes the band's height on `.dashboard-area` as `--dock-room-top` / `--dock-room-bottom` and opens the dashboard scrolled past a top band's room. Everything visual is CSS keyed off `.dock-band-float` under `.dashboard-area:has(> .dashboard-scroll)`: a negative margin takes the band out of the column, `order` places it over the scroll region's end (below the tab bar, inside a tab's pinned card), padding gives the room, and `pointer-events` lets empty space through. The DOM order — and so the bands' mount-once guarantee — is untouched.

**Tech Stack:** React 19, Zustand, react-grid-layout 1.5, Vitest 2 + jsdom 25 + Testing Library, Playwright 1.62 (written here, run by the release walk), plain CSS in `src/styles.css`.

**Spec:** `docs/superpowers/specs/2026-11-12-see-through-locked-bands-design.md` (approved 2026-11-12). Task 9 updates it with what this plan settled.

## Global Constraints

- Frontend only: no Rust, no `Cargo.toml` / `Cargo.lock` change, no new npm dependency.
- Switch off ⇒ byte-for-byte the same rendered layout and saved data as today. Absent field = off. Never write `dockSeeThrough` (docks file, sync content) or `seeThrough` (apps.json) for an edge that is off; with both off the field is absent, not `{}`.
- Every float rule in `src/styles.css` names `.dock-band-float` in its selector, so no rule changes a page whose bands are not see-through.
- Cherry-picked later onto v9, v10 and main, where `App.tsx`, `DockBand.tsx`, `dashboardStore.ts`, `styles.css` and the settings dialog differ: keep edits small and anchored to the lines named here, put new logic in the new files (`src/lib/dockSeeThrough.ts`, `src/hooks/useFloatingBand.ts`, `src/components/DockBand.seeThrough.test.tsx`, `e2e/see-through.spec.ts`), do not reformat or reorder existing code.
- New source files start with the line's two-line header, exactly:
  ```
  // Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
  // SPDX-License-Identifier: AGPL-3.0-only
  ```
  (`scripts/header-check.sh` checks the first five lines of every tracked `.ts/.tsx/.css/...` file.)
- UI copy, verbatim: the switch's label is `See-through where empty`; it is an `<input type="checkbox" role="switch">` inside its `<label>`, as the Pivot drawer's "Pivot on" is.
- One-time setup in the worktree before the first test run: `pnpm install --frozen-lockfile` (no `node_modules` is checked out; this installs the locked set, it adds nothing).
- Executors do NOT run Playwright (`pnpm e2e`, `pnpm test:web:browser`, any `playwright test`): the release walk is using it. Task 8 writes `e2e/see-through.spec.ts`; the walk runs it.
- Gates (from `.github/workflows/ci.yml` and `package.json`), run in Task 10: `pnpm typecheck`, `pnpm lint`, `pnpm knip`, `pnpm test:run`, `pnpm test:web`, `pnpm build:web`, `pnpm build`, `pnpm notices:check`, `pnpm scrub`. Cargo steps are untouched by this change and are not run.
- Committed files carry no absolute home-directory path (`pnpm scrub` refuses them): write `<worktree>` or `~`.
- Positioning fact for this line, which this feature does not need (it positions nothing against the screen): Tauri reports the window's content area as the whole window and the page starts 32 points lower.

## Decisions this plan makes (confirm before executing)

The spec left three things to the plan, and reading the code forced two more. Task 9 writes all five into the spec.

1. **A see-through band lies under the tab bar, not over it.** The spec's "Existing structure" lists the column as "tab bar, top band, `.dashboard-scroll`". On this line the top band is mounted ABOVE the tab bar (`src/App.tsx:683-693`, `src/components/DashboardGrid.tsx:250-257`; the Help says so too). Floating the band where it is would put the tab bar under it, so a floating top band is moved by CSS `order` to just above `.dashboard-scroll`. Consequence: a maximized dashboard card (fixed, from the tab bar's bottom, z 20) now covers a see-through top band; an opaque one stays visible above the bar as today.
2. **A tab's own pinned card stays outside the floating band.** The pinned card docks (`.card-dock-top/-bottom`) sit between the tab bar and the scroll region. A floating band covers only the scroll region: the top one sits below a pinned top card, the bottom one above a pinned bottom card (CSS `order`). With a pinned bottom card and a see-through bottom band, the pinned card is now the outermost strip.
3. **Opaque while a workspace is shown.** A workspace's area never scrolls; each tile scrolls its own `.dashboard-scroll` (`src/styles.css:3107-3134`, `3238-3242`), so there is no one region to give room to. `DockBand` treats the workspace like a capped band. A viewer window has no workspace and ignores the flag.
4. **No scroll position is saved today, so the opening step is simple.** Nothing saves or restores a dashboard's or tab's scroll: the one `.dashboard-scroll` element (`DashboardGrid.tsx:257`, not keyed in `App.tsx:686`) is reused across dashboard and tab switches and keeps whatever `scrollTop` it had, clamped. While the top band floats, the hook sets `scrollTop` to the room when the band starts floating and when `activeId`, `activeTabId` or `activeTabIds` change — never on any other render.
5. **Earlier builds lose the switch.** A docks sync record or apps.json from this build carries the switch. A build from before it reads the synced docks without the switch (its `withDefaults` names fields explicitly) and, if it later edits them, uploads them without it. Its strict apps.json `docks` member refuses the unknown `seeThrough` key, so such a file's bands import there as an ordinary dashboard (the existing "unreadable docks member" degrade). Only files and records written with a switch on are affected.

## Review Focus

1. **A short tab under a see-through top band** — the tab is shorter than the window, so the region cannot scroll a full room. Expected: it still opens with its first card beneath the band, not floating part-way down. Pinned by the grid's `min-height` rule (Task 6, CSS text test) and the e2e case "a short tab…" (Task 8).
2. **A tab with its own pinned card on the same edge** — expected: the pinned card is fully visible and the locked band floats over the scroll region beside it, not over the pinned card. Pinned by the `order: 2` rule's text test (Task 5) and the e2e case "a tab's pinned bottom card…" (Task 8).
3. **The user scrolls, then something unrelated re-renders the band** (a card refresh, a maximize, a settings change). Expected: the dashboard stays where the user put it. Pinned in Task 6 ("…never on an unrelated render").
4. **The switch on, then off again** — expected: the docks file and the sync content hold no `dockSeeThrough` at all, the same bytes as never switched on. Pinned in Task 1 (`withDockSeeThrough` drops the field) and Task 3 (store write).
5. **An apps.json whose `docks.seeThrough` is malformed** (`"yes"`, `{ top: 1 }`, `{ middle: true }`, `{ bottom: false }`, `null`). Expected: the same degrade as a bad `rows` — the docks member is skipped and said so, never a crash or a half-read switch. Pinned in Task 2.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/lib/types.ts:818-819` | Modify | `Dashboard.dockSeeThrough?` beside `dockRows` |
| `src/lib/dockSeeThrough.ts` | Create | `DockSeeThrough`, `readDockSeeThrough`, `withDockSeeThrough`, `bandFloats` — all the pure logic |
| `src/lib/dashboardsFile.ts:96, 141-164` | Modify | Read the field on load (save already spreads it) |
| `src/lib/appsExtensionsV8.ts:25, 109-127, 138, 245` | Modify | apps.json `docks.seeThrough`: write, strict read, restore |
| `src/stores/dashboardStore.ts:27, 97, 1618` | Modify | `setDockSeeThrough` action |
| `src/components/DockBand.tsx:4-12, 148-176, 195-248` | Modify | Float decision + class + hook call; the editor's switch |
| `src/hooks/useFloatingBand.ts` | Create | Publish `--dock-room-<edge>`; open past a top band's room |
| `src/App.tsx:204-207` | Modify | `dockTopKey` also follows the top switch (re-measures `--dashboard-top`) |
| `src/styles.css:1622, 1634` | Modify | Float rules after `.dock-band-maximized`; the switch's style in the edit bar |
| `src/components/DockBand.seeThrough.test.tsx` | Create | Editor switch, band modes, hook, CSS text |
| `src/lib/dockSeeThrough.test.ts` | Create | Pure logic |
| `src/lib/dashboardsFile.test.ts`, `src/lib/docksSync.test.ts`, `src/lib/appsJson.cleanV8.test.ts`, `src/stores/dashboardStore.docks.test.ts`, `src/stores/dashboardRevision.test.ts` | Modify | New cases; the revision suite's action list |
| `e2e/see-through.spec.ts` | Create | Real-engine geometry (run by the walk) |
| `src/help/guide/locked-and-pinned-widgets.md`, `src/help/topics/locked-widgets.md`, `src/help/guide.test.ts`, `src/help/index.test.ts` | Modify | Help |
| `docs/superpowers/specs/2026-11-12-see-through-locked-bands-design.md` | Modify | Record the settled items |

**Every place `dockRows` is read or written, and what the switch does there:**

| Where | What it does with `dockRows` | The switch |
|---|---|---|
| `src/lib/types.ts:819` | the field | new field beside it (Task 1) |
| `src/lib/dashboardsFile.ts:30-58` | default, clamp, `makeDefaultDocks` | no default written — absent is off (nothing to do) |
| `src/lib/dashboardsFile.ts:96, 163` | `StoredDashboard`, `withDefaults` (load; names every field) | read here (Task 1) |
| `src/lib/dashboardsFile.ts:235-237` | `storedDashboard` (save; spreads) | carried with no change |
| `src/lib/docksSync.ts:17-20, 28-33` | sync encode (`storedDashboard`) / decode (`readStoredDashboard` → `withDefaults`) | follows Task 1; test added |
| `src/components/runDashboardSync.ts:358-375, 389-420` | `takeDocks` / `syncDocks` move the whole docks | nothing to do |
| `src/stores/dashboardStore.ts:1601-1618` | `setDockRows` | sibling action `setDockSeeThrough` (Task 3) |
| `src/stores/dashboardStore.ts:1620-1623` | `importDocks` spreads `incoming` | carried (incoming comes validated from Task 2) |
| `src/stores/dashboardStore.ts:1625-1630` | `applySyncedDocks` spreads `incoming` | carried (incoming comes from `withDefaults`) |
| `src/stores/dashboardStore.ts:1584-1594` | `cancelDockEdit` restores the snapshot | restores the switch too (tested, Task 3) |
| `src/stores/dashboardStore.ts:1264, 1314` | rows bound where a card lands | not the switch's business |
| `src/components/DockBand.tsx:64, 80, 150, 196-238` | `useFitRows`, `DockGrid`, `DockBand`, `DockEditor` | `DockBand` reads it (Task 5), `DockEditor` writes it (Task 4) |
| `src/App.tsx:206` | `dockTopKey` | add the top switch (Task 5) |
| `src/lib/appsExtensionsV8.ts:25, 109-127, 138, 245` | apps.json v8 `docks` member: type, strict read, export, import restore | `seeThrough` beside `rows` (Task 2) |
| `src/components/dialogs/SettingsDialog.tsx:515-531` | Export locked widgets… → `exportCompatibleApp` (`appsJson.ts:495-499`) → `exportV8` | follows Task 2 |
| `src/components/dialogs/SettingsDialog.tsx:538-550` | Import locked widgets… → `runAppsImport` → `prepareV8` (`appsJson.ts:941`) → `resolveDocksImport` (`docksImport.ts:23`) → `importDocks` | follows Task 2 |
| `src/lib/appsJson.ts:509-521` | Export all dashboards… → `exportCompatibleApp` per app | follows Task 2 |

---

### Task 1: The switch's data — field, normalisation, file and sync round-trips

**Files:**
- Create: `src/lib/dockSeeThrough.ts`
- Create: `src/lib/dockSeeThrough.test.ts`
- Modify: `src/lib/types.ts:818-819`
- Modify: `src/lib/dashboardsFile.ts` (imports at 4-12, `StoredDashboard` at 96, `withDefaults` at 141-164)
- Test: `src/lib/dashboardsFile.test.ts` (append inside `describe("the docks dashboard (v8 locked widgets)")`, after line 333), `src/lib/docksSync.test.ts` (append inside the describe, after line 21)

**Interfaces:**
- Consumes: `Dashboard`, `PinEdge`, `PIN_EDGES` from `src/lib/types.ts`.
- Produces:
  - `Dashboard.dockSeeThrough?: Partial<Record<PinEdge, true>>`
  - `export type DockSeeThrough = Partial<Record<PinEdge, true>>`
  - `export function readDockSeeThrough(v: unknown): DockSeeThrough | undefined` — keeps only edges whose value is `true`; undefined when none.
  - `export function withDockSeeThrough(d: Dashboard, edge: PinEdge, on: boolean): Dashboard` — sets or clears one edge; drops the field when no edge is on.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/dockSeeThrough.test.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { makeDefaultDocks } from "./dashboardsFile";
import { readDockSeeThrough, withDockSeeThrough } from "./dockSeeThrough";

describe("the see-through switch's data (v8 locked widgets)", () => {
  it("reads only true, per edge, and nothing at all as absent", () => {
    expect(readDockSeeThrough(undefined)).toBeUndefined();
    expect(readDockSeeThrough(null)).toBeUndefined();
    expect(readDockSeeThrough("yes")).toBeUndefined();
    expect(readDockSeeThrough({})).toBeUndefined();
    expect(readDockSeeThrough({ top: false, bottom: 1, middle: true })).toBeUndefined();
    expect(readDockSeeThrough({ bottom: true })).toEqual({ bottom: true });
    expect(readDockSeeThrough({ top: true, bottom: true, middle: true })).toEqual({ top: true, bottom: true });
  });

  it("sets one edge, and drops the field once no edge is on", () => {
    const docks = makeDefaultDocks();
    const on = withDockSeeThrough(docks, "bottom", true);
    expect(on.dockSeeThrough).toEqual({ bottom: true });
    expect(withDockSeeThrough(on, "top", true).dockSeeThrough).toEqual({ top: true, bottom: true });
    const off = withDockSeeThrough(on, "bottom", false);
    expect(off).not.toHaveProperty("dockSeeThrough");
    expect(off).toEqual(docks);
  });
});
```

Append to `src/lib/dashboardsFile.test.ts`, inside `describe("the docks dashboard (v8 locked widgets)", ...)`, after the "reads hidden only as true…" test:

```ts
  it("round-trips the see-through switch, and writes nothing for it while it is off", async () => {
    await saveDashboard({ ...makeDefaultDocks(), dockSeeThrough: { bottom: true } });
    expect((await loadDashboards()).find((d) => d.id === DOCKS_ID)?.dockSeeThrough).toEqual({ bottom: true });
    await saveDashboard(makeDefaultDocks());
    expect(__read("dashboards/docks.json")).not.toContain("dockSeeThrough");
    expect((await loadDashboards()).find((d) => d.id === DOCKS_ID)).not.toHaveProperty("dockSeeThrough");
  });

  it("reads the switch leniently: only true, only the two edges", async () => {
    __seed("dashboards/docks.json", JSON.stringify({ ...makeDefaultDocks(), dockSeeThrough: { top: "yes", bottom: true, middle: true } }));
    expect((await loadDashboards()).find((d) => d.id === DOCKS_ID)?.dockSeeThrough).toEqual({ bottom: true });
  });
```

Append to `src/lib/docksSync.test.ts`, inside `describe("the docks' server content (R6)", ...)`, after the first test:

```ts
  it("carries the see-through switch both ways, and no field while it is off", () => {
    const content = encodeDocksContent({ ...docks(), dockSeeThrough: { top: true } });
    expect(content.dashboard.dockSeeThrough).toEqual({ top: true });
    expect(decodeDocksContent(JSON.parse(JSON.stringify(content)))?.dockSeeThrough).toEqual({ top: true });
    expect(JSON.stringify(encodeDocksContent(docks()))).not.toContain("dockSeeThrough");
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run src/lib/dockSeeThrough.test.ts src/lib/dashboardsFile.test.ts src/lib/docksSync.test.ts`
Expected: FAIL — `dockSeeThrough.test.ts` with `Failed to resolve import "./dockSeeThrough"`; `dashboardsFile.test.ts` "round-trips the see-through switch…" and "reads the switch leniently…" with `expected undefined to deeply equal { bottom: true }`; `docksSync.test.ts` "carries the see-through switch…" with `expected undefined to deeply equal { top: true }`. TypeScript errors on `dockSeeThrough` are not reported by vitest; `pnpm typecheck` would fail until Step 3.

- [ ] **Step 3: Implement**

In `src/lib/types.ts`, after line 819 (`dockRows?: Record<PinEdge, number>;`), add:

```ts
  /** The docks only: the edges whose band is see-through where empty (lib/dockSeeThrough.ts). Absent is off on both. */
  dockSeeThrough?: Partial<Record<PinEdge, true>>;
```

Create `src/lib/dockSeeThrough.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { PIN_EDGES } from "./types";
import type { Dashboard, PinEdge } from "./types";

/**
 * Settings ▸ Locked Widgets ▸ See-through where empty, per edge (spec
 * 2026-11-12-see-through-locked-bands). Only `true` is ever stored: an edge
 * that is off has no key, and both off is no field at all, so a docks file
 * or sync record written with the switch off is the one written before it
 * existed.
 */
export type DockSeeThrough = Partial<Record<PinEdge, true>>;

/** Leniently, as a file is read: the edges whose value is exactly `true`, or undefined when there are none. */
export function readDockSeeThrough(v: unknown): DockSeeThrough | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  const out: DockSeeThrough = {};
  for (const edge of PIN_EDGES) if (o[edge] === true) out[edge] = true;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** `d` with `edge` switched on or off; the field goes once no edge is on. */
export function withDockSeeThrough(d: Dashboard, edge: PinEdge, on: boolean): Dashboard {
  const { dockSeeThrough: _previous, ...rest } = d;
  const next = readDockSeeThrough({ ...d.dockSeeThrough, [edge]: on });
  return next ? { ...rest, dockSeeThrough: next } : rest;
}
```

In `src/lib/dashboardsFile.ts`:

1. After line 11 (`import { PIN_EDGES } from "./types";`) add:
   ```ts
   import { readDockSeeThrough } from "./dockSeeThrough";
   ```
2. In `type StoredDashboard`, after line 96 (`dockRows?: unknown;`) add:
   ```ts
     dockSeeThrough?: unknown;
   ```
3. In `withDefaults`, after the `const tabs = ...;` statement (ends line 147) add:
   ```ts
     const seeThrough = readDockSeeThrough(stored.dockSeeThrough);
   ```
   and after line 163 (`...(stored.dockRows !== undefined ? { dockRows: clampDockRows(stored.dockRows) } : {}),`) add:
   ```ts
       ...(seeThrough ? { dockSeeThrough: seeThrough } : {}),
   ```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm exec vitest run src/lib/dockSeeThrough.test.ts src/lib/dashboardsFile.test.ts src/lib/docksSync.test.ts`
Expected: PASS, `Test Files  3 passed (3)`.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0 with no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/dockSeeThrough.ts src/lib/dockSeeThrough.test.ts src/lib/dashboardsFile.ts src/lib/dashboardsFile.test.ts src/lib/docksSync.test.ts
git commit -m "feat: store the locked bands' see-through switch in the docks"
```
(End the message with your session's attribution trailer, as for every commit below.)

---

### Task 2: apps.json — Export locked widgets…, Export all, and every import door

**Files:**
- Modify: `src/lib/appsExtensionsV8.ts` (imports 7-11, `V8Docks` 25, `docksMember` 109-127, `exportV8` 138, `prepareV8` restore 245)
- Test: `src/lib/appsJson.cleanV8.test.ts` (append after the "an unreadable docks member is skipped…" test, line 243)

**Interfaces:**
- Consumes: `DockSeeThrough`, `readDockSeeThrough` (Task 1); `Dashboard.dockSeeThrough`.
- Produces: the apps.json v8 envelope's `docks` member becomes `{ rows: Record<PinEdge, number>; seeThrough?: { top?: true; bottom?: true } }`. `ImportResult.docks.dockSeeThrough` is set when the file had it.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/appsJson.cleanV8.test.ts` after the "an unreadable docks member is skipped…" test:

```ts
it('carries a see-through band in the docks member both ways, and writes no seeThrough while both are off', () => {
  const off = docksApp();
  expect(off.extensions.bdobb.docks).toEqual({ rows: { top: 4, bottom: 10 } });
  expect(importApps([off], []).docks).not.toHaveProperty('dockSeeThrough');
  const seeThrough: Dashboard = { ...lockedDocks(), dockSeeThrough: { bottom: true } };
  const result = exportCompatibleApp(seeThrough);
  if (!result.ok) throw new Error(result.issue.message);
  const app = JSON.parse(JSON.stringify(result.value));
  expect(app.extensions.bdobb.docks).toEqual({ rows: { top: 4, bottom: 10 }, seeThrough: { bottom: true } });
  expect(JSON.stringify(exportApp(seeThrough))).not.toMatch(/"dock|hidden|seeThrough/);
  expect(importApps([app], []).docks).toMatchObject({ id: DOCKS_ID, dockRows: { top: 4, bottom: 10 }, dockSeeThrough: { bottom: true } });
  app.extensions.bdobb.docks.seeThrough = {};
  expect(importApps([app], []).docks).not.toHaveProperty('dockSeeThrough');
});
it('an unreadable see-through member skips the docks, as an unreadable rows does', () => {
  for (const seeThrough of ['yes', { top: 1 }, { middle: true }, { bottom: false }, null]) {
    const app = docksApp();
    app.extensions.bdobb.docks = { rows: { top: 4, bottom: 10 }, seeThrough };
    const result = importApps([app], []);
    expect(result).not.toHaveProperty('docks');
    expect(result.dashboards.map(d => d.name)).toEqual(['Locked widgets']);
    expect(result.v8Skipped).toEqual([{ dashboardId: result.dashboards[0].id, all: false, cards: 0, docks: true }]);
  }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run src/lib/appsJson.cleanV8.test.ts`
Expected: FAIL — "carries a see-through band…" with `expected { rows: { top: 4, bottom: 10 } } to deeply equal { rows: …, seeThrough: { bottom: true } }`; "an unreadable see-through member…" passes already for every case (unknown key refused today) — that is expected and stays green after Step 3, now for the right reason.

- [ ] **Step 3: Implement**

In `src/lib/appsExtensionsV8.ts`:

1. After line 7 (`import { DOCKS_ID, clampDockRows, isDocks, makeDefaultDocks } from './dashboardsFile';`) add:
   ```ts
   import { readDockSeeThrough, type DockSeeThrough } from './dockSeeThrough';
   ```
2. Replace line 25:
   ```ts
   type V8Docks = { rows: Record<PinEdge, number> };
   ```
   with:
   ```ts
   /** `seeThrough`: the bands' See-through where empty, only the edges that are on, and only when one is. */
   type V8Docks = { rows: Record<PinEdge, number>; seeThrough?: DockSeeThrough };
   ```
3. In `docksMember`, replace line 113 (`keys(value, ['rows'], path);`) with:
   ```ts
     keys(value, ['rows', 'seeThrough'], path);
   ```
   and replace line 126 (`return { rows: clampDockRows(rows) };`) with:
   ```ts
     if (value.seeThrough === undefined) return { rows: clampDockRows(rows) };
     // As strict as `rows`: a record of the two edges, each exactly true. Empty reads as off.
     if (!isRecord(value.seeThrough)) extensionError(`${path}.seeThrough`, 'Invalid v8 docks see-through.');
     keys(value.seeThrough, PIN_EDGES, `${path}.seeThrough`);
     if (Object.values(value.seeThrough).some(on => on !== true)) extensionError(`${path}.seeThrough`, 'Invalid v8 docks see-through.');
     const seeThrough = readDockSeeThrough(value.seeThrough);
     return seeThrough ? { rows: clampDockRows(rows), seeThrough } : { rows: clampDockRows(rows) };
   ```
4. In `exportV8`, replace line 138:
   ```ts
       const docks = isDocks(dashboard) ? { docks: { rows: clampDockRows(dashboard.dockRows) } } : {};
   ```
   with:
   ```ts
       const seeThrough = readDockSeeThrough(dashboard.dockSeeThrough);
       const docks = isDocks(dashboard) ? { docks: { rows: clampDockRows(dashboard.dockRows), ...(seeThrough ? { seeThrough } : {}) } } : {};
   ```
5. In `prepareV8`'s restore, replace line 245:
   ```ts
         docks = { ...source, id: DOCKS_ID, name: base.name, hidden: true, tabs, dockRows: batch.docks.rows };
   ```
   with:
   ```ts
         docks = { ...source, id: DOCKS_ID, name: base.name, hidden: true, tabs, dockRows: batch.docks.rows, ...(batch.docks.seeThrough ? { dockSeeThrough: batch.docks.seeThrough } : {}) };
   ```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm exec vitest run src/lib/appsJson.cleanV8.test.ts src/lib/appsJson.test.ts`
Expected: PASS for both files. If `exportApp` (Strict OpenBB) leaks the field the regex assertion fails: `exportApp` must stay as it is — report, do not widen the test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/appsExtensionsV8.ts src/lib/appsJson.cleanV8.test.ts
git commit -m "feat: carry the see-through switch in the apps.json docks member"
```

---

### Task 3: The store action

**Files:**
- Modify: `src/stores/dashboardStore.ts` (import after line 27, type after line 97, action after line 1618)
- Test: `src/stores/dashboardStore.docks.test.ts` (append after the "viewer window: beginDockEdit no-ops…" test, line 199), `src/stores/dashboardRevision.test.ts:101`

**Interfaces:**
- Consumes: `withDockSeeThrough(d, edge, on)` (Task 1).
- Produces: `useDashboardStore.getState().setDockSeeThrough(edge: PinEdge, on: boolean): Promise<void>` — a docks edit through `mutateDashboard` (new revision, written; in the viewer, memory only).

- [ ] **Step 1: Write the failing tests**

Append to `src/stores/dashboardStore.docks.test.ts`, inside `describe("the docks in the store")`:

```ts
  it("setDockSeeThrough turns one edge on and off as a docks edit, and off leaves no field on disk", async () => {
    await store().load();
    const before = store().docks.revision ?? 0;
    await store().setDockSeeThrough("bottom", true);
    expect(store().docks.dockSeeThrough).toEqual({ bottom: true });
    expect(store().docks.revision ?? 0).toBeGreaterThan(before);
    expect(JSON.parse(__read("dashboards/docks.json")!).dockSeeThrough).toEqual({ bottom: true });
    await store().setDockSeeThrough("bottom", false);
    expect(store().docks).not.toHaveProperty("dockSeeThrough");
    expect(__read("dashboards/docks.json")).not.toContain("dockSeeThrough");
  });

  it("Cancel puts the switch back with the rest of the edit, and the viewer writes nothing", async () => {
    await store().load();
    store().beginDockEdit("top");
    await store().setDockSeeThrough("top", true);
    await store().cancelDockEdit();
    expect(store().docks).not.toHaveProperty("dockSeeThrough");
    useDashboardStore.setState({ viewer: true });
    const writes = docksWrites();
    await store().setDockSeeThrough("top", true);
    expect(docksWrites()).toEqual(writes);
  });
```

In `src/stores/dashboardRevision.test.ts`, replace line 101:

```ts
const DOCKS = ["beginDockEdit", "cancelDockEdit", "commitDockEdit", "setDockRows", "applySyncedDocks", "importDocks"] as const;
```

with:

```ts
const DOCKS = ["beginDockEdit", "cancelDockEdit", "commitDockEdit", "setDockRows", "setDockSeeThrough", "applySyncedDocks", "importDocks"] as const;
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run src/stores/dashboardStore.docks.test.ts src/stores/dashboardRevision.test.ts`
Expected: FAIL — the two new tests with `TypeError: store(...).setDockSeeThrough is not a function`; "classifies every function the store exposes" with the expected list holding `setDockSeeThrough` and the store's not.

- [ ] **Step 3: Implement**

In `src/stores/dashboardStore.ts`:

1. After line 27 (`import { firstFreeSpot } from "../lib/dockLayout";`) add:
   ```ts
   import { withDockSeeThrough } from "../lib/dockSeeThrough";
   ```
2. After line 97 (`setDockRows: (edge: PinEdge, rows: number) => Promise<void>;`) add:
   ```ts
     /** Settings ▸ Locked Widgets ▸ See-through where empty for `edge`; off removes it (lib/dockSeeThrough.ts). */
     setDockSeeThrough: (edge: PinEdge, on: boolean) => Promise<void>;
   ```
3. After the `setDockRows` action's closing `},` (line 1618), before `importDocks: async (incoming) => {`, add:
   ```ts
       setDockSeeThrough: async (edge, on) => {
         await mutateDashboard(DOCKS_ID, (d) => withDockSeeThrough(d, edge, on));
       },

   ```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm exec vitest run src/stores/dashboardStore.docks.test.ts src/stores/dashboardRevision.test.ts src/stores/dashboardStore.test.ts`
Expected: PASS for all three files.

- [ ] **Step 5: Commit**

```bash
git add src/stores/dashboardStore.ts src/stores/dashboardStore.docks.test.ts src/stores/dashboardRevision.test.ts
git commit -m "feat: setDockSeeThrough writes the see-through switch as a docks edit"
```

---

### Task 4: The editor's "See-through where empty" switch

**Files:**
- Modify: `src/components/DockBand.tsx` (`DockEditor`, 195-248)
- Modify: `src/styles.css` (after line 1634, `.dock-edit-rows`)
- Create: `src/components/DockBand.seeThrough.test.tsx`

**Interfaces:**
- Consumes: `setDockSeeThrough` (Task 3); `Dashboard.dockSeeThrough` (Task 1).
- Produces: `src/components/DockBand.seeThrough.test.tsx` with the shared helpers later tasks append to: `docksBoth()`, `seeThrough(edges)`, `windowHeight(px)`, `css`.

- [ ] **Step 1: Write the failing test**

Create `src/components/DockBand.seeThrough.test.tsx`:

```tsx
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// See-through locked bands (docs/superpowers/specs/2026-11-12-see-through-locked-bands-design.md).
// jsdom lays nothing out and styles.css is not in the test build (`css:
// false`), so the layout is asserted as classes, published properties and
// the CSS file's text; e2e/see-through.spec.ts measures it in a real engine.
import { readFileSync } from "node:fs";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/plotly", () => ({
  renderPlot: () => Promise.resolve(),
  purgePlot: () => {},
  REGISTERED_TRACE_TYPES: new Set(["scatter", "candlestick"]),
}));
// The real grid measures a container jsdom cannot lay out.
vi.mock("react-grid-layout", () => ({
  default: function MockGrid({ children }: { children: React.ReactNode }) {
    return <div data-testid="grid">{children}</div>;
  },
  WidthProvider: (Component: unknown) => Component,
}));

import { makeDefaultDocks } from "../lib/dashboardsFile";
import type { DockSeeThrough } from "../lib/dockSeeThrough";
import { __resetLoggerForTests } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import type { Dashboard } from "../lib/types";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { useWorkspacesStore } from "../stores/workspacesStore";
import { card as makeCard, widget as makeWidget } from "../test/fixtures";
import { __reset as __resetFs } from "../test/memfs";
import { DockEditor } from "./DockBand";

const css = readFileSync("src/styles.css", "utf8");

/** A card on each edge: 6 rows on top (180px band), 8 at the bottom (240px). */
function docksBoth(): Dashboard {
  const docks = makeDefaultDocks();
  return {
    ...docks,
    tabs: [
      { ...docks.tabs[0], cards: [makeCard({ id: "top1", widgetId: "w1", layout: { x: 0, y: 0, w: 20, h: 6 } })] },
      { ...docks.tabs[1], cards: [makeCard({ id: "bot1", widgetId: "w1", layout: { x: 20, y: 0, w: 20, h: 8 } })] },
    ],
  };
}

function seeThrough(edges: DockSeeThrough) {
  useDashboardStore.setState((s) => ({ docks: { ...s.docks, dockSeeThrough: edges } }));
}

function windowHeight(px: number) {
  Object.defineProperty(window, "innerHeight", { value: px, configurable: true });
  window.dispatchEvent(new Event("resize"));
}

beforeEach(() => {
  windowHeight(1200);
  __resetLoggerForTests();
  __resetFs();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  useWidgetRegistryStore.setState({ widgets: [makeWidget({ id: "w1", name: "Price History", endpoint: "equity/price" })] });
  useWorkspacesStore.setState({ activeWorkspaceId: null });
  useDashboardStore.setState({
    docks: docksBoth(),
    dockEdit: null,
    maximizedCardId: null,
    viewer: false,
    activeId: "d1",
    activeTabId: "t1",
    activeTabIds: { d1: "t1" },
  });
});

describe("DockEditor's See-through where empty switch", () => {
  it("is off by default, turns its edge on and off, and Cancel restores it", async () => {
    useDashboardStore.getState().beginDockEdit("bottom");
    render(<DockEditor onOpenLibrary={() => {}} />);
    const toggle = screen.getByRole("switch", { name: "See-through where empty" });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(useDashboardStore.getState().docks.dockSeeThrough).toEqual({ bottom: true }));
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(useDashboardStore.getState().docks).not.toHaveProperty("dockSeeThrough"));
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(useDashboardStore.getState().dockEdit).toBeNull());
    expect(useDashboardStore.getState().docks).not.toHaveProperty("dockSeeThrough");
  });

  it("shows the edited edge's own switch", () => {
    seeThrough({ top: true });
    useDashboardStore.getState().beginDockEdit("bottom");
    render(<DockEditor onOpenLibrary={() => {}} />);
    expect(screen.getByRole("switch", { name: "See-through where empty" })).not.toBeChecked();
  });
});

// Later tasks append below; these keep the imports used until they do.
void act;
void css;
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run src/components/DockBand.seeThrough.test.tsx`
Expected: FAIL — both tests with `Unable to find an accessible element with the role "switch" and name "See-through where empty"`.

- [ ] **Step 3: Implement**

In `src/components/DockBand.tsx`, `DockEditor`:

1. After line 200 (`const setDockRows = useDashboardStore((s) => s.setDockRows);`) add:
   ```tsx
     const seeThrough = useDashboardStore((s) => edge !== null && s.docks.dockSeeThrough?.[edge] === true);
     const setDockSeeThrough = useDashboardStore((s) => s.setDockSeeThrough);
   ```
2. After the rows stepper's closing `</span>` (line 241), before the Cancel `<button>`, add:
   ```tsx
           {/* Empty band space shows and takes the dashboard; the dashboard
               gains scroll room at this edge (DockBand, useFloatingBand). */}
           <label className="dock-edit-see-through">
             <input
               type="checkbox"
               role="switch"
               checked={seeThrough}
               onChange={(e) => report(edge, setDockSeeThrough(edge, e.target.checked), "see-through")}
             />
             See-through where empty
           </label>
   ```

In `src/styles.css`, after line 1634 (`.dock-edit-rows { … }`) add:

```css
.dock-edit-see-through { display: inline-flex; align-items: center; gap: 4px; }
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm exec vitest run src/components/DockBand.seeThrough.test.tsx src/components/DockBand.test.tsx`
Expected: PASS for both files.

- [ ] **Step 5: Commit**

```bash
git add src/components/DockBand.tsx src/components/DockBand.seeThrough.test.tsx src/styles.css
git commit -m "feat: See-through where empty switch in the Locked Widgets editor"
```

---

### Task 5: The band's mode and the floating layout

**Files:**
- Modify: `src/lib/dockSeeThrough.ts` (append `bandFloats`)
- Create: `src/hooks/useFloatingBand.ts`
- Modify: `src/components/DockBand.tsx` (imports 4-12, `DockBand` 148-176)
- Modify: `src/App.tsx:204-207` (`dockTopKey`)
- Modify: `src/styles.css` (after line 1622, `.dock-band-maximized { z-index: 20; }`)
- Test: `src/lib/dockSeeThrough.test.ts`, `src/components/DockBand.seeThrough.test.tsx`

**Interfaces:**
- Consumes: `Dashboard.dockSeeThrough` (Task 1); `useWorkspacesStore` (`activeWorkspaceId: string | null`, `src/stores/workspacesStore.ts:183`).
- Produces:
  - `export function bandFloats(o: { seeThrough: boolean; capped: boolean; workspace: boolean }): boolean`
  - `export function useFloatingBand(ref: RefObject<HTMLElement | null>, edge: PinEdge, px: number | null): void` — while `px` is a number, `--dock-room-<edge>: <px>px` is set on the band's closest `.dashboard-area`; removed when `px` goes null or the band unmounts. Task 6 adds the opening scroll to this hook.
  - The live band's class `dock-band-float` while it floats.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/dockSeeThrough.test.ts` (and add `bandFloats` to its import from `./dockSeeThrough`):

```ts
describe("a band's mode", () => {
  it("floats only with its switch on, uncapped by the window, and outside a workspace", () => {
    expect(bandFloats({ seeThrough: true, capped: false, workspace: false })).toBe(true);
    expect(bandFloats({ seeThrough: false, capped: false, workspace: false })).toBe(false);
    expect(bandFloats({ seeThrough: true, capped: true, workspace: false })).toBe(false);
    expect(bandFloats({ seeThrough: true, capped: false, workspace: true })).toBe(false);
  });
});
```

In `src/components/DockBand.seeThrough.test.tsx`: change `import { DockEditor } from "./DockBand";` to `import { DockBand, DockEditor } from "./DockBand";`, add `import type { PinEdge } from "../lib/types";` beside the other type import, delete the two `void` lines at the bottom, and append:

```tsx
/** The band in the area's column with a scroll region after it, as App and DashboardGrid lay them out. */
function inArea(edge: PinEdge, viewer = false) {
  const tree = () => (
    <main className="dashboard-area">
      <DockBand edge={edge} viewer={viewer} />
      <div className="dashboard-scroll" data-testid="scroll" />
    </main>
  );
  const view = render(tree());
  return {
    area: screen.getByRole("main"),
    band: () => document.querySelector<HTMLElement>(`.dock-band-${edge}`),
    rerender: () => view.rerender(tree()),
  };
}

describe("a see-through band", () => {
  it("is today's band while its switch is off: no float class, nothing published on the area", () => {
    const { area, band } = inArea("bottom");
    expect(band()).not.toHaveClass("dock-band-float");
    expect(band()?.style.height).toBe("240px");
    expect(area.getAttribute("style")).toBeNull();
  });

  it("floats with its switch on, and publishes its height on the area", () => {
    seeThrough({ bottom: true });
    const { area, band } = inArea("bottom");
    expect(band()).toHaveClass("dock-band-float");
    expect(band()?.style.height).toBe("240px");
    expect(area.style.getPropertyValue("--dock-room-bottom")).toBe("240px");
    expect(area.style.getPropertyValue("--dock-room-top")).toBe("");
  });

  it("is an ordinary band while the window caps it, and floats again once it fits", () => {
    useDashboardStore.setState({ docks: { ...docksBoth(), dockRows: { top: 6, bottom: 24 }, dockSeeThrough: { bottom: true } } });
    const { area, band } = inArea("bottom");
    expect(band()).toHaveClass("dock-band-float");
    act(() => windowHeight(768));
    expect(band()).not.toHaveClass("dock-band-float");
    expect(band()?.style.overflowY).toBe("auto");
    expect(area.style.getPropertyValue("--dock-room-bottom")).toBe("");
    act(() => windowHeight(1200));
    expect(band()).toHaveClass("dock-band-float");
  });

  it("is an ordinary band while a workspace is shown, and floats again on leaving it", () => {
    seeThrough({ bottom: true });
    useWorkspacesStore.setState({ activeWorkspaceId: "w1" });
    const { band } = inArea("bottom");
    expect(band()).not.toHaveClass("dock-band-float");
    act(() => useWorkspacesStore.setState({ activeWorkspaceId: null }));
    expect(band()).toHaveClass("dock-band-float");
  });

  it("floats in a viewer window whatever the workspace store holds", () => {
    seeThrough({ bottom: true });
    useWorkspacesStore.setState({ activeWorkspaceId: "w1" });
    const { band } = inArea("bottom", true);
    expect(band()).toHaveClass("dock-band-float");
  });

  it("leaves nothing on the area while its edge is being edited", () => {
    seeThrough({ bottom: true });
    const { area } = inArea("bottom");
    act(() => useDashboardStore.getState().beginDockEdit("bottom"));
    expect(area.style.getPropertyValue("--dock-room-bottom")).toBe("");
  });
});

describe("styles.css for see-through bands", () => {
  it("lays a .dock-band-float band over the scroll region's end, below the tab bar and inside a tab's pinned card", () => {
    for (const rule of [
      ".dashboard-area:has(> .dashboard-scroll):has(> .dock-band-float) > .dashboard-scroll { order: 1; }",
      ".dashboard-area:has(> .dashboard-scroll):has(> .dock-band-float) > .card-dock-bottom { order: 1; }",
      ".dashboard-area:has(> .dashboard-scroll):has(> .dock-band-float) > .dock-band-bottom { order: 1; }",
      ".dashboard-area:has(> .dashboard-scroll) > .dock-band-top.dock-band-float { order: 1; margin-bottom: calc(-1 * var(--dock-room-top, 0px)); }",
      ".dashboard-area:has(> .dashboard-scroll):has(> .dock-band-bottom.dock-band-float) > .card-dock-bottom { order: 2; }",
      ".dashboard-area:has(> .dashboard-scroll) > .dock-band-bottom.dock-band-float { margin-top: calc(-1 * var(--dock-room-bottom, 0px)); }",
      ".dashboard-area:has(> .dashboard-scroll) > .dock-band.dock-band-float { background: none; border: 0; }",
    ]) {
      expect(css).toContain(rule);
    }
  });

  it("changes nothing for a band that is not see-through: every rule that floats or reads the room names .dock-band-float", () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/[^{}]+\{[^{}]*\}/g) ?? [];
    const floating = rules.filter((r) => r.includes("dock-band-float") || r.includes("--dock-room"));
    expect(floating.length).toBeGreaterThan(0);
    for (const rule of floating) expect(rule.slice(0, rule.indexOf("{"))).toContain("dock-band-float");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run src/lib/dockSeeThrough.test.ts src/components/DockBand.seeThrough.test.tsx`
Expected: FAIL — `bandFloats is not a function` (or an import error naming `bandFloats`); "floats with its switch on…", "…once it fits", "…on leaving it", "…viewer window…" with `expected element to have class "dock-band-float"`; the first styles.css test with `expected '…' to contain '.dashboard-area:has(…'`; the second with `expected 0 to be greater than 0`.

- [ ] **Step 3: Implement the mode and the hook**

Append to `src/lib/dockSeeThrough.ts`:

```ts
/**
 * Whether a band with cards, not being edited, floats over the dashboard.
 * A band capped by the window scrolls its own rows, which a band that passes
 * scrolling through cannot also do; a workspace has no one scroll region to
 * give the room to (each tile scrolls its own). Either way the band is the
 * ordinary opaque strip until that changes.
 */
export function bandFloats(o: { seeThrough: boolean; capped: boolean; workspace: boolean }): boolean {
  return o.seeThrough && !o.capped && !o.workspace;
}
```

Create `src/hooks/useFloatingBand.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useLayoutEffect, type RefObject } from "react";
import type { PinEdge } from "../lib/types";

/**
 * A see-through locked band's effect on the dashboard area it floats in
 * (spec 2026-11-12-see-through-locked-bands): its height, published on the
 * area as --dock-room-top / --dock-room-bottom. styles.css reads it as the
 * band's negative margin, which takes the band out of the column, and as the
 * scroll region's extra room at that end. `px` is null while the band does
 * not float, and then nothing is published. A layout effect, so the first
 * painted frame already has the band floating.
 */
export function useFloatingBand(ref: RefObject<HTMLElement | null>, edge: PinEdge, px: number | null): void {
  useLayoutEffect(() => {
    const area = ref.current?.closest<HTMLElement>(".dashboard-area");
    if (!area || px === null) return;
    const name = `--dock-room-${edge}`;
    area.style.setProperty(name, `${px}px`);
    return () => area.style.removeProperty(name);
  }, [ref, edge, px]);
}
```

- [ ] **Step 4: Implement the band**

In `src/components/DockBand.tsx`:

1. Replace line 4 (`import { useEffect, useSyncExternalStore } from "react";`) with:
   ```tsx
   import { useEffect, useRef, useSyncExternalStore } from "react";
   ```
2. After line 6 (`import { DEFAULT_DOCK_ROWS, … } from "../lib/dashboardsFile";`) add:
   ```tsx
   import { bandFloats } from "../lib/dockSeeThrough";
   import { useFloatingBand } from "../hooks/useFloatingBand";
   ```
3. After line 10 (`import { selectEffective, useSettingsStore } from "../stores/settingsStore";`) add:
   ```tsx
   import { useWorkspacesStore } from "../stores/workspacesStore";
   ```
4. In `DockBand`, after line 158 (`const shown = Math.min(rows, useFitRows(edge, widgetGap));`) add:
   ```tsx
     // See-through where empty (lib/dockSeeThrough.ts). A viewer window shows no workspace.
     const seeThrough = useDashboardStore((s) => s.docks.dockSeeThrough?.[edge] === true);
     const workspace = useWorkspacesStore((s) => s.activeWorkspaceId !== null);
     const floats = !editing && count > 0 && bandFloats({ seeThrough, capped: shown < rows, workspace: workspace && !viewer });
     const ref = useRef<HTMLElement>(null);
     useFloatingBand(ref, edge, floats ? bandHeight(shown, widgetGap) : null);
   ```
5. In the returned `<section`, add `ref={ref}` as its first prop, and replace line 167:
   ```tsx
         className={`dock-band dock-band-${edge}${hasMaximized ? " dock-band-maximized" : ""}`}
   ```
   with:
   ```tsx
         className={`dock-band dock-band-${edge}${floats ? " dock-band-float" : ""}${hasMaximized ? " dock-band-maximized" : ""}`}
   ```

In `src/App.tsx`, replace line 206:

```tsx
      `${s.docks.tabs.find((t) => t.id === "top")?.cards.length ?? 0}:${s.docks.dockRows?.top ?? ""}:${s.dockEdit?.edge === "top"}`,
```

with (a floating top band no longer pushes the tab bar down, and a synced switch moves the bar without resizing it):

```tsx
      `${s.docks.tabs.find((t) => t.id === "top")?.cards.length ?? 0}:${s.docks.dockRows?.top ?? ""}:${s.dockEdit?.edge === "top"}:${s.docks.dockSeeThrough?.top === true}`,
```

- [ ] **Step 5: Implement the CSS**

In `src/styles.css`, after line 1622 (`.dock-band-maximized { z-index: 20; }`) add:

```css
/* See-through locked bands (Settings ▸ Locked Widgets ▸ See-through where
   empty). DockBand adds .dock-band-float while the switch is on, the band
   fits the window and no workspace is shown (lib/dockSeeThrough.ts), and
   useFloatingBand publishes the band's height on the area as
   --dock-room-top / --dock-room-bottom. Only over a dashboard's own scroll
   region: an area without one (no dashboard, no tab) keeps the column.
   The band leaves the column -- a negative margin as tall as itself -- and
   lies over the scroll region's end. `order` moves a floating top band after
   the tab bar and a tab's pinned top card, and a floating bottom band before
   a tab's pinned bottom card, so neither is covered; the DOM order, and so
   the bands' mount-once guarantee, is untouched. No background, no border
   line. Each rule names .dock-band-float, so an ordinary band is unchanged. */
.dashboard-area:has(> .dashboard-scroll):has(> .dock-band-float) > .dashboard-scroll { order: 1; }
.dashboard-area:has(> .dashboard-scroll):has(> .dock-band-float) > .card-dock-bottom { order: 1; }
.dashboard-area:has(> .dashboard-scroll):has(> .dock-band-float) > .dock-band-bottom { order: 1; }
.dashboard-area:has(> .dashboard-scroll) > .dock-band-top.dock-band-float { order: 1; margin-bottom: calc(-1 * var(--dock-room-top, 0px)); }
.dashboard-area:has(> .dashboard-scroll):has(> .dock-band-bottom.dock-band-float) > .card-dock-bottom { order: 2; }
.dashboard-area:has(> .dashboard-scroll) > .dock-band-bottom.dock-band-float { margin-top: calc(-1 * var(--dock-room-bottom, 0px)); }
.dashboard-area:has(> .dashboard-scroll) > .dock-band.dock-band-float { background: none; border: 0; }
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm exec vitest run src/lib/dockSeeThrough.test.ts src/components/DockBand.seeThrough.test.tsx src/components/DockBand.test.tsx src/App.test.tsx`
Expected: PASS for all four files. `DockBand.test.tsx` and `App.test.tsx` are unchanged and must stay green: they pin today's band height, `overflowY`, the band-before-bar DOM order and `--dashboard-top`.

- [ ] **Step 7: Lint and typecheck**

Run: `pnpm typecheck && pnpm exec eslint src/components/DockBand.tsx src/hooks/useFloatingBand.ts src/lib/dockSeeThrough.ts src/App.tsx src/components/DockBand.seeThrough.test.tsx`
Expected: both exit 0 with no output.

- [ ] **Step 8: Commit**

```bash
git add src/lib/dockSeeThrough.ts src/lib/dockSeeThrough.test.ts src/hooks/useFloatingBand.ts src/components/DockBand.tsx src/components/DockBand.seeThrough.test.tsx src/App.tsx src/styles.css
git commit -m "feat: a see-through locked band floats over the dashboard's scroll region"
```

---

### Task 6: Scroll room and the opening scroll position

**Files:**
- Modify: `src/hooks/useFloatingBand.ts`
- Modify: `src/styles.css` (directly after the Task 5 block)
- Test: `src/components/DockBand.seeThrough.test.tsx`

**Interfaces:**
- Consumes: `useFloatingBand(ref, edge, px)` (Task 5); store fields `activeId: string | null`, `activeTabId: string | null`, `activeTabIds: Record<string, string>` (`src/stores/dashboardStore.ts:120-124`).
- Produces: while the top band floats, the area's `:scope > .dashboard-scroll` has `scrollTop = px` after the band starts floating and after each change of `activeId`, `activeTabId` or `activeTabIds`; at no other time. The bottom band never sets `scrollTop`.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/DockBand.seeThrough.test.tsx`:

```tsx
/** jsdom keeps no scroll position of its own: record what the hook writes. */
function scrollTopOf(el: HTMLElement) {
  const box = { top: 0 };
  Object.defineProperty(el, "scrollTop", { configurable: true, get: () => box.top, set: (v: number) => { box.top = v; } });
  return box;
}

describe("the room under a see-through top band", () => {
  it("opens the dashboard scrolled past it, on each dashboard or tab switch, and never on an unrelated render", () => {
    const { band, rerender } = inArea("top");
    const scroll = scrollTopOf(screen.getByTestId("scroll"));
    expect(scroll.top).toBe(0);
    act(() => seeThrough({ top: true }));
    expect(band()).toHaveClass("dock-band-float");
    expect(scroll.top).toBe(180);
    scroll.top = 40; // the user scrolls
    rerender();
    act(() => useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "light" } }));
    act(() => useDashboardStore.setState({ maximizedCardId: "nobody" }));
    expect(scroll.top).toBe(40);
    act(() => useDashboardStore.setState({ activeTabId: "t2", activeTabIds: { d1: "t2" } }));
    expect(scroll.top).toBe(180);
    scroll.top = 40;
    act(() => useDashboardStore.setState({ activeId: "d2" }));
    expect(scroll.top).toBe(180);
  });

  it("a bottom band, and a top band that is not see-through, never move the scroll position", () => {
    seeThrough({ bottom: true });
    const { rerender } = inArea("top");
    const scroll = scrollTopOf(screen.getByTestId("scroll"));
    rerender();
    act(() => useDashboardStore.setState({ activeId: "d2" }));
    expect(scroll.top).toBe(0);
  });
});

describe("styles.css: the scroll room", () => {
  it("pads the region's floating ends by the band's height, and keeps the grid tall enough to open past a top band's room", () => {
    expect(css).toContain(
      ".dashboard-area:has(> .dashboard-scroll):has(> .dock-band-float) > .dashboard-scroll { padding-top: var(--dock-room-top, 0px); padding-bottom: var(--dock-room-bottom, 0px); }",
    );
    expect(css).toContain(
      ".dashboard-area:has(> .dashboard-scroll):has(> .dock-band-float) > .dashboard-scroll > .react-grid-layout { min-height: calc(100% + var(--dock-room-top, 0px)); }",
    );
  });
});
```

(The second test renders a top band whose own switch is off while the bottom's is on — the top band is the one holding the hook's scroll step.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run src/components/DockBand.seeThrough.test.tsx`
Expected: FAIL — "opens the dashboard scrolled past it…" with `expected 0 to be 180`; the styles.css room test with `expected '…' to contain '…padding-top: var(--dock-room-top, 0px)…'`. "…never move the scroll position" passes already (nothing scrolls yet) and must stay green.

- [ ] **Step 3: Implement the opening scroll**

Replace `src/hooks/useFloatingBand.ts`'s body so the file reads:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useLayoutEffect, type RefObject } from "react";
import type { PinEdge } from "../lib/types";
import { useDashboardStore } from "../stores/dashboardStore";

/**
 * A see-through locked band's effects on the dashboard area it floats in
 * (spec 2026-11-12-see-through-locked-bands). Its height, published on the
 * area as --dock-room-top / --dock-room-bottom: styles.css reads it as the
 * band's negative margin, which takes the band out of the column, and as the
 * scroll region's extra room at that end. And for the top band, the region
 * opened scrolled past that room, so at rest the dashboard's first rows sit
 * under the band and scrolling up brings them clear of it.
 *
 * Nothing saves or restores a dashboard's scroll today: the one
 * .dashboard-scroll element is reused across dashboard and tab switches and
 * keeps its scrollTop. So "opening" is exactly when the band starts floating
 * and when the dashboard or tab on screen changes -- the deps below -- and
 * never another render, which would undo the user's own scrolling. `px` is
 * null while the band does not float, and then nothing is published or
 * scrolled. Layout effects, so the first painted frame is already right.
 */
export function useFloatingBand(ref: RefObject<HTMLElement | null>, edge: PinEdge, px: number | null): void {
  const activeId = useDashboardStore((s) => s.activeId);
  const activeTabId = useDashboardStore((s) => s.activeTabId);
  const activeTabIds = useDashboardStore((s) => s.activeTabIds);

  useLayoutEffect(() => {
    const area = ref.current?.closest<HTMLElement>(".dashboard-area");
    if (!area || px === null) return;
    const name = `--dock-room-${edge}`;
    area.style.setProperty(name, `${px}px`);
    return () => area.style.removeProperty(name);
  }, [ref, edge, px]);

  useLayoutEffect(() => {
    if (edge !== "top" || px === null) return;
    const scroll = ref.current?.closest(".dashboard-area")?.querySelector<HTMLElement>(":scope > .dashboard-scroll");
    if (scroll) scroll.scrollTop = px;
  }, [ref, edge, px, activeId, activeTabId, activeTabIds]);
}
```

- [ ] **Step 4: Implement the room**

In `src/styles.css`, directly after the Task 5 block's last rule (`… > .dock-band.dock-band-float { background: none; border: 0; }`), add:

```css
/* The room: the region pads each floating end by that band's height, so its
   last cards scroll up clear of a bottom band and its first cards down clear
   of a top one. The grid is kept at least the region's height plus a top
   band's room, so even a short tab can open scrolled past that room
   (useFloatingBand) instead of sitting part-way down under the band. */
.dashboard-area:has(> .dashboard-scroll):has(> .dock-band-float) > .dashboard-scroll { padding-top: var(--dock-room-top, 0px); padding-bottom: var(--dock-room-bottom, 0px); }
.dashboard-area:has(> .dashboard-scroll):has(> .dock-band-float) > .dashboard-scroll > .react-grid-layout { min-height: calc(100% + var(--dock-room-top, 0px)); }
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm exec vitest run src/components/DockBand.seeThrough.test.tsx src/components/DockBand.test.tsx src/components/DashboardGrid.test.tsx src/App.test.tsx`
Expected: PASS for all four files.

- [ ] **Step 6: Lint**

Run: `pnpm exec eslint src/hooks/useFloatingBand.ts src/components/DockBand.seeThrough.test.tsx`
Expected: exits 0 with no output. If `react-hooks/exhaustive-deps` reports `activeId`, `activeTabId` or `activeTabIds` as unnecessary, keep them (they are the trigger, by design) and add `// eslint-disable-next-line react-hooks/exhaustive-deps -- the dashboard and tab on screen are the trigger, not inputs` on the deps line; report it in the task summary.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useFloatingBand.ts src/styles.css src/components/DockBand.seeThrough.test.tsx
git commit -m "feat: scroll room at a see-through band's end, opening past a top band's room"
```

---

### Task 7: Pointer pass-through

**Files:**
- Modify: `src/styles.css` (directly after the Task 6 block)
- Test: `src/components/DockBand.seeThrough.test.tsx`

**Interfaces:**
- Consumes: `.dock-band-float` (Task 5).
- Produces: empty space of a floating band is not a hit-test target; its `.react-grid-item` cards are.

react-grid-layout note (settled by reading): the live band's grid has `isDraggable` and `isResizable` false (`DockBand.tsx:114-115`, `editing={false}` at 173), so it registers no drag or resize of its own; the editor's grid is a different element, `.dock-canvas` inside `.dock-editor` (`DockBand.tsx:256-266`), and the live band of the edited edge is unmounted while it is edited (`DockBand.tsx:160`). The rules below can therefore never reach a card or handle in the editor.

- [ ] **Step 1: Write the failing test**

Append to `src/components/DockBand.seeThrough.test.tsx`:

```tsx
describe("styles.css: pointer pass-through", () => {
  it("lets empty band space through and keeps the locked cards' pointer, never touching the editor's canvas", () => {
    expect(css).toContain(".dashboard-area:has(> .dashboard-scroll) > .dock-band-float { pointer-events: none; }");
    expect(css).toContain(".dashboard-area:has(> .dashboard-scroll) > .dock-band-float .react-grid-item { pointer-events: auto; }");
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/[^{}]+\{[^{}]*\}/g) ?? [];
    expect(rules.filter((r) => r.includes("dock-canvas") && r.includes("pointer-events"))).toEqual([]);
  });

  it("the editor's canvas is not a band, so it cannot be a see-through one", () => {
    seeThrough({ bottom: true });
    useDashboardStore.getState().beginDockEdit("bottom");
    render(<DockEditor onOpenLibrary={() => {}} />);
    expect(document.querySelector(".dock-canvas")).not.toHaveClass("dock-band");
    expect(document.querySelector(".dock-band-float")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run src/components/DockBand.seeThrough.test.tsx`
Expected: FAIL — "lets empty band space through…" with `expected '…' to contain '.dashboard-area:has(> .dashboard-scroll) > .dock-band-float { pointer-events: none; }'`. "the editor's canvas is not a band…" passes already and must stay green.

- [ ] **Step 3: Implement**

In `src/styles.css`, directly after the Task 6 block, add:

```css
/* Empty band space is the dashboard's: a click, a drag, the wheel and a
   finger's pan go to the region under it. Only the locked cards take the
   pointer, so their own controls, menus and scrolling work as before. The
   live band's grid is locked and has no drag or resize to lose; the editor's
   canvas (.dock-canvas) is another element and is untouched. */
.dashboard-area:has(> .dashboard-scroll) > .dock-band-float { pointer-events: none; }
.dashboard-area:has(> .dashboard-scroll) > .dock-band-float .react-grid-item { pointer-events: auto; }
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm exec vitest run src/components/DockBand.seeThrough.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/styles.css src/components/DockBand.seeThrough.test.tsx
git commit -m "feat: empty see-through band space passes the pointer to the dashboard"
```

---

### Task 8: Browser geometry spec (written here, run by the release walk)

**Files:**
- Create: `e2e/see-through.spec.ts`

**Interfaces:**
- Consumes: `seedApp`, `MOCK_URL`, `SeedFiles` from `e2e/fixtures.ts`; the builtin `note` widget; everything from Tasks 1-7.
- Produces: the layout tests the spec's Testing section asks for, in a real engine.

Do NOT run this file: Playwright belongs to the release walk. Typecheck it only.

- [ ] **Step 1: Write the spec**

Create `e2e/see-through.spec.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// See-through locked bands (docs/superpowers/specs/2026-11-12-see-through-locked-bands-design.md):
// the geometry jsdom cannot lay out -- the scroll region under the band, the
// room at each end, the opening scroll under a top band, the pointer through
// empty band space, a pinned card beside the band, and the capped fallback.
import { expect, test, type Page } from "@playwright/test";
import { MOCK_URL, seedApp, type SeedFiles } from "./fixtures";

type Card = Record<string, unknown>;
const note = (id: string, y: number, over: Card = {}): Card => ({
  id, widgetId: "note", backendId: "builtin", params: {}, title: id, layout: { x: 0, y, w: 40, h: 10 }, ...over,
});
/** 30 rows of cards: taller than the 720px window, so the region scrolls. */
const tall = (p: string) => [note(`${p}-first`, 0), note(`${p}-middle`, 10), note(`${p}-last`, 20)];
/** A locked card on the band's right half; the left half is the empty space. */
const locked = (id: string, h: number): Card => ({
  id, widgetId: "note", backendId: "builtin", params: {}, title: "Locked", layout: { x: 20, y: 0, w: 20, h },
});

type Locked = { top?: Card[]; bottom?: Card[]; dockRows?: { top: number; bottom: number }; dockSeeThrough?: { top?: true; bottom?: true } };
function seed(bands: Locked, t1: Card[] = tall("a"), t2: Card[] = tall("b")): SeedFiles {
  const { top = [], bottom = [], dockRows = { top: 6, bottom: 8 }, dockSeeThrough } = bands;
  return {
    "settings.json": "{}",
    "backends.json": JSON.stringify([{ id: "b1", name: "Mock", baseUrl: MOCK_URL, authLocation: "header", validateWidgets: false }]),
    "dashboards/d1.json": JSON.stringify({ id: "d1", name: "Alpha", tabs: [{ id: "t1", name: "Main", cards: t1 }, { id: "t2", name: "Other", cards: t2 }] }),
    "dashboards/docks.json": JSON.stringify({
      id: "docks", name: "Locked widgets", hidden: true, dockRows,
      ...(dockSeeThrough ? { dockSeeThrough } : {}),
      tabs: [{ id: "top", name: "Locked at Top", cards: top }, { id: "bottom", name: "Locked at Bottom", cards: bottom }],
    }),
  };
}

const scroll = (page: Page) => page.locator("main.dashboard-area > .dashboard-scroll");
const card = (page: Page, title: string) => page.locator(".dashboard-scroll .react-grid-item", { hasText: title });
/** Whether the point hits the dashboard's scroll region rather than a band. */
const hitsDashboard = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest(".dashboard-scroll, .dock-band")?.classList.contains("dashboard-scroll") ?? false, [x, y] as const);

test("a see-through bottom band floats over the dashboard: the region runs under it, empty space reaches the dashboard, the last card scrolls clear", async ({ page }) => {
  await seedApp(page, seed({ bottom: [locked("pip", 8)], dockSeeThrough: { bottom: true } }));
  const band = page.locator(".dock-band-bottom");
  await expect(band).toHaveClass(/dock-band-float/);
  const b = (await band.boundingBox())!;
  const s = (await scroll(page).boundingBox())!;
  expect(Math.round(s.y + s.height)).toBe(Math.round(b.y + b.height));
  expect(await band.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  expect(await hitsDashboard(page, b.x + 40, b.y + b.height / 2)).toBe(true);
  expect(await hitsDashboard(page, b.x + b.width * 0.75, b.y + b.height / 2)).toBe(false);
  await scroll(page).evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const last = (await card(page, "a-last").boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(b.y + 1);
});

test("a see-through top band sits under the tab bar, the dashboard opens past its room, and scrolling up clears the first card", async ({ page }) => {
  await seedApp(page, seed({ top: [locked("pip", 6)], dockSeeThrough: { top: true } }));
  const band = page.locator(".dock-band-top");
  await expect(band).toHaveClass(/dock-band-float/);
  const b = (await band.boundingBox())!;
  const bar = (await page.locator("main.dashboard-area > .tab-bar").boundingBox())!;
  expect(bar.y + bar.height).toBeLessThanOrEqual(b.y + 1);
  expect(Math.round((await scroll(page).boundingBox())!.y)).toBe(Math.round(b.y));
  await expect.poll(() => scroll(page).evaluate((el) => Math.round(el.scrollTop))).toBe(Math.round(b.height));
  await scroll(page).evaluate((el) => { el.scrollTop = 0; });
  expect((await card(page, "a-first").boundingBox())!.y).toBeGreaterThanOrEqual(b.y + b.height - 1);
  await page.getByRole("tab", { name: "Other" }).click();
  await expect.poll(() => scroll(page).evaluate((el) => Math.round(el.scrollTop))).toBe(Math.round(b.height));
});

test("a short tab under a see-through top band still opens past the room", async ({ page }) => {
  await seedApp(page, seed({ top: [locked("pip", 6)], dockSeeThrough: { top: true } }, [note("only", 0, { layout: { x: 0, y: 0, w: 40, h: 4 } })]));
  const b = (await page.locator(".dock-band-top.dock-band-float").boundingBox())!;
  await expect.poll(() => scroll(page).evaluate((el) => Math.round(el.scrollTop))).toBe(Math.round(b.height));
});

test("a tab's pinned bottom card stays below a see-through bottom band, uncovered", async ({ page }) => {
  const cards = [...tall("a"), note("pinned", 30, { pinned: "bottom", layout: { x: 0, y: 30, w: 40, h: 4 } })];
  await seedApp(page, seed({ bottom: [locked("pip", 8)], dockSeeThrough: { bottom: true } }, cards));
  const b = (await page.locator(".dock-band-bottom.dock-band-float").boundingBox())!;
  const pinned = (await page.locator("main.dashboard-area > .card-dock-bottom").boundingBox())!;
  expect(Math.round(b.y + b.height)).toBe(Math.round(pinned.y));
});

test("a see-through band the window caps is an ordinary band until it fits; switched off, nothing floats", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await seedApp(page, seed({ bottom: [locked("pip", 8)], dockRows: { top: 6, bottom: 24 }, dockSeeThrough: { bottom: true } }));
  const band = page.locator(".dock-band-bottom");
  await expect(band).not.toHaveClass(/dock-band-float/);
  await page.setViewportSize({ width: 1280, height: 1200 });
  await expect(band).toHaveClass(/dock-band-float/);
  await seedApp(page, seed({ bottom: [locked("pip", 8)] }));
  await expect(page.locator(".dock-band-bottom")).not.toHaveClass(/dock-band-float/);
  expect(await page.locator("main.dashboard-area").evaluate((el) => el.style.getPropertyValue("--dock-room-bottom"))).toBe("");
});
```

- [ ] **Step 2: Typecheck it (do not run it)**

Run: `pnpm typecheck && pnpm exec eslint e2e/see-through.spec.ts`
Expected: both exit 0 (`tsconfig.json` includes `e2e/`, so `pnpm typecheck` checks this file).

- [ ] **Step 3: Commit**

```bash
git add e2e/see-through.spec.ts
git commit -m "test: browser geometry of see-through locked bands (run by the walk)"
```

---

### Task 9: Help pages and the spec's settled items

**Files:**
- Modify: `src/help/guide/locked-and-pinned-widgets.md` (line 48; new section after it)
- Modify: `src/help/topics/locked-widgets.md` (after line 55)
- Test: `src/help/guide.test.ts:291-296`, `src/help/index.test.ts:169-173`
- Modify: `docs/superpowers/specs/2026-11-12-see-through-locked-bands-design.md`

**Interfaces:**
- Consumes: the behaviour of Tasks 1-7; Decisions 1-5 above.
- Produces: Help that names **See-through where empty**; a spec that records what the plan settled.

- [ ] **Step 1: Write the failing tests**

In `src/help/guide.test.ts`, inside "covers pinning, the Locked Widgets editor, the docks sync and the import guard", add after the `for` loop:

```ts
    for (const s of ["**See-through where empty**", "under the tab bar", "while a workspace is shown"]) expect(body).toContain(s);
```

In `src/help/index.test.ts`, inside "covers the Locked Widgets editor, the sync and the import guard", add after the `for` loop:

```ts
    for (const s of ["**See-through where empty**", "scroll room"]) expect(topic("locked-widgets")).toContain(s);
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run src/help/guide.test.ts src/help/index.test.ts`
Expected: FAIL — `expected '…' to contain '**See-through where empty**'` in both.

- [ ] **Step 3: Write the Help**

In `src/help/guide/locked-and-pinned-widgets.md`, at the end of line 48 (the "How they stack" paragraph, after "…they are a feature for a large monitor."), append ` A see-through band is the exception; see the next section.` Then insert after line 48, before `## Where they live, and how they travel`:

```markdown

## See-through bands

Each band's editor has a **See-through where empty** switch beside the rows stepper, off on a new install. Switched on, the band stops taking its rows off the dashboard and lies over it instead, with no background and no border line. Only its locked widgets take the pointer: where the band holds nothing you see the dashboard beneath, and click, drag and scroll it there. The dashboard's scroll area runs under the band and gains extra room at that end, as tall as the band, so a card under a locked widget can always be scrolled clear of it. At the bottom, scroll down past the last card. At the top, the dashboard opens scrolled past that room — its first rows sit beneath the band, visible in its gaps — and scrolling up brings them down clear of it; switching dashboards or tabs opens each one that way again.

A see-through top band lies under the tab bar rather than above it, and a tab's own pinned card on the same edge stays outside the band, so neither is covered; a maximized card covers a see-through top band. The dashboard's scrollbar runs the full height, under a locked widget at the right edge. A band the window caps — one that has to scroll its own rows on a short screen — is an ordinary band until the window is tall enough again, and so is every band while a workspace is shown, since each tile scrolls on its own. The switch is saved, synced and exported with the bands. A BDOBB build from before the switch reads a synced copy without it, and reads an exported file whose band is see-through as an ordinary dashboard rather than as the bands.
```

In `src/help/topics/locked-widgets.md`, after line 55 (`monitor.`), insert:

```markdown

**See-through where empty**, a switch in each band's editor, lays that band
over the dashboard instead of taking its rows: empty band space shows the
dashboard and takes its clicks, drags and scrolling, and the dashboard gains
scroll room at that end as tall as the band, so anything under a locked widget
can be scrolled clear of it. A see-through top band sits under the tab bar,
and the dashboard opens scrolled past its room. A band the window caps, and
every band while a workspace is shown, stays an ordinary band.
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm exec vitest run src/help`
Expected: PASS for every file under `src/help` (the shots, search and index suites read these pages too).

- [ ] **Step 5: Update the spec**

In `docs/superpowers/specs/2026-11-12-see-through-locked-bands-design.md`:

1. Append to the Status line (line 3): ` Updated 2026-11-12 by the implementation plan (docs/superpowers/plans/2026-11-12-see-through-locked-bands.md) with what reading the code settled; see "Settled when writing the plan".`
2. Replace the first bullet of "Existing structure" with:
   ```markdown
   - The page is a column in `.dashboard-area`: top band, the dashboard's tab bar, a tab's pinned top card, `.dashboard-scroll`, a tab's pinned bottom card, bottom band (`src/App.tsx`, `src/components/DashboardGrid.tsx`, `src/styles.css`). The top band is above the tab bar, so a maximized card leaves it visible.
   ```
3. Replace the whole "## To settle when writing the plan" section (heading and its three bullets) with:
   ```markdown
   ## Settled when writing the plan (2026-11-12)

   - **Where a floating band lies.** Over the scroll region only. A see-through top band moves from above the tab bar to just below it (and below a tab's pinned top card); a see-through bottom band lies just above a tab's pinned bottom card, which becomes the outermost strip. Done with CSS `order`, so the bands are still mounted once. A maximized dashboard card covers a see-through top band.
   - **Local workspaces.** A workspace's area never scrolls and each tile scrolls its own region, so there is no one region to give the room to: every band behaves as opaque while a workspace is shown. Viewer windows show no workspace and float as the main window does.
   - **Scroll position.** Nothing saves or restores a dashboard's or tab's scroll; the one scroll element is reused across switches. While a top band floats, the dashboard is set scrolled past the room when the band starts floating and on every dashboard or tab switch, and at no other time.
   - **A short tab.** The dashboard grid is kept at least the region's height plus a top band's room, so a short tab still opens scrolled past the room.
   - **Export, import and sync.** The switch is `dockSeeThrough` beside `dockRows` in the docks data and `seeThrough` beside `rows` in the apps.json v8 `docks` member, written only for an edge that is on. A build from before the switch keeps a synced copy without it (and uploads it so after an edit there), and imports an exported file with a see-through band as an ordinary dashboard.
   ```

- [ ] **Step 6: Commit**

```bash
git add src/help/guide/locked-and-pinned-widgets.md src/help/topics/locked-widgets.md src/help/guide.test.ts src/help/index.test.ts docs/superpowers/specs/2026-11-12-see-through-locked-bands-design.md
git commit -m "docs: see-through locked bands in Help, and the spec's settled items"
```

---

### Task 10: The gates

**Files:** none changed unless a gate fails (then fix in the task that owns the code, and re-run).

- [ ] **Step 1: Run each gate**

Run, one at a time, from `<worktree>`:

```bash
pnpm typecheck
pnpm lint
pnpm knip
pnpm test:run
pnpm test:web
pnpm build:web
pnpm build
pnpm notices:check
pnpm scrub
```

Expected: each exits 0. `pnpm knip`'s `exports`/`types` rules are `warn`; a warning matters only if it names a file this plan created or changed (e.g. an unused export from `src/lib/dockSeeThrough.ts`) — fix those, leave older ones. `pnpm test:run` under host load may time out a slow suite: re-run that one file alone before treating it as a failure. If `pnpm build` or `pnpm build:web` fails only because the pivot wasm output is missing (CI runs `pnpm pivot:build` first), stop and report it — do not run the cargo-backed `pnpm pivot:build` without the coordinator's say-so.

- [ ] **Step 2: Confirm nothing outside the plan changed**

Run: `git diff --stat d5ad02f5..HEAD -- src-tauri Cargo.toml Cargo.lock package.json pnpm-lock.yaml`
Expected: no output.

- [ ] **Step 3: Commit only if a gate needed a fix** (with the owning task's files and a `fix:` message).

---

### Task 11: Manual acceptance on a Mac and an iPad — NEEDS THE HUMAN

Not for an agent. Done by the user, on this branch's build, after the release walk has run `e2e/see-through.spec.ts`. Each line is a pass/fail.

**Setup:** a dashboard taller than the window; Settings ▸ Locked Widgets ▸ Locked at Bottom… → a 12-row band with the Picture in Picture card on the right half → **See-through where empty** on → OK.

- [ ] **Mac — empty space is the dashboard.** The left half of the bottom band shows the dashboard. Clicking a card there selects it; dragging a card's title there moves it; the wheel there scrolls the dashboard.
- [ ] **Mac — locked cards still work.** The Picture in Picture card's own controls, `⋯` menu and Maximize work; Escape restores.
- [ ] **Mac — bottom room.** Scrolled to the end, the dashboard's last card sits fully above the locked card.
- [ ] **Mac — top band.** Lock a card on the top band, switch it see-through. The band sits under the tab bar; the dashboard opens with its first rows beneath the band; scrolling up brings them clear. Switch dashboards and tabs: each opens that way. Scroll somewhere, wait for a card refresh: the position stays.
- [ ] **Mac — switch off.** Turn both switches off: the bands are the opaque strips they were, the scroll area stops at them, and `dashboards/docks.json` has no `dockSeeThrough`.
- [ ] **Mac — too tall.** Make the window short enough that the band scrolls its own rows: it turns opaque and scrolls; make the window tall again: see-through again.
- [ ] **Mac — workspace.** Open a local workspace: the bands are opaque; leave it: see-through again, the dashboard opened past a top band's room.
- [ ] **Mac — pinned card.** On a tab with a card pinned to the bottom, the pinned card is fully visible below the see-through bottom band.
- [ ] **Mac — viewer window.** Open in new window: the bands float the same way; there is no editor to open.
- [ ] **Mac — Picture in Picture.** With the PiP card in the see-through bottom band, start PiP and move the window: it reports its own rectangle and behaves as in an opaque band.
- [ ] **Mac — round trips.** Export locked widgets…, turn the switch off, Import locked widgets… (Replace): the switch is back on. With the dashboard sync on, the other device shows the same switch after a sync.
- [ ] **iPad — empty space.** A finger's tap and pan on empty band space reach the dashboard; the locked card takes its own taps.
- [ ] **iPad — home indicator.** The floating bottom band sits above the home indicator, as the opaque one does.
- [ ] **iPad — too tall.** In landscape a 24-row band caps: it is opaque and scrolls its rows.
