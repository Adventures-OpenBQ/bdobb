# v3 manual-test fixes 2026-10-12 — receipts (FREEZE)

Branch `codex/clean-v3-repair`, on top of `bcc11c7` (v3.0.0 head). The batch comes from the user's manual v3 run on `bcc11c7`: 9 cases passed and V3-005 failed. The fixes are user rulings relayed by the release coordinator.

| Commit | What |
|---|---|
| `e29c324` | Retakes the `connections` help shot in both themes. It no longer shows "Allowed code languages", which was removed in `3a63d99`. |
| `28be752` | Replaces the two export items with one **Save…** on a dashboard row (details below). |
| `cc57a43` | CSV and Excel exports head columns with the widget's columnsDefs `headerName`, falling back to the field key. JSON keeps the field keys, and the transposed view is unchanged. (V3-005) |
| `350dc5a` | Adds a **Backend** filter to the Apps library, next to Search apps. |
| `a6f8798` | Fixes the date column filter (details below). (V3-005) |
| `993a0ff` | Widens the date column while the filter row is open (details below). |

**Save… (`28be752`).** On macOS, a small Tauri command, `save_workspace_panel` (`src-tauri/src/save_panel.rs`), shows the native Save panel.
- **Format choice:** a pop-up in the panel's accessory view offers *Strict OpenBB Workspace* (the default, `exportApp`) and *BDOBB Workspace* (`exportCompatibleApp`).
- **Result:** the command returns `{path, format}` and admits the path to the fs scope, as the dialog plugin's `save()` does.
- **Behaviour kept:** notices and refusals are unchanged.
- **Browser mode:** there is no Save panel, so Save… opens a flyout of the two formats and the existing save flow follows.
- **Dependencies:** the Cargo lockfile adds only the direct dependency lines for `objc2`, `objc2-foundation`, `objc2-app-kit` and `serde`. All four were already in the lock, and default features are off. `notices:check` is up to date.
- **Help:** the help text is updated, and the `dashboards-and-folders` shot was retaken in both themes. It is a browser-mode shot, so it shows "Save… ▸".

**Date column filter (`a6f8798`).** Reproduced in Playwright WebKit:
- The filter already applied on change once month, day and year were all typed.
- WebKit keeps the value empty until then and fires no input event.
- It draws an unfilled segment as today's date in grey, and the 68 px field clipped the year. So a half-typed date looked complete and filtered nothing.

Ruling A:
- Keep `<input type=date>` at its natural width.
- Outline a half-filled date (`validity.badInput`) in red, with the title "Incomplete date".
- Apply on Enter and blur as well as on change.
- New tests: a `dated_table` browser fixture and `e2e/date-filter-webkit.spec.ts`.

**Date column width (`993a0ff`).** The user's follow-up ruling: while filters are on, the date column widens so From and To fit side by side, and with filters off it returns to its standard width. The header width becomes `max(size, --date-range-width)` only while the filter row is open. The persisted width is never touched.

`run-gates.sh` ran every gate once at `993a0ff` (see `head.txt`), on ports 4483/4484.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 158 files passed, 2 skipped; 3225 tests passed, 8 skipped |
| build | pass |
| smoke | clean, React mounted, no console errors |
| e2e | 96 passed, 7 skipped (the 6 opt-in dashsync specs, plus 1 as before). Includes 3 WebKit date-filter cases. |
| web | 31 pass, 0 fail |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on the run's own unscrubbed logs. Once they were scrubbed, scrub-check and header-check are clean (`scrub-rerun.log`). |
| help | 54 passed |
| cargo-test | 16 passed, 0 failed (includes the Format pop-up mapping) |
| notices-check | up to date |
| diff-check | `git diff --check bcc11c7 HEAD` exit 0 |

**Not automated: the native Save panel.** Its Rust code compiles, passes clippy and is unit-tested. It has not been run on screen here, because the user's manual app was in use. That check falls to the user's re-test, cases E05-001, E05-033, E05-045 and V5-006.

**Frozen.** The freeze is the commit that adds these receipts. Its source equals `993a0ff`. Delivery: nothing pushed, no tag moved.

## Fix 6: Widget Library filters stay at the top (2026-10-12)

User ruling from the `f063ca4` re-test. In the Widget Library, only the widget list scrolls: the search box and the Backend, Category, Subcategory, Provider and Type filters stay fixed at the top. Commit `575d119` makes the overlay a flex column and puts the list in its own scroll container below the filters. The container wraps the grid rather than being the grid, so the grid's rows keep their height. A new e2e in `e2e/library.spec.ts` failed first against the old layout: it scrolls the list and checks that the search and the Backend filter have not moved.

The affected gates ran at `575d119` (`fix6-head.txt`, `fix6-gates.tsv`):

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 3225 passed, 8 skipped |
| build | pass |
| e2e | 97 passed, 7 skipped |
| scrub | Failed during the run only on the run's own logs. Once they were scrubbed, the check is clean (`fix6-scrub-rerun.log`). |
| diff-check | `git diff --check f063ca4 HEAD` exit 0 |

