# SSRM decisions

Verbatim Ruling lines from task progress, preserved before scratch cleanup.

Ruling: Use the already isolated fresh clones rather than creating nested worktrees — protects original dirty repositories and avoids attaching the unrelated article repository — cost if wrong: work remains in temporary paths until explicitly moved.

Ruling: Task 1 response type is pivot_core::session::CoreResponse, not contract::CoreResponse — actual source determines the import — cost if wrong: compile error, caught by tests.

Ruling: Include build-pivot-wasm source fingerprint and packaging-fixture updates in Task 1 — the extracted codec must invalidate/rebuild Wasm — cost if wrong: packaging change requires review and regression tests.

Ruling: Continue feature execution while retaining baseline failure evidence — initial failures arise before our changes and setup issues are repairable — cost if wrong: regressions could be misclassified unless final rerun is clean or precisely compared.

Ruling: Native ordering uses an ICU4C 78.3 FFI shim matching installed Node26 ICU78.3/CLDR48 rather than unverified ICU4X data — preserves baseline collation and avoids unavailable Cargo crate — cost if wrong: native build/image must supply pinned ICU and other browser ICU versions may differ; parity fixtures and explicit version qualification required. Task10 must package pinned ICU78.3.

Ruling: Source deletion frees active-source quota; deleted idempotency records use separate bounded retention (default24h, configurable) instead of consuming lifetime source slots — repeated upload/delete must remain usable — cost if wrong: retries after retention may create a new source ID and admission can temporarily refuse when tombstone capacity is reserved. Task3 must document retry window and never resurrect old IDs.

Ruling: Startup structurally validates stored backend registrations, while current allowlist revocation is enforced on read/acquire — changing one configured widget must not brick all other durable sources — cost if wrong: revoked metadata remains on disk until owner deletes it, but cannot be acquired.

Ruling: Isolate native result workers in OS-memory-bounded processes, keeping unsuitable core max_state_bytes disabled only INSIDE contained workers; preserve existing Wasm protection and input/output limits — satisfies full semantic parity plus real memory containment without guessing transient-memory formulas — cost if wrong: extra process/IPC overhead and Linux containment qualification; HTTPdriver must change, macOS backend may require Docker.

Ruling: Represent standard-provider live consistency explicitly while retaining a nonempty opaque correlation token in the legacy sourceSnapshotId field; do not use an empty sentinel or widen every existing identity to nullable — preserves the established identity shape while honest consistency guards block snapshot-only adapters/operations — cost if wrong: legacy field naming remains misleading unless every new remote consumer checks consistency; tests and Task8 branching must enforce that boundary.

Ruling: Add a server-side derived-session prerequisite for managed linked tables before consumer integration — existing tableExecutionStore linked branch downloads presented subsets and registerInputs a local worker, violating approved no-browser-execution fallback — cost if wrong: extra private HTTP/provider API and bounded server memory/lifecycle work; gateway policy and qualification must include the route. Preserve local linked behavior and refuse standard LIVE derivation.

Ruling: Preserve existing WidgetCard export semantics (ignoreSelection=true, full eligible presented table) for managed parity, while selected presented/chart/linked requests honor selection — Task9 plan selected-export wording is broader than approved full parity and existing code explicitly documents full eligible export at WidgetCard1015–1028 — cost if wrong: users expecting selection-only download must use a future explicit selected-export action; tests must distinguish full export from selected consumers, with neither restricted to loaded pages.
