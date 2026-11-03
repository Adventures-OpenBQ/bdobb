# Retained TemporalDB results as managed table input

The operator configures `temporal-backends.example.json` as the service's private backend configuration. Replace the placeholder privately; do not commit credentials. Use a distinct table principal for each authorized workspace/entitlement boundary and a corresponding TemporalDB credential. An unmapped principal is refused before network access. Keep table and TemporalDB grants/revocations aligned; a table session is an authorized scoped copy, not a provider entitlement of its own.

The matching catalog configuration admits only this binding:

```json
{"backend_widgets":{"temporaldb":{"temporal_execution":["execution_id","expected_hash"]}}}
```

A query binding may select the existing managed table connection by ID:

```json
{"tableExecution":{"kind":"managed","version":1,"backendId":"tables","sourceBackendId":"temporaldb"}}
```

The browser passes execution ID and expected result hash, never an upstream URL, artifact path or provider credential. The trusted ingestion child receives its principal from the authenticated source lease. It reads retained result pages, requires stable exact counts/schema/receipt, exhausts the result within row/column/byte/time limits, and only then admits a complete table source. A partial or over-budget import is refused; it is never represented as a complete source.

Session opening returns a bounded tagged temporal source receipt. The client validates the expected execution/hash before accepting the session. Sorting, filtering, pivots, linked derivation and exports then use the existing managed table protocol over that full immutable source. Exact decimal and large-integer strings stay strings; they are not silently converted into floating-point measures.

This path does not execute provider acquisition. Refreshing a live query creates another execution; reloading a pinned execution reads that same retained execution. The imported catalog binding is retired when its client session is disposed. Existing managed session expiry, ownership and resource limits still apply.

The whole-result selector and automatic acquisition policy UI are wired in the later widget/MCP task. This example documents server configuration, not a claim of a deployed topology.