Fix 7 (relabel "Backend" as "Connection") was requested and then cancelled by the user before any change was made, so there is nothing to revert. Delivery: nothing pushed, no tag moved.

## Fix 8: an OpenBB reference connection shows the OpenBB logo (2026-10-12)

User ruling. openbq-reference v3.0.0 (`86dde12`) and v4.0.0 (`e5404dc`) now answer `GET /` with `{"Info":"Hello World","service":"openbb-reference"}`. A read-only check of the local v3 instance on 127.0.0.1:17783 returned exactly that. Commit `9cfce87` exports `OPENBB_REFERENCE_SERVICE = "openbb-reference"` beside `OPENBB_PLATFORM_SERVICE` in `dataClient.ts`. Connections now marks that service with the OpenBB glyph, and the mark's doc comment is updated. A new unit test failed first and now passes. No help text describes the mark, so none changed.

The affected gates ran at `9cfce87` (`fix8-head.txt`, `fix8-gates.tsv`):

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 3226 passed, 8 skipped |
| build | pass |
| diff-check | `git diff --check 2bb097a HEAD` exit 0 |

Delivery: nothing pushed, no tag moved.

## Fix 4, redone: prefilled text date boxes (2026-10-12)

The user's native re-test of `57e122c` failed V3-005 again. The card was BLS CPI Relative Importance, with its Date column pinned left and declared `cellDataType: "date"`. With `<input type=date>`, typing only the year left month and day as WKWebView's grey placeholder showing today's date. The box looked like a real date, was outlined as "Incomplete date", and Enter applied nothing.

The user ruled that the date pickers become text boxes. Commit `72a23e7` makes that change:
- **Prefill:** From and To are text boxes that start with the column's first and last date from the loaded rows. That is their starting text, not a placeholder, and nothing filters until a box changes.
- **Parsing:** v3 reads `YYYY-MM-DD` only, through one parser, `parseDateBound` (text in, bound or refused out). v4 extends that parser with its date modifiers on the carry.
- **Applying:** Enter or leaving a box applies it; typing alone does not.
- **Refused text:** outlined in red with the title "Use YYYY-MM-DD", and the rows don't change.
- **Clearing:** an emptied box drops that bound. Clear puts both boxes back to the first and last date. It remounts the controls, so refused text with no applied filter resets too.
- **Kept and removed:** the widened-while-filtering column from `993a0ff` stays. The `badInput` code is removed.

**Tests:**
- Unit tests cover the parser, the prefill, Enter, blur, refused text and Clear.
- `e2e/date-filter-webkit.spec.ts` now uses the `dated_table` fixture with its date column pinned left and declared `cellDataType: "date"`, the case the earlier spec missed. It has five WebKit cases:
  - the prefilled boxes are whole and side by side;
  - editing only From's year applies on Enter;
  - refused text is red and leaves the rows unchanged;
  - leaving To applies it;
  - the column widens while the filter row is open and returns to its width after.
- Help: the tables topic and guide text are rewritten. The tables shot doesn't show the filter row, so it was not retaken.

The affected gates ran at `72a23e7` (`fix4b-head.txt`, `fix4b-gates.tsv`):

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 3232 passed, 8 skipped |
| build | pass |
| e2e | 99 passed, 7 skipped |
| help | 54 passed |
| diff-check | `git diff --check 57e122c HEAD` exit 0 |

Delivery: nothing pushed, no tag moved.

## Fix 9: Clear and the row count after the last column (2026-10-12)

The user's native re-test of `ab8dfeb` passed fix 4: on BLS CPI Seasonal Factors, From 2025-01-01, To 2025-12-01 and Item Code SA0 gave "120 of 13620 rows". In the same re-test the user ruled that Clear and the "N of M rows" count must leave the last column's filter cell. They sat under that column's min/max inputs and made the filter row taller.

Commit `483698b` gives the table one more column after the last one while filtering. It holds Clear and the count, right-aligned on one line. Every row carries a cell for that column and the spacers' `colSpan` counts it, so the header, filter and body rows stay in step. The column exists only while the filter row is open. Behaviour is unchanged: Clear resets every filter, the date boxes included, and the count text is the same.

**Tests:**
- Unit tests check that the actions are in no column's filter cell, that every row has the same number of cells, and that there is no actions column while the filter row is closed.
- An e2e on the pinned-left, wider-than-card screener checks that the actions sit after the last column on one line, that the row is one control tall, and that Clear still clears.
- Help: the tables topic and guide text are updated. No help shot shows the filter row.

The affected gates ran at `483698b` (`fix9-head.txt`, `fix9-gates.tsv`):

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 3234 passed, 8 skipped |
| build | pass |
| e2e | 100 passed, 7 skipped |
| help | 54 passed |
| diff-check | `git diff --check ab8dfeb HEAD` exit 0 |

Delivery: nothing pushed, no tag moved.
