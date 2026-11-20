# SSRM chart authoring selectors

The clean baseline was `fcb11da8e746464d6f83e19ac47a0e21d44c2230` on `codex/v9-next-eight-charts`. Linked chart controls render through `LinkedParametersPortal` into the card's Parameters region. The region starts hidden and is excluded from role locators until the card's chevron opens it. Both baseline error contexts show the chart card with **Show parameters** collapsed and the choose-fields message.

Each spec now locates the card containing the new linked chart renderer, clicks its exact **Show parameters** button, and scopes the existing Category and measure interactions to that card's exact **Parameters** region. The selected category remains `region`. The compiled fixture still selects `Revenue`, and the native upload still selects `revenue`.

## Browser results

| Run | Exit and outcome | Evidence |
| --- | --- | --- |
| Full default Chromium at baseline | Exit 1. 402 passed, eight opt-in skips, one failure in 10.0m. The managed SSRM parity case timed out at `e2e/ssrm-parity.spec.ts:51:64` on Category after creating the linked chart from the compiled Rust fixture. The standard LIVE case and all 21 earlier legacy cases passed. | `full-browser-run.log`, `full-browser-discovery.log`, `full-browser-exit.txt`, `full-browser-head.txt`, `full-browser-results/ssrm-parity-*/`, `full-browser-html/` |
| Focused native Chromium at baseline | Exit 1. The widget case timed out at `e2e/ssrm-widget.spec.ts:48:65` on Category after uploading 1,205 rows and deriving the 1,204-row linked table. The existing 120-second timeout elapsed. Vite reported a dependency reoptimization at startup. | `ssrm-native-red.log`, `ssrm-native-red-exit.txt`, `privateproof/native-ssrm-red-results/`, `privateproof/native-ssrm-evidence/red/` |
| Focused default Chromium after correction | Exit 0. Both SSRM parity cases passed in 4.7s. The previously failing case passed in 2.1s. | `ssrm-default-parity.log`, `ssrm-default-parity-exit.txt`, `ssrm-default-parity-results/` |
| Focused native Chromium and WebKit after correction | Exit 0. Both projects passed in 18.6s. Chromium completed in 8.4s and WebKit in 8.5s. | `ssrm-native-green.log`, `ssrm-native-green-exit.txt`, `privateproof/native-ssrm-green-results/`, `privateproof/native-ssrm-evidence/green/` |

The earlier full discovery found 411 tests in 89 files. Seven dashboard sync tests and the reference acceptance case were the existing opt-in skips. The full log SHA-256 is `eccedd86648ffa52b4074b08e6748d10439327e4eaeb465f5c3a89bf7f88e279`. Both focused passing runs reported zero skips and emitted no warnings. All browser runs used one worker and zero retries. The amended full default sweep belongs to the next remote CI run.

### Commands

Run from the client worktree. The previous full default command and artifacts are recorded in `legacy-parameters-verification.md`. The focused default run used the existing compiled WASM artifacts, the default TypeScript table engine outside the SSRM fixture, and fresh app and mock ports.

```sh
report_directory=.superpowers/v9-release-followup-2026-11-20
env -u NO_COLOR FORCE_COLOR=0 PIVOT_WASM_VERIFY_ONLY=1 \
  BDOBB_BROWSER_PORT=4709 BDOBB_MOCK_PORT=4710 \
  pnpm e2e e2e/ssrm-parity.spec.ts --project=chromium --workers=1 --retries=0 \
  --reporter=list --output="$report_directory/ssrm-default-parity-results"
```

For native baseline this command used `run_phase=red` with `--project=chromium`. For native verification it used `run_phase=green` and both projects. The assignments are command-local for each test. Set the three TABLE_QUAL variables to existing qualified read-only fixture paths. Exact local preflight identities remain in the retained release-follow-up evidence; this test did not rebuild the native fixtures.

```sh
env -u NO_COLOR FORCE_COLOR=0 NODE_ENV=test \
  TABLE_QUAL_LINUX_ROOT="$TABLE_QUAL_LINUX_ROOT" \
  TABLE_QUAL_LINUX_TARGET="$TABLE_QUAL_LINUX_TARGET" \
  TABLE_QUAL_GATEWAY="$TABLE_QUAL_GATEWAY" \
  TABLE_QUAL_EVIDENCE_DIR="$report_directory/privateproof/native-ssrm-evidence/$run_phase" \
  pnpm test:ssrm:browser e2e/ssrm-widget.spec.ts --project=chromium --project=webkit \
  --workers=1 --retries=0 --output="$report_directory/privateproof/native-ssrm-$run_phase-results"
```

### Native artifacts and containment

The service and worker are prebuilt AArch64 Linux ELFs. All seven file hashes matched the handoff and passed a post-run comparison. The four gateway files also matched Docker `a0efab23ab2be34b4a3b15e5641aa39d3a42df59` byte for byte. The existing `rust:1.98.1-slim-trixie` image is `linux/arm64` at `sha256:4cd829461bd5c4d511c32e269da9cb8929223b666519d8004e35fc8d1d771ab7`. This run qualifies those exact existing artifacts with the amended client test.

The harness creates private settings, catalog, scratch and gateway state. The live baseline container inspection confirmed a read-only root, read-only `/usr`, `/var`, `/etc`, `/opt/node`, `/target` and `/work`, a writable private `/task` and a loopback port binding. All three harness containers were removed on completion. Each passing run observed 85 successful table HTTP requests and the asserted 404 for the foreign principal. The tests also verified the native worker limit and non-root operation. The identity, mount, and aggregate request logs are in `ssrm-native-identity.log`, `ssrm-native-identity-postrun.log`, `ssrm-native-red-mounts.log`, and `ssrm-native-evidence-summary.log`.

## Self-review and static checks

Reversing exactly the three panel lines and the Category and measure locator changes in each file reconstructs both baseline specs byte for byte. The unchanged assertions cover numeric fields, the 204 and 1,204 Plotly point counts, source acquisition and projection, solver preview, export during refresh, saved reopen, the principal boundary, and the existing standard LIVE refusals. Both test policies are preserved.

`pnpm typecheck`, `pnpm lint`, `pnpm scrub`, `git diff --check`, and `git diff --cached --check` exited 0. Scrub and header checks reported clean. See `ssrm-types.log`, `ssrm-lint.log`, `ssrm-scrub.log`, `ssrm-diff-check.log`, `ssrm-spec-reversal.log`, and `ci-ssrm-parameters-controller.diff`.

The staged scope contains the two specs and `docs/releases/validation/v9/next-charts/verification.md`. The six catalog recovery files matched their pre-existing SHA-256 values. The original workspaces were left alone and the prior working-copy catalog bytes remain unknown. The native run artifacts are ignored local evidence. Independent review and amended-head remote CI remain pending.

Committed as `ae4793972275514b3e2fd89644d6dbc93eac08fe`, directly above the baseline. The tracked worktree is clean, and all six recovery files passed the post-commit SHA-256 comparison.
