# v4 fix batch 2026-10-10b — receipts (RE-FREEZE)

Branch `codex/clean-v4-integration`, on top of the withdrawn freeze `a4439c4`. Batch `fixbatch-2026-10-10` still applies to everything up to `a4439c4`. This batch adds the user rulings of 2026-10-10:

| Commit | Item | What |
|---|---|---|
| `b7fc6c2` | #17 (gap) | The backend card's in-thread Pivot groups an undeclared object cell by its scalar `value`, as the worker already does. Before, every member fell into one `[object Object] (n)` group. |
| `58eb69a` | #17 (minor) | An empty worker table shows the refused category's reason ("… holds objects and declares no display field."), not only "No rows.". |
| `8dd322a` | v3 | Merge of frozen v3 `1c50899`: OBBject `warnings` shown as a card notice. Conflicts in `dataClient.ts`, `useWidgetData.ts` and `WidgetCard.tsx` were resolved by keeping both sides. `onWarnings` follows v4's `ctx` parameter, and the hook returns `warnings` among v4's extra fields. |
| `29cf46e` | D-019 (#32) | Exports write a calculation error as `"#ERROR: <reason>"`, the same in CSV, JSON and Excel. `OPEN-QUESTIONS.md` records D-019, D-020 and D-021 as ruled. |

D-020 (#33) and D-021 (#34 = #29) were already in `a4439c4` and are now approved as built. D-021's worker Default-view export goes through `presentedForExport`, which `8b36ed1` fixed.

**Owed:** a GUI re-test of E05-053 (D-020 slow-typing reorder). It is interactive, so NOT_RUN.

Review: one pass over `a4439c4..29cf46e`, verdict "Ready to merge: Yes". Minor items:
- `errorCell` sits between `presentedForExport` and its JSDoc;
- an object whose `value` is null or non-scalar still groups as `[object Object]` on the backend Pivot. That is the behaviour before this change; the worker refuses such cells instead.

`run-gates.sh` ran every gate once at HEAD `29cf46e` (see `head.txt`), with e2e ports 4683/4684. Every gate exited 0, with no reruns. Absolute paths in the logs are replaced with `<worktree>` / `<scratch>` / `~`.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 312 files passed, 1 skipped; 5648 tests passed, 6 skipped |
| build | pass |
| e2e | 217 passed, 1 skipped |
| web | 31 pass, 0 fail |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | `scrub-check: clean` |
| help | 51 passed |
| cargo-test | 15 passed, 0 failed |
| diff-check | `git diff --check 8e91662 HEAD` exit 0 |

**Frozen.** The freeze is the commit that adds these receipts; its product source equals `29cf46e`. Delivery: nothing pushed, no tag moved.
