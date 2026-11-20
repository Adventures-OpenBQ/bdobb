# Sort reuse lifecycle and admission experiment

Evaluation only, on isolated V4 follow-up branch; no production engine/API/PR changes. Extend canonical-sort prototype with one retained entry, explicit structural byte admission, session/input generation/ordering identity, definition except sorting, and runtime comparison. Standard TypeScript comparator only. Rust fallible ordering remains excluded.

Review corrections made:
- Replacement must reserve prior retained entry while the new candidate is built. Added prior canonical/metadata reservation and boundary refusal test. Fault-injected omission reproduces assertion failure; corrected path passes.
- Do not rely on mutable caller input plus identity tokens. captureInput stores a private structured-cloned dataset behind an opaque frozen token in a WeakMap. Mutation of the caller's dataset leaves owned input intact; releaseInput invalidates it. Ordinary worker acquisition/validation is not integrated by this experiment.
- Prepare cache metadata snapshots before publication/store building. A test rejects any structuredClone after the builder returns: RED on old implementation, GREEN after reordering bookkeeping. A failed calculation or builder retains the old entry.
- Added valid promoted runtime parameter changes, including empty selection, instead of the skipped invalid-key placeholder.

Thirty-five lifecycle/parity checks cover dependency hits/misses, new session/input/order identities, model edit, search/filter and hidden-column changes, invalid model/sort rejection, publication failure, clear/release, exact/insufficient/zero admission, replacement budget, caller mutation and valid runtime changes. Existing160 publication comparisons run again with the lifecycle experiment. Unchanged production engine tests are not rerun for benchmark-only scripts.

Reservations understand plain records/arrays/Map/Set and return infinity for unsupported graphs (including BigInt), causing ordinary full-calculation fallback. These are conservative structural reservations, not process heap measurements or supported-device defaults. Acquisition snapshot memory/global worker state is not bounded by this cache-only experiment. Cold failed admission can recalculate twice; initial canonical construction occurs before its exact reservation is available. These limitations block production use.

Timings include result-store construction and ready publication building, three warmups and20 alternating Node observations. Initial cache construction/retention and worker/browser transport excluded. Next design: evaluate canonical-order indexes attached to the existing private publication, avoiding a second retained full graph; integrate pre-allocation admission and per-session/input disposal. Preserve default previous-namespace/proven-absent reconciliation or explicitly fall back for unsupported variants; characterize Rust callback failure before any port. No new default cache size is proposed.
