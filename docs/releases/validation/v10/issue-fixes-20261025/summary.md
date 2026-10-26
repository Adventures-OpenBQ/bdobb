# V10 issue-fix qualification

Runtime source: `534a73ab1da0dd81b167ee7f5572fd9db4dbd26a`. Backend candidate: `c3b0ce0d2955ffaa9a2adc1cefa4561626fb08d4`. Record-only commits after this source do not change the qualified runtime.

The final native suite passes 8,756 tests with 31 skipped. Qwen passes the complete 19-test live cycle. Earlier failed cycles remain part of the audit; the first engine-summary cycle was 18/19 because the model printed a proposed arrangement instead of calling its tool.

Fixes increase finite cold-discovery deadlines for the large backend catalog, distinguish explicit calendar-year grouping from quarter grouping, and render table-result rows, warnings, exact source counts and Undo state from trusted client engine results. Arbitrary model table summaries are replaced. As approved by the user, table-result turns visibly direct unrelated explanations to a separate message. Other tool execution and artifacts continue. Completed tool history survives Stop during a later model response or tool call.

A matching proposal returned as pure chat JSON receives at most one additional model response with neutral protocol feedback. The feedback grants no additional edit authority, treats intentional proposal-only requests as complete, preserves read-only preview intent, and is consumed by one POST. Chat JSON is never executed automatically. Engine validation and the one-arrange-call acceptance gate remain intact.

The real browser/table-worker check renders the engine's 30/90 values, rejects an injected invented total, displays the notice, and verifies Undo. The rebuilt native Mac app independently passes summary, Undo, cold-discovery and recorded-grid checks. Both native artifacts match all 4,429 tracked source files, apart from their dedicated audit identities. Mac and signed iPad builds succeeded.

The final signed iPad app installed successfully over direct USB on 2026-10-26, preserving audit data. After Developer Mode was enabled and the iPad unlocked, devicectl launched the app and Device Hub showed the final build. The pointer broker could not operate the mirror controls, so the operator supplied the final observations: the Qualification Server recovered its connection, the expected AAPL −40 / MSFT 120 combination appeared, and the prices continued ticking up and down as the recorded fixture intends. The physical gate passes on those explicit observations. Earlier physical Files, sync and persistence evidence remains historical and is not presented as a new run of those workflows. No licensed real q/PyKX deployment is claimed by the simulator/fake-backend tests.

During the final check, Docker reported the disposable API fixture had been OOM-killed. Restarting only that owned container restored authenticated catalog, apps and settings responses. Three bounded sequential catalog reads returned 1,053 widgets and kept container memory near 2.73 GB; they do not prove the earlier OOM's precise cause or long-duration stability. The recovered connection and cycling prices were then confirmed on the physical iPad. This environment incident is retained in the evidence, not described as a fixed application memory defect.

The backend root, kdb simulator, gateway, recorded live-grid and key-maintenance suites were already verified on unchanged backend runtime source. The two simulator endpoint assertions now match their configured kdb service endpoint.

DeepSeek's single availability probe was billing blocked; no new DeepSeek qualification is claimed. Luna was skipped. No paid-model inference or new Claude qualification was used for this V10 run. V11 remains paused. The user authorized pushing verified V10 release branches after completion; the final device gate has passed and release promotion is authorized. Existing version tags remain unchanged.


Disposition: V10 is qualified for the authorized release-branch push. Qualified runtime source remains `534a73ab`; this record-only commit changes no runtime files. Existing version tags and all V11 refs are preserved.
