# Carry qualified V10 behavior onto current main

The user authorized the existing post-release carry strategy: preserve newer main work, incorporate missing V10 fixes, test the combined result, and keep V1–V10 closed. Main remains version 11; this is not another release walk.

## Approach

Port behavior and its regression tests onto the current main architecture. Whole-tree overlays would erase newer TemporalDB, PostgreSQL settings, calendar, query, and routing work. Blind cherry-picks cannot establish parity across the unrelated assembly histories. Preserve newer behavior while adapting each missing contract.

## Required behavior

- Backend/auth scope changes discard stale live state and abort stale requests; delayed seeds retain newer candles.
- Explicit time bounds normalize to UTC and clip historical and stitched results.
- Locked/viewer Day Chart configuration cannot reorder symbols.
- Replacement subscriptions enforce the projected account cap before registration.
- Browser ordinary and hide-time saves carry persisted per-file writer/sequence fences. Relays verify acknowledgements. Both legacy storage and the current PostgreSQL settings service enforce ordering atomically, including deletions, without losing existing quota/encoding/auth guarantees.
- Reconcile the full runnable-source carry inventory, including older chart, table, native, provider, recipe, privacy, and build fixes. Documentation-only historical differences do not imply missing runtime features.

## Preservation

Preserve all newer main-only source and shared-file integrations, especially TemporalDB, query/library views, calendars, settings migration, and Rita/MCP routes. Keep the existing version lineage and public compatibility. Do not alter release branches, V1–V10 tags, published assets, or private container visibility. Exclude the deferred DataBento collector.

## Validation and integration

Run regressions against the actual combined code. For every ported defect, first reproduce it on main with the behavior test, then verify the repair. Run the combined project suites/build/type/lint checks, relevant browser/native checks, and fresh task-owned runtime checks for changed services. Keep reader/demo and registered-key evidence separate when live provider verification is necessary. Preserve newer-main tests as part of combined validation. Review public changes for internal identifiers and secrets. Refresh source metadata for the integrated main source; old V10 receipts cannot qualify new main code.
