# Private table ingestion

Node acquires and parses source data. Rust validates the returned shared wire dataset and performs table calculations. This directory does not expose an HTTP server or accept client URLs.

Build and check with the existing locked project dependencies and Node 26:

```sh
node scripts/build-table-ingest.mjs
node node_modules/typescript/bin/tsc --noEmit -p server/table-ingest/tsconfig.json
node node_modules/vitest/vitest.mjs run server/table-ingest
cargo +1.98.1 test --offline --manifest-path crates/table-service/Cargo.toml
```

The test suites bind private loopback HTTP servers. Restricted development sandboxes need permission for that operation. The package scripts `table-ingest:build`, `table-ingest:typecheck` and `table-ingest:test` provide the same entry points.

## Native integration

`Ingestor::new(IngestConfig, ServiceLimits)` creates a cloneable global admission boundary. Its `ingest(&SourceLease, widget_id, input_revision)` method returns `Result<pivot_core::contract::SourceDataset, ServiceError>`. Run this synchronous operation on a blocking executor. The HTTP/session layer must authenticate, acquire an owner-scoped lease, apply per-principal job admission, and publish a snapshot only after successful ingestion. Ingestion never writes or removes the source.

`IngestConfig` requires absolute Node and built-entry paths, an optional absolute private backend config path, a positive `max_concurrent_children`, and `max_child_heap_mb` between 16 and 65536. Clones share the admission counter; additional jobs fail immediately instead of queueing. Service limits bound acquired bytes, emitted wire bytes, rows, columns and job duration. The native process drains bounded nonblocking pipes, retains no stderr content, and kills/reaps failed or timed-out children. The V8 heap flag bounds the JavaScript heap, not total RSS; deployment container memory and workload qualification remain necessary.

The internal transport consists of one unsigned 32-bit big-endian byte length and exactly one UTF-8 JSON message in each direction. Requests are enum operations `file` or `backend`. Successful responses use the existing `encodeRequest(registerInput)` and `pivot-wire::Request` contracts, including tagged cell and metadata values. No second value codec is implemented. Extra/truncated frames, invalid wire values, failed exits, and incorrect request/revision/session correlation refuse the entire result.

## Private backend configuration

The JSON file uses the `ServerBackendConfig` type exported from `backend.ts`. Keep it in private operator storage; the recommended local filename `sources.local.json` is ignored by Git. Example:

```json
{
  "maxBytes": 67108864,
  "maxRows": 1000000,
  "maxColumns": 4096,
  "timeoutMs": 60000,
  "backends": {
    "configured": {
      "label": "Configured data",
      "url": "http://configured-backend:6900",
      "widgets": {
        "financials": {
          "label": "Financial statements",
          "url": "http://configured-backend:6900/table",
          "headers": {"Authorization": "Bearer OPERATOR_CONFIGURED_SECRET"},
          "parameters": ["symbol"],
          "response": {
            "kind": "rows",
            "rowsPath": ["results"],
            "columns": [{"id": "value", "label": "Revenue", "metadata": {"fiscalYearEndMonth": 9}}],
            "provenance": {"sourceWidgetId": "financials", "sourceKind": "backend", "metadata": {"fiscalYearEndMonth": 9}},
            "completeness": {"kind": "partial", "warnings": ["Upstream acquisition cap"]}
          }
        }
      }
    }
  }
}
```

`response.kind: "dataset"` accepts an existing complete `WidgetDataset` structure and preserves all its supplied metadata, revisions, provenance, fiscal evidence, completeness and freshness. Here “complete structure” does not assert that all upstream rows were acquired. `response.kind: "rows"` accepts ordinary JSON records, either directly or through the optional operator-configured `rowsPath` of own object keys. Declared columns retain order and metadata, including when there are no rows. Missing declared fields become null. Undeclared fields are appended with their literal names. Configured provenance and completeness are retained; acquired row count is observed from the response. Omitted completeness becomes `unknown`, never an inferred `complete`. Only explicitly configured upstream evidence should claim completeness.

Clients supply only `{backendId, widgetId, params}`. These IDs and allowed parameter names must also appear in `CatalogConfig.backend_widgets`. That catalog policy and the private upstream definitions are independent, and both must admit a binding. Unknown IDs, disallowed parameter keys, nested parameter data, URL-like parameter values, and redirects are refused. Scalar parameters use decimal/boolean/string query values; null becomes an empty query value. Flat arrays become repeated query keys, in array order. No object is implicitly stringified. Operator headers are injected only into the configured GET request. A backend may name its base `url`, as a client connection does. When a binding's `period` is a statement period value, ingest reads `<url>/widgets.json` with the configured widget's own headers, finds the entry whose endpoint resolves to the widget's `url` (the entry's key need not match the widget ID), and applies the client's `isStatementPeriodParam` to its params. A statement widget's rows are then relabelled by the client's `correctStatementRows`, from `<url>/api/v1/fundamentals/fiscal_year_end?symbol=` per symbol with the same headers, so a server table reads the labels a local statement card reads. A widget that is not a statement widget is left alone. With no `url`, a widgets.json that fails or lists no matching entry, or a failed year-end lookup, the rows stay as reported and carry the `FISCAL_AS_REPORTED` diagnostic, which the card shows as its note. Nothing is configured per widget. The same widgets.json entry is read for every binding of a backend with a `url`: each declared column whose `data.table.columnsDefs` entry carries a valid `aggregation` hint (the client's `toAggregationHint`) gets it as `metadata.aggregationHint`, which Rita's `describe_table` and `arrange_table` read. `response.kind: "dataset"` is never relabelled or hinted. Node's native fetch is used; Tauri HTTP is not imported.

`backendDescriptors(config)` returns only backend/widget IDs, labels and allowed parameter names. Native HTTP discovery can instead derive these IDs and parameter names from `CatalogConfig.backend_widgets`, using IDs as labels, without loading the private upstream JSON. Never return URLs, headers or the private configuration to clients.

## Runtime packaging

The generated `dist/child.mjs` is ignored and reproducibly built with the pinned `esbuild` development dependency. Its only runtime package dependency is **`xlsx` 0.20.3**, pinned by the root lockfile to the SheetJS tarball; that package declares no dependencies. All application parser and wire code is bundled. The built entry imports Node builtins and dynamically imports `xlsx`; every other package it uses, such as `@internationalized/date`, is bundled into it and listed in `THIRD_PARTY_NOTICES.md`.

A production image needs Node 26, the built entry, and the actual complete SheetJS package directory at a resolvable `node_modules/xlsx` location beside the entry or in an ancestor. Copy/dereference the real package directory, not a pnpm symlink whose store was omitted. Preserve its package metadata, exports, code and license files. The remaining frontend dependencies and esbuild are not runtime requirements. Also provide the native service binary, a private source volume, and the optional private backend configuration. Linux/container execution and production memory measurements are separate qualification work.
