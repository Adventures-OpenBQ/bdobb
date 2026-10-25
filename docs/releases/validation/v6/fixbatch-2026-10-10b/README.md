# v6 fix batch 2026-10-10b — receipts (FREEZE)

Branch `codex/clean-v6`. This supersedes the withdrawn freeze `0c75ffc`, which carried the superseded v5 `1ff1c91`. v6 now carries the **shipped** v5 `21ebe45` (release/v5, v5.0.0), so it also carries shipped v4 `5eda891` and v3 `1c50899`.

| Commit | Item | What |
|---|---|---|
| `ba1d15c` | — | Merge of shipped v5 `21ebe45`. Two conflicts. `fetchWidgetData`: v6's `signal` stays the 5th parameter, and v3's `onWarnings` becomes the 6th; `useWidgetData` passes `undefined` for the signal. First-open draft: v6 had moved it into `draftModelFor` (shared with Rita's table-model candidate), so #18's default (Total for a number column, else Count) moved there too. |
| `5c9e2a1` | #31 (D-016a) | From the earlier batch: with AI Library ▸ Follow-up suggestions off, `workspace_options["prompt-suggestions"] = false` is sent. (Its commit predates the #31 number.) |
| `0d29e86` | #35 (live test) | `rita-table-model-live` follows `arrange_table`'s declared number rule. **Assertions widened, to the contract:** test 1 also accepts `describe_table`'s exact `totalRowCount`; test 2's decline regex also accepts "do/does not support". Not live-run here: no local Rita/MCP on 18012/16911. |

Verified, no change needed:
- **#37:** proxied MCP tool names (`call_tool`, `run_pipeline`) are resolved for disable enforcement, activity display, chat export and AI Library disabling. See `src/lib/agent/proxiedTools.ts`, `execute.ts`, `chatStore.ts`, `StatusTrail.tsx` and `McpServersTab.tsx`, each with tests (127 tests pass). v6 has no separate per-call approval UI; the gate before a call is the disable check, which resolves proxied names.
- **#35:** Qwen ending a round with reasoning only is fixed in agent-rita (patch 0012), not client code.
- **#36:** a live check owned by the regression session.
- **D-016:** fixed in agent-rita patch 0011.
- **D-017:** fixed in `96a5af1`.

Out of scope until the user rules:
- **#38:** a backend long-form statement has no route to the Statement view.

Review: one pass over `0c75ffc..0d29e86`, verdict "Ready to merge: Yes", no issues. It checked every `fetchWidgetData` caller's positions and showed `draftModelFor`'s default equals `initialAggregation` for raw columns. Rita's fresh-table candidate drops drafted measures, so her `arrange_table` semantics are unchanged.

`run-gates.sh` ran every gate once at HEAD `0d29e86` (see `head.txt`), with e2e ports 4711/4712 and WebKit ports 4783/4784 (gitignored `.superpowers/playwright.webkit.config.ts`). `$HOME` is written `<home>`.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 6861 passed, 28 skipped |
| build | pass |
| e2e (Chromium) | 268 passed, 1 skipped |
| web | pass |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | `scrub-check: clean` |
| help | 65 passed |
| cargo-test | pass |
| e2e-webkit | 24 passed, 1 failed: `rail.spec.ts:109`. **Pre-existing, the same as the `merge-v5-c7836fd` and `fixbatch-2026-10-10` receipts.** Playwright WebKit on macOS never moves Tab focus onto buttons, so focus cannot enter the rail. Both #26 WebKit tests pass. |
| diff-check | `git diff --check 1776c58 HEAD` exit 0 |

**Not run here:** the live Rita/MCP gate (`scripts/rita-live-check.sh`), and native GUI checks (those need the user).

**Frozen.** The freeze is the commit that adds these receipts; its product source equals `0d29e86`. Delivery: nothing pushed, no tag moved.
