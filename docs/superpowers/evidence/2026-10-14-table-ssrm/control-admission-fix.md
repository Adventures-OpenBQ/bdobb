# Saturation-safe SSRM control admission

Implementation and regression evidence for controller review, 2026-10-15.
Independent scoped review completed: spec and quality PASS, no open findings. See [review](control-admission-review.md).
Base bdobb: `e6bd7eba44a83b971bcbf313ef0913c8c101b651`.
Base Docker: `448339c97ffddc522876ab7a73f60725c38215f0`.

## Fix

The authenticated web relay, canonical gateway and Rust HTTP adapter each reserve
exactly two control requests independently of existing ordinary concurrency.
Only validated, exact, query-free POST session cancel and DELETE session/export
paths qualify. Public relays require `/table`; IDs are 1–128 ASCII alphanumeric,
underscore or hyphen. Source deletion, derive, commands, export creation, LIVE,
malformed paths and wrong methods remain outside the reserve.

The web retains four ordinary table slots and 240/minute per-user ordinary allowance;
controls get their own 240/minute per-user allowance. Gateway ordinary concurrency
remains `maxConcurrent`; controls get two slots and a separate per-process
`requestsPerMinute` bucket with the existing one-minute reset. Neither control lane
borrows ordinary capacity. Existing bearer/session/relay identity, CSRF, body/response
limits, deadlines, route policy and service ownership checks remain in effect.
Rust preserves the existing finite body/job/worker limits and 413 resource-limit
response, and holds an owned semaphore permit through the handler; RAII releases
it on completion, errors or request-future drop. Relay counters release in finally.

## Observed RED

Before production edits, new actual loopback web/gateway regressions failed:

- Saturated ordinary traffic: cancel returned429, expected200.
- Exhausted ordinary rate: control returned429, expected200.
- Two held controls: a third returned200, expected429.

`web-red.log` and `gateway-red.log` each record 0 pass / 3 fail with these assertions.
Native `native-fence-red.log` records an actual stopped-worker derivation occupying
the sole ordinary HTTP slot: authenticated targeted cancellation returned413
`limit_exceeded` / `HTTP admission is full`, expected200. The unchanged native
worker was stopped with SIGSTOP, and queued request bytes were confirmed with
FIONREAD before cancellation. No new production scheduling hook was introduced.
`native-http-red.log` independently shows the held-body adapter gate rejected a
foreign-owner request before it could reach the ownership handler.

## Regression coverage

Relay tests use real loopback client/server and real upstream HTTP. They fill all
four ordinary slots; verify cancel, session disposal and export cleanup reach
upstream; fill two control slots; verify a third control and further ordinary work
are refused; release success and disconnect paths and reuse capacity. They reject
non-control and malformed routes, unauthenticated requests, web CSRF and forged
gateway relay credentials during saturation. Returned upstream principals prove
session-derived / configured desktop identity. Both rate-isolation directions are
tested by spending each whole allowance; each allowance eventually returns429.
Held responses prove deadline/error/body-validation cleanup reopens both slots.

Native HTTP tests use the existing complete Axum router with real ingest/native
workers. Held request bodies fill ordinary and then both control slots. Real
owned export deletion/session cancellation/disposal succeed under saturation;
foreign-owner and unauthenticated calls refuse. Source deletion, malformed IDs,
queries, trailing slashes and non-control methods cannot borrow capacity. Aborted
request futures and body-error/deadline paths release permits. The real outstanding
native derivation test now uses `max_http_requests=1`; health gets413 while cancel
succeeds, then resumed worker output returns409 without a child publication,
resources return to baseline, parent rows work and later derivation succeeds.

## Commands and real outputs

All logs below live in `/private/tmp/ssrm-control-fix-2026-10-15`. Loopback and Docker commands used approved
`require_escalated` execution. `NATIVE` below expands literally to:

```
/private/tmp/run-native-worker-linux.sh env TABLE_INGEST_NODE=/root/node-v26.10.0-linux-arm64/bin/node TABLE_NATIVE_WORKER=/target/debug/pivot-native-worker
```

