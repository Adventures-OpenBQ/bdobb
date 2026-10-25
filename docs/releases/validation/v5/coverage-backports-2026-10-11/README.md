# v5 coverage-audit back-ports 2026-10-11 — receipts (RE-FREEZE)

Branch `claude/v5-18-first-open`, on top of the freeze `9519924`. A commit-level audit of every bdobb-v2 ref found v5 features carried only in part. User ruling 2026-10-11: dev v8–v15 stays out, a fix belongs to its feature's version, and the Calendar view is introduced to readers in Episode 5.

| Commit | What |
|---|---|
| `f4e08bd` | Dev 7e3f35c2 (v5.6.0): **Settings ▸ Layout ▸ Option-number shortcuts** (Dashboards or Workspaces). The setting, shortcut branch and rail badges were carried, but not the control. Failed first (`red-option-number.log`). |
| `d292ec3` | Dev cae150b88, 49dd61a67 and 30ceb877d (v5.7.0): a widget manifest's `data.table.pivot` preset is parsed into `widget.pivot` and handed to the table. A malformed part is dropped onto `pivotPresetIssues`. Failed first (`red-pivot-preset.log`). |
| `1b999bb` | Dev Workspaces help: the dialog and its ways in, arranging, tile names, Put in panel, ⌥N, the Arrange-mode keys and the Escape rule. Every statement was checked against clean v5's behaviour. Failed first (`red-workspaces-help.log`). |
| `81b427b` | Episode 5 example **Example Dashboard - Version 5.0.0 - Treasury Auctions**. It shows the keyless U.S. Treasury upcoming-auctions and auction-results widgets (openbb-government-us) in the Calendar view. Failed first (`red-calendar-example.log`). The tests cover the import; no in-app render against a live stack was run. |
| `f39ab35` | `provenance.md` records the above. |
| `849962c` | Real merge of the v4 freeze `ff0f2b6`. The only conflict was `provenance.md`, and both sides were kept. |

Every gate is v5's full set plus the revision test and dashsync. `run-gates.sh` is the script that was run.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 6205 passed, 7 skipped |
| revision-test | 51 passed |
| build | pass |
| e2e | 256 passed |
| web | pass |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on its own unscrubbed logs. After those were scrubbed: scrub-check clean, header-check clean (`scrub-rerun.log`). |
| help | 62 passed |
| cargo-test | 15 passed, 0 failed |
| notices-check | up to date |
| dashsync | 7 passed |
| diff-check | `git diff --check 9519924 HEAD`, excluding receipt logs: exit 0 |

**Frozen.** The freeze is the commit that adds these receipts. Delivery: nothing pushed, no tag moved.
