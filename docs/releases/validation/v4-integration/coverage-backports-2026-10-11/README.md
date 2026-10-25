# v4 coverage-audit back-ports 2026-10-11 — receipts (RE-FREEZE)

Branch `claude/v4-18-first-open`, on top of the freeze `42cf50e`. A commit-level audit of every bdobb-v2 ref against the clean lines found dev fixes to features v4 ships. User ruling 2026-10-11: a fix belongs to its feature's version, so these are back-ported even though dev first tagged them v12. Dev v8–v15 features stay out.

| Commit | What |
|---|---|
| `d00b017` | Dev b7b7361 (v12.4.2): a copied card owns its nested objects. `copyOf` spread the source, so a duplicate's params, table, table definition and selection were the same objects as the source's. v4 now `structuredClone`s every carried field; dev cloned params and table only. Failed first (`red-copy-nested.log`). |
| `1588a8e` | Dev 9fc10c6 (v12.3.0): the Calendar filter is a labelled group, not `role="tree"`/`treeitem`, which promised arrow-key navigation it never had. Failed first (`red-calendar-filter.log`). Dev's other parts of that commit do not apply: v4's grid and ribbon are already named, the row menu already has `tabIndex={-1}`, and the Advanced chart is dev v12 work. |
| `b46f0e9` | `provenance.md` records both back-ports. `OPEN-QUESTIONS.md` records the live-grid websocket auth check (dev 98301b6). A browser WebSocket cannot send a header, so a header-auth backend gets no credential. The clean live grid targets OpenBB's reference backend, whose `/live_grid_ws` accepts every connection without auth, so nothing is refused. Per the ruling it is not changed. |

Every gate is v4's full set plus the revision test and dashsync. `run-gates.sh` is the script that was run.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 5815 passed, 7 skipped |
| revision-test | 34 passed |
| build | pass |
| e2e | 219 passed |
| web | pass |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on its own unscrubbed logs. After those were scrubbed: scrub-check clean, header-check clean (`scrub-rerun.log`). |
| help | 54 passed |
| cargo-test | 15 passed, 0 failed |
| notices-check | up to date |
| dashsync | 7 passed |
| diff-check | `git diff --check 42cf50e HEAD`, excluding receipt logs: exit 0 |

**Frozen.** The freeze is the commit that adds these receipts. Delivery: nothing pushed, no tag moved.
