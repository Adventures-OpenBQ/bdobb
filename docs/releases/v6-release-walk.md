# V6 release walk qualification — 2026-11-20

This record supersedes the October rehearsal status in the historical assembly and SSRM ledgers. Qualification is complete; release readiness additionally requires the corresponding source archive, published assets, checksums and canonical references to be verified.

## Assembly

The combined V6 source includes the qualified V5 carries and the complete applicable contents of frontend PR49 and backend PR16, rather than testing the PR heads separately. V6's column profiles, Rita controls, PDF citations and table tools are preserved. The table service is pinned to c5d1586f7f15770b59b8068e8e6c0f7ea18e5015 (tree 56ac2a263b158f125f8fdbd645d7536b4451dabe); its Rust source is unchanged by the subsequent client repairs. The backend is 04004d8af0afda6d5b50d9c4b9af6e8e0391199a. The Rita recipe is 5fe6bcf36a5eeeb50b301b630217dc02f96b31c6, using openbq-org/agent-rita f673c1fbeeeedfdbf4a253031d85eb8e96538924 and patches 0001–0023 (no 0005).

## Reader and registered tests

Fresh containers use separate empty volumes and Tailscale routes; registered provider keys are runtime environment values, not image or repository contents. The reader receives only public demo credentials. The registered pass is a separate lane.

- Reader 738 cases: 691 actual data, 5 content, 6 valid input/protocol controls, 33 Deribit maintenance controls and 3 known empty publisher results. Direct Deribit currencies and instruments controls still returned HTTP 503/system_maintenance11051 at 21:12UTC. Maintenance and empty controls are not data successes.
- Ten distinct public EIA attempts: 1 returned 186 observations and 9 reported the public quota. These completed on the same exact V6 image before the first container's later memory failure; the second fresh public run reused those receipts without spending quota again. All ten matching registered EIA cases returned data.
- Seven demo Congress PDFs, five TMX UDF protocol cases, and an anonymous publisher Excel file passed. The Excel file parsed as four sheets with 133,776 finite numeric cells.
- Registered 407 cases: 394 actual data and 13 content, no failures. The owned container, volumes and route were removed, and the shared Tailscale configuration was restored exactly.
- The first reader's OOM and resulting transport failures remain recorded as a failed attempt. The second run was monitored and had no OOM or restart; completed older regression APIs were stopped to free memory.

No mandatory-widget flag was found in the catalogue or recipe. These results distinguish actual data, expected controls and external unavailability rather than inventing a mandatory subset.

## Current code checks

Frontend: 8,495 passed, 45 opt-in skips in the ordinary run. All 45 opted cases ran separately: 25 live Rita checks, 13 agent-conformance exercises, 6 reference-backend checks and 1 actual self-hosted Workspace sign-in test. Live Rita used the selected affordable default, openai:Qwen/Qwen3.6-35B-A3B. The Workspace test used a fresh instance and disposable account and verified that no password or session token was stored; its state and credential file were removed.

Rust core 221, wire 13 and Wasm crate 1 passed. Managed Linux service 79 tests passed on each architecture, with actual production-image runtime checks; AMD64 ran natively in CI 44807094025. Both SDK architectures passed 191 provider tests and 74 gateway checks. Lane tests 91, backend JavaScript 8, recipe tests 48 and web checks 51 passed. Type checking, lint and native build passed.

The current compiled Wasm/acquisition corpus passed 855 cases: 852 worker-page checks across 733,457 source rows and 3 no-data controls. Inputs are frozen prior provider responses and the unchanged synthetic fixture, not fresh provider calls. Renderer source comparison with qualified V5 found 55 identical modules and 8 changed modules. This is scoped source/worker evidence, not a claim that every advertised widget was newly rendered in the native app.

## Native checks and repairs

The normal production app, without a debug MCP bridge, used the authenticated Tailscale gateway and fresh qualification API. Cold CFTC points, curve, volatility, paged forwards and options all returned actual data; the five cards exposed 4,810 cells. Requests taking over 15 seconds completed instead of being cut off at the former 12-second GET timeout.

Native Rita chat, MCP discovery, note creation, Stop, Undo and a subsequent turn were exercised. A Stop bug discarded completed tool history, allowing the next turn to repeat an earlier creation; the repaired client retains completed rounds and an explicit stopped marker. The exact native sequence then kept undone notes removed. MCP tools/call uses the bounded 170-second data budget while discovery retains 10 seconds; a real cold EIA MCP request exceeded the old budget. The repaired native client returned five rows and the value 58.925 through the configured MCP server.

Rita repairs advertise the configured compatible model, pin Bun 1.4.5 by digest, create and retain the unprivileged feedback directory, and retain bounded executed inputs beside model-facing tool results. Both architecture images were verified against 67 source/lock files. Feedback validation and persistence across container replacement passed. A controlled context-sharing-off note request produced one note and a long answer after the input-history repair.

The native reference imported two dashboards with 74 card instances from the 72-widget fixture. PDF base64 and URL views rendered. Rita loaded the sample PDF, cited its exact sentence, and clicking the citation highlighted that sentence on the PDF page. The actual FX table and linked 3-D surface rendered; linked-chart configuration expanded and folded as parameters. Camera dragging is not newly qualified here; the earlier documented CUA held-button limitation is not claimed as physical interaction proof.

