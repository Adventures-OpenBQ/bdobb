# v6 fix batch 2026-10-10 — receipts (FREEZE)

Branch `codex/clean-v6`, on top of `1776c58`. That is `98698a3` plus one docs-only commit from a stand-down session: `docs(v6): run 5 GUI — fix proposal for D-019, D-020, D-021`, kept.

| Commit | Item | What |
|---|---|---|
| `b87eda7` | — | Merge of frozen v5 `1ff1c91`, which contains frozen v4 `a4439c4`. No conflicts. It brings #16 #18 #20 #21 #23 #24 #26 #28 #29 #30, V4-004, D-020 and D-021 (= #29). |
| `9781a7b` | — | Merge follow-up: the carried #18 LeftRail test gets v6's required `onOpenAI` prop. |
| `5c9e2a1` | D-016a | With AI Library ▸ Follow-up suggestions off, the request now sends `workspace_options["prompt-suggestions"] = false` when the agent declares that toggle. Before, the switch only hid the chips. Default on is unchanged. Help updated. |

Run-4/run-5 defect status on this line:
- **D-016** (Rita's prompt makes Qwen skip the first tool call): not a client defect. Fixed in agent-rita by patch `0011-fix-agent-suggestions-only-on-the-final-answer-retry.patch` (adventures-agent-rita `.worktrees/v6-step1-services/patches/rita/`), deployed on the NAS, upstream openbq-org/agent-rita#2.
- **D-017**: already fixed on v6 in `96a5af1`.
- **D-019**: open; it needs a product decision. See [OPEN-QUESTIONS.md](../../../OPEN-QUESTIONS.md).
- **D-020**: fixed on its home line v4 (`d7e9fc3`, `62be9df`).
- **D-021**: fixed on v4 as #29 (`8b36ed1`).
- **D8**: excluded; it belongs to openbq-docker.

The detached WIP worktree `d019-d021-wt` named in the brief does not exist; the proposal records that its scratch worktrees were removed.

Review: one pass, verdict "Ready to merge: Yes", no issues.

`run-gates.sh` ran every gate once at HEAD `5c9e2a1` (see `head.txt`), with e2e ports 4711/4712 and WebKit ports 4783/4784. Load before: `uptime-before.txt`. The WebKit gate uses the gitignored `.superpowers/playwright.webkit.config.ts`, the same config as the earlier v6 receipts. `$HOME` is written `<home>`.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 394 files passed, 5 skipped; 6851 tests passed, 28 skipped |
| build | pass |
| e2e (Chromium) | 268 passed, 1 skipped |
| web | 31 pass, 0 fail |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | `scrub-check: clean` |
| help | 65 passed |
| cargo-test | 15 passed, 0 failed |
| e2e-webkit (8 earlier specs + `rail-after-dialog.webkit.spec.ts`) | exit 1: 24 passed, 1 failed. The failure is `rail.spec.ts:109`, which failed the same way on the previous v6 receipts (`merge-v5-c7836fd`). Cause (probed this run): Playwright WebKit on macOS does not move Tab focus onto buttons; the tab order is `INPUT, SELECT, TH, TH, TH, INPUT, SELECT, BODY…`. Focus never enters the rail, so the test cannot pass in this engine as written; nothing in this batch causes it. Both #26 WebKit tests pass. |
| diff-check | `git diff --check 1776c58 HEAD` exit 0 |

**Native checks still owed:** #26 (V5-002 R2), and D-020's slow-typing *reorder* (E05-053), which jsdom and Chromium cannot reproduce.

**Frozen.** The freeze is the commit that adds these receipts; its product source equals `5c9e2a1`. Delivery: nothing pushed, no tag moved.