| Command | Result / output | Log |
| --- | --- | --- |
| `/private/tmp/node-v22.16.0-darwin-arm64/bin/node --test web/control-admission.test.mjs` (before fix) | 0 pass / 3 expected assertion failures | `web-red.log` |
| `/opt/homebrew/bin/node --test funnel-gateway/control-admission.test.mjs` (before fix) | 0 pass / 3 expected assertion failures | `gateway-red.log` |
| `NATIVE cargo test --offline --locked --manifest-path crates/table-service/Cargo.toml --test derivation cancellation_during_outstanding_native_derivation_preserves_parent_and_admission` (before fix) | 0 pass / 1 expected failure,413 vs200 | `native-fence-red.log` |
| `NATIVE cargo test --offline --locked --manifest-path crates/table-service/Cargo.toml --test http saturated_http_preserves_bounded_control_admission_and_ownership` (before fix) | 0 pass / 1 expected admission failure | `native-http-red.log` |
| Same focused web/gateway commands after fix | each3 pass / 0 fail | `web-green.log`, `gateway-green.log`, `gateway-auth-green.log` |
| Same focused native HTTP command after fixture-order correction | 1 pass / 0 fail | `native-http-green.log` |
| `/private/tmp/node-v22.16.0-darwin-arm64/bin/node --test web/*.test.mjs` | 57 pass / 0 fail | `web-full.log` |
| `/opt/homebrew/bin/node --test *.test.mjs` in canonical `funnel-gateway` | 96 pass / 0 fail, Node26.10.0 | `gateway-full.log` |
| `NATIVE cargo test --offline --locked --manifest-path crates/table-service/Cargo.toml` | 72 pass / 0 fail across all service suites | `service-full.log` |
| `/private/tmp/run-native-worker-linux.sh cargo clippy --offline --locked --manifest-path crates/table-service/Cargo.toml --all-targets -- -D warnings` | exit0, strict all-target lint | `clippy.log` |
| `/private/tmp/run-native-worker-linux.sh cargo build --offline --locked --manifest-path crates/table-service/Cargo.toml` | exit0, dev binary built40.69s; no image build | `native-build.log` |
| `pnpm exec tsc --noEmit` | exit0, empty diagnostics | `types.log` |
| `pnpm exec eslint web/server.mjs web/control-admission.test.mjs` | final exit0, empty diagnostics | `eslint-green.log` |
| `bash scripts/header-check.sh` | `header-check: clean` | `headers.log` |
| `pnpm exec vitest run` (first sweep) | 8170 pass / 29 skipped / 1 fail;449 files pass /6 skipped /1 fail;93.89s | `js-full.log` |
| `pnpm exec vitest run src/components/PivotParamRow.viewer.test.tsx` | 16 pass /0 fail;1.59s | `js-focused-viewer.log` |
| `pnpm exec vitest run` (controller-authorized final sweep, no concurrent native/browser jobs) | PASS: 8171 passed / 29 skipped; 450 files passed / 6 skipped | `js-full-final.log` |
| `/private/tmp/node-v22.16.0-darwin-arm64/bin/node --test --test-name-pattern='web/policy.mjs is the stack' web/security.test.mjs` | 1 pass /0 fail; final exact policy hash and package pairing | `pairing-hash-final.log` |
| `docker compose --env-file /private/tmp/ssrm-control-fix-2026-10-15/source.env --profile web --profile table config --no-env-resolution --quiet` | exit0; no services started | `compose.log` |

Browser command, once after building the amended native binary:

```
TABLE_QUAL_LINUX_ROOT=/private/tmp/bdobb-worker-linux-root TABLE_QUAL_LINUX_TARGET=/private/tmp/bdobb-worker-linux-target TABLE_QUAL_GATEWAY=/private/tmp/openbq-docker-table-ssrm-discovery/funnel-gateway/server.mjs TABLE_QUAL_EVIDENCE_DIR=/private/tmp/ssrm-control-fix-2026-10-15/browser-evidence pnpm test:ssrm:browser
```

`browser.log`: four actual native cases passed42.8s. Chromium resources7.9s,
consumers11.7s; WebKit resources9.2s, consumers11.7s. Both use real signed sessions,
web relay, canonical gateway and Linux service/worker. Raw fresh measurements
remain under `browser-evidence`; previous task11 measurements remain historical.

`rustfmt --edition 2021 --check` on the three amended Rust files and both
repository `git diff --check` checks exit0.

## Intermediate corrections and limits

- Native test initially deleted its export after untargeted session cancellation.
  That cancellation correctly already deletes all exports. `native-green.log`
  retains12/13 HTTP pass with the resulting410/200 fixture assertion, plus9/9
  derivation tests passing. The test now performs explicit export deletion first;
  no production export behavior changed.
- First ESLint found an unused drain-loop variable in the new test fixture;
  `eslint.log` retains it. Both fixtures now explicitly discard the chunk.
- Initial native command environment lacked Docker on PATH (exit127); details in
  `environment-attempts.log`. Login environment resolved the existing Docker CLI.
- First whole JS sweep failed the unchanged test
  `PivotParamRow.viewer.test.tsx > viewer Page offers explicit All and empty without editing the saved single Page`:
  it could not find button `None` after popup toggle. Isolated16-test rerun passed.
  No viewer source or tests changed. The controller authorized one final whole
  sweep after native/browser jobs finished; both outputs are retained.
- Assembled production image remains **UNQUALIFIED** after the prior apt ENOSPC.
  No image build, image/cache prune, push, merge, deployment or live-stack change.
  Existing physical-device, packaged desktop, release binary, image UID10001 and
  production capacity limits remain. No new capacity claim is made.

## Exact committed pairing

- Canonical gateway policy/server/tests: `e1a602911018ad5a82eed3c5d5f706934b90081f`.
- Native/web source fix: `1382c316d3838355a4366a163e63f280500d7284`.
- Native source tree: `d7c9a9a11122ea90b72925ca33363563c0dd81d4`.
- Docker source-lock pin: `41641c684af4db1c6390ea682e5663daff331bfd`.
- Exact source archive SHA-256: `b03dc334387d53b907cb9f3a83358747b5414f7c927135ee6a6ec9a17a1c2770`.
- Dockerfile SHA-256: `41c59cdcc8a4576e028d46fd5eba00508201cb69a5f88b05d0658b07a1dd70b8` (unchanged).
- Canonical policy SHA-256: `c4d1a2bd75523d75b53a0cb579116ecf4e627210e6c8bd2196eb3deba672fc7a`.

Source export command (Docker checkout):
`node table-service/prepare-source.mjs /private/tmp/bdobb-table-ssrm-discovery /private/tmp/ssrm-control-fix-2026-10-15/source`.
`source-export.log` confirms the exact revision and tree. Final policy vendoring:
`OPENBQ_DOCKER_DIR=/private/tmp/openbq-docker-table-ssrm-discovery node scripts/gateway-vendor.mjs v10.0.0 41641c684af4db1c6390ea682e5663daff331bfd`.
`vendor-final.log` records the canonical hash; `package.json` names the same commit.
A later evidence commit changes only metadata/reports. Docker retains the committed
native source above, avoiding a circular evidence repin. Independent scoped review is complete; all findings addressed, no new breakage.