A visible Statement initially reported runtime-not-ready to Rita because its view did not retain the shared coordinator, and ordinary backend Statements used a private renderer worker. The repaired ownership path passed a failing-before/passing-after regression and native testing: rows_profiled 2, operating cash flow 12–33, capital expenditure −18 to−5. Leaving its tab correctly withdrew readiness instead of serving cached profile values.

A restricted fault-injection test now explicitly names its available fallback writer while preserving malformed-save refusal, warning, successful same-card retry and saved-content assertions. A separate negative table exercise exposed an invented preview after refusal. Tool and skill guidance now states that a refusal is not a computed preview and prohibits executing substitute aggregations without a request. The strengthened test rejects successful substitutes and unsupported numeric claims. Both live table cases and the final combined 25-case suite passed; the earlier failures remain in the audit history.

## Boundaries

Reference code-execution opt-ins and publisher maintenance are not silently treated as successful data. Reader and registered evidence remain separate. V7 physical iPad acceptance is a later gate; neither this desktop qualification nor the source comparison substitutes for it. V11 and Databento are outside this walk's scope.

## Update 2026-11-28: the backend this release is paired with

The Assembly section above names backend `04004d8af0afda6d5b50d9c4b9af6e8e0391199a`. That was the backend on 20 November. It is the openbq-docker tag `v6.0.0-before-rita-transport`, and it is not the backend V6 was finally qualified against.

| Item | Value |
|---|---|
| Backend at the 20 November qualification | `04004d8af0afda6d5b50d9c4b9af6e8e0391199a` |
| Backend pin in `package.json` until 28 November | `a5ed6789401e41e3d6c0241668ab5fd14d9fa520`, the tag `v6.0.0-before-final` |
| Backend the release was finally qualified against | `4d75df0c68c8010baa7ee966679e825bd1b6dcbf`, the openbq-docker `v6.0.0` tag and the tip of its `release/v6` branch |
| Backend pin from 28 November | `4d75df0c68c8010baa7ee966679e825bd1b6dcbf`, by pull request #96, merged as `128ebb6721569b20106ac533a00cdeeee45496c4` |

The release walk's readiness record of 25 November names client `1f2deea9f2995012b6c5f1075b875e3e8fe4c4dd` and backend `4d75df0c68c8`. That client is the commit pull request #96 was based on. The pull request changed only the backend pin, the vendored policy's recorded commit, the source-offer files and the CI workflow's history-scan flag. No product source changed, and the vendored policy's bytes are the same.

The Rita recipe is unchanged at `5fe6bcf36a5eeeb50b301b630217dc02f96b31c6`, with patches 0001–0023 and no 0005.

### Checks made on 28 November for this change

- **CI on the pull request head `7d4be3ff4043`:** all six jobs passed (build, pivot, reference, public-content, scrub, e2e). The workflow does not run on pushes to release branches, so the merge commit has no run of its own.
- **Fresh public reader lane** against a backend image whose revision label is `4d75df0c68c8`: 998 catalogue entries served, provider cache empty before the first request. Ten distinct public EIA cases were attempted: 2 returned data and 8 returned the provider's rate-limit message. Quota-limited cases are not passes. No case failed.
- **Live Rita suite, 26 cases, client `1f2deea9f299` against backend `4d75df0c68c8`, model `Qwen/Qwen3.6-35B-A3B`:**
  - Through a private inference route: 26 passed, 0 failed, 0 skipped.
  - Through DeepInfra: 25 passed and 1 failed. The failed case was "writes an answer into the note on each of twelve tabs: every card saved exactly once (#326)", where no note was saved on one tab. Retested alone, that case passed. This is a composed result, not a clean 26 of 26 on DeepInfra, and the original failure stands.
  - These runs delivered credentials with a copy of the reviewed launcher in which one acknowledgement timeout was raised. That copy has not had the independent review the original had, so the Rita results here are supporting evidence, not release qualification.

### Corresponding source

Source identity `396cb448ca93b1a78c4d97b82502eff77ae80cae5fc326816b010787541ed793`, archive `bdobb-v6.0.0-agpl-396cb448ca93-source.tar.gz`, 16,475,923 bytes, SHA-256 `e591b746cdf92fc30116b10ca4870096bccc1ec41690c871e64b36d1294a8fbc`. Published as release `agpl-v6.0.0-396cb448ca93`, targeting `128ebb672156`; an anonymous download matches that hash. The archive passes its own verifier and was built to identical bytes on two machines. No actual-value privacy scan was run on it; it differs from the previously published source only in the pin, source-offer and CI workflow files. The previous identity `17a90fb916a6` remains published.

### Not done

No installer was rebuilt from the merge commit, and no registered-key, native or device test was re-run. The readiness evidence of 25 November is retained for this change; it was read, not re-audited.

### Note for whoever merges this update

`SOURCE-MANIFEST.json` lists this file. Changing it changes the branch's tree, so after merging, the branch tip will no longer match its bound source identity until the source offer is re-bound and a new source release is published.
