# v8.0.0: v7 merged in, paired with openbq-docker v8.0.0 (2026-10-14) — receipts (FREEZE)

Branch `claude/v8-release`, from the v8 line `a9b447d` (the rewritten-history v8 branch). The user's order: "i want 8-10 out on github and main pushed to v10", v8 first.

| Commit | What |
|---|---|
| `5faf68c` | Real merge of `release/v7` = `v7.0.0` `6cd2c6a`. No cherry-picks. |
| `41d6c4d` | `openbqDocker` pinned to `v8.0.0`; `web/policy.mjs` re-vendored from the tag (body unchanged). Help follows the stack's release. |
| `4c562cf` | The funnel gateway is on port 10000 (openbq-docker v8.0.0 re-cut, user ruling (B)). |

**How the merge was resolved.** User ruling: "v7 help + v8 additions".
- **Code:** both lines' features are kept.
  - The rail exports through `exportAll`. Right-click **Save…** keeps v7's profile notice.
  - `WidgetCard` keeps v8's pin and lock guards and v7's backend Pivot button.
  - `apps-sync` serves v7's examples plus `v8.0.0-news` and `v8.0.0-pinned`.
  - The stack pin is `openbqDocker`; `openbbDocker` stays as the historical key.
- **Help:** v7's pages carry v8's additions. `openbb-docker-stack.md` is folded into `openbq-docker-stack.md`. The rail loses Add widget (R5).

**openbq-docker v8.0.0** (Adventures-OpenBQ/openbq-docker; the tag ended at `d507ff5` after two docs-only moves):
- rss-ticker is `rss-feedhandler:8.0.1`, pinned by digest and public. Every serve file publishes it on tailnet port 8088.
- funnel-gateway is on Funnel port 10000, the only funneled port.
- The Episode 3 reference stays on tailnet port 8443. `serve-v3-funnel.json` runs it and the door on one node.
- `funnel-gateway/policy.mjs` is byte-identical across the re-cuts (sha256 `dfa61ddf…`).

`run-gates.sh` ran every gate once at `4c562cf` (`head.txt`), on macOS, with e2e on ports 4651/4652. Logs are scrubbed of local paths. An earlier full run at `41d6c4d` also passed all 19 gates.

| Gate | Result |
|---|---|
| pivot-build | pass |
| typecheck | pass |
| lint | pass |
| unit | 437 files passed, 6 skipped; 7943 tests passed, 29 skipped |
| revision-test | 54 passed |
| build | pass |
| smoke | clean, React mounted, no console errors |
| e2e | 294 passed, 8 skipped |
| web | 42 pass, 0 fail |
| build-web | pass |
| web-browser | PASS |
| pivot-test | 17 passed |
| pivot-packaging | pass |
| cargo | pass |
| scrub | pass |
| help | 94 passed |
| cargo-test | 17 passed, 0 failed |
| notices-check | up to date |
| diff-check | `git diff --check a9b447d HEAD` exit 0 |

**Frozen.** The freeze is the commit that adds these receipts; its source equals `4c562cf`. Delivery waits for the user's confirmation: `release/v8` and `v8.0.0` at the freeze, and `main` fast-forwarded to it.
