# v4 RC: v3 manual-test fixes carried, plus relative date filters (2026-10-12) — receipts (FREEZE)

Branch `claude/v4-18-first-open`, on top of v4.0.0 `71f08dc`. Step B of the user's order: carry the whole v3 batch into v4, freeze a v4 release candidate, and click-test only after the automated tests pass. `release/v4` and `v4.0.0` are not moved; the user decides after the click tests.

| Commit | What |
|---|---|
| `5de380c` | Real merge of v3 `f3aaf18` (`release/v3` = `v3.0.0`, all manual re-tests passed), fetched as `refs/integration/v3-manual-fixes-2026-10-12`. No cherry-picks. |
| `00f7a86` | Date expressions in the filter boxes stay relative (user ruling below). |

**How each v3 fix landed in v4.** Each line keeps its own exporter and pivot code.
1. **Single Save… with the macOS Format panel.** v4's notice still names the profile written, e.g. "with BDOBB v4 state". v4's #18 profile test now runs through Save….
2. **Connections help shot.** v4's own shot is kept; the merge left it unchanged.
3. **headerName CSV/Excel headers** on the plain table path. `toXlsx` keeps v4's #28 Excel date cells as well as the labels. v4's worker export (pivot and local tables) already heads columns with display labels.
4. **Prefilled text date boxes,** through `parseDateBound`.
   - The boxes also take v4's date expressions (`T-1bd`, `T-26w`, `FQ-4` …).
   - They sit inside v4's Input filters panel and save through its D-020 250 ms drafts.
   - A worker-executed table holds only the window on screen, so its boxes start empty.
5. **Apps library Backend select,** on v4's `{value, label}` FilterSelect.
6. **Only the Widget Library list scrolls.** v4's linked-builtin card body is kept.
8. **OpenBB mark** for the service `openbb-reference`.
9. **Clear and the row count** in a trailing column while filtering.
   - It sits after v4's selection gutter.
   - v4's `<colgroup>` also carries the date-column widening and the actions column.
   - v4's pivot and execution count texts are kept.

**Help and shots:**
- The remaining "BDOBB-compatible export" and "Plain OpenBB export" wording now names the two Save formats.
- The tables text covers date expressions.
- Retaken in both themes: `dashboards-and-folders` (Save…) and `widget-library`. No help shot shows the filter row.

**Relative date filters (`00f7a86`).** User ruling: "Every refresh should recalculate the date values and then the filtering works."
- **Stored text:** a typed expression is stored as its text; YYYY-MM-DD stays a fixed day.
- **Resolver:** `src/lib/dateFilters.ts` resolves a stored bound with v4's `resolveValue("date")`. It uses the dashboard's exchange calendar: the one the card's params loaded, else the bundled one.
- **Plain and pivot tables:** resolved just before filtering, memoised on the payload, so a Refresh, an auto-refresh or a relaunch resolves again. The boxes show and edit the stored text, and the tooltip reads e.g. "T-1bd is 2026-01-06 today".
- **Worker tables:** `tableExecutionStore` resolves just before `applyModel` with the dashboard's exchange, and the formula-authoring preview resolves the same way. The stored definition keeps the text.
- **Input filters panel:** its D-020 drafts save the text.
- **Save formats:** a BDOBB Workspace save keeps the text. Strict OpenBB Workspace carries no table state.
- **Tests:**
  - unit: two fixed clocks; the stored text and title; a TableRenderer recount after the next day's refresh; the store sending D, then D+1 after a refresh, while keeping the text; the BDOBB Workspace round trip;
  - WebKit e2e with a fixed clock: `T-1bd` in To gives 3 of 5 rows, and the next day plus Refresh gives 4 of 5 without editing the box.
- **Not covered by a test:** changing the dashboard's exchange. On a plain table it re-resolves at once; on a worker table it is picked up at the next model apply (refresh).

`run-gates.sh` ran every gate once at `00f7a86` (`head.txt`), on ports 4583/4584. The opt-in dashsync suite ran against the local key-mode container on 127.0.0.1:17400. Its credential comes from the gitignored `.env.dashsync-test.local` and is never printed.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 322 files passed, 2 skipped; 5850 tests passed, 7 skipped |
| revision-test | 34 passed |
| build | pass |
| smoke | clean, React mounted, no console errors |
| e2e | 227 passed, 8 skipped |
| web | 31 pass, 0 fail |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on the run's own unscrubbed logs. Once they were scrubbed, scrub-check and header-check are clean (`scrub-rerun.log`). |
| help | 56 passed |
| cargo-test | 16 passed, 0 failed |
| notices-check | up to date |
| dashsync | 7 passed |
| diff-check | `git diff --check 71f08dc HEAD` (receipt logs excluded) exit 0 |

**Frozen.** The freeze is the commit that adds these receipts. Its source equals `00f7a86`. Delivery: the working branch is pushed; `release/v4` and `v4.0.0` are not moved.
