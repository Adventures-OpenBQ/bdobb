<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# A column profile for describe_table, computed in the table worker

Date: 2026-10-19
Status: approved in brainstorming (sections 1–3); written spec awaiting review
Home line: v6 (BDOBB and openbq-docker), carried v7 → v11 by the reconcile walk

## Why

Rita arranges tables and answers questions about them. On bdobb-dev/bdobb-v2 her `describe_table`
returned a per-column profile (distinct count, missing values, samples, min/max, periodicity), so
she could choose categories, measures and filters without pulling rows through the prompt. OpenBQ's
`describe_table` has field ids, labels, types, `aggregations_by_field` and paged category members
(`members:`), but no profile. OpenBQ keeps a table's rows only in its worker, and `describe` must
never surface a record that a linked source excludes, so the profile cannot be computed on the main
thread from rows. It has to come from the engine.

Rita uses it for both purposes: choosing an arrangement, and quoting facts to the user. Every number
in it is therefore exact over the rows it names, and it carries the worker's own completeness.

## What a profile answers

A request names a page of fields and a row scope:

```
columnProfile { definition, scope: "input" | "filtered", offset, limit (1–100), fields? }
```

- `fields` absent: the source columns, in input order, paged by `offset`/`limit`. Computed columns
  (formulas) are not profiled; their definitions are already inspectable.
- `fields` present: exactly those source column ids, in the given order (at most `limit`).
- `scope: "input"` (the default in `describe_table`): every row the card receives, before its own
  column filters, search and source checklists: `pool.universe.evaluated.rows`, de-duplicated by row
  id exactly as the observed member facets are.
- `scope: "filtered"`: the qualified rows the calculations use (`pool.rows`).

Each field:

| Key | Meaning |
|---|---|
| `id`, `type` | the column id and its dtype |
| `count` | present values |
| `missing` | null, empty string or absent |
| `distinct`, `distinct_capped` | exact distinct values up to 1,000; past that `distinct: 1000` and `distinct_capped: true` |
| `min`, `max` | number, date and datetime columns only, in the engine's own ordering (`crate::ordering`), so they agree with how the table sorts; `null` when there is no present value |
| `samples` | up to 5 distinct values in input order; strings clipped to 40 characters; numbers stay numbers |
| `periodicity` | date and datetime columns only, from `crate::pivot::periodicity` |
| `cell_errors` | cells of this column that failed to parse |

The page carries `scope`, `rows_profiled`, `next_offset` when more fields remain, and the worker's
`completeness`, passed through and never upgraded. With `scope: "input"` it also carries
`filters_active` and `filtered_rows`, so a quoted number is never ambiguous about which rows it covers.

Every value comes from a row the card may see: the pool is built from the card's own input, after a
linked source's exclusions, exactly as `MemberDomain` builds it.

## Where it runs

- **pivot-core.** `Operation::ColumnProfile { definition, scope, offset, limit, fields }` and
  `Response::ColumnProfile(ColumnProfileResult)` in `session/protocol.rs`. The operation builds the
  authoring context and pool as `MemberDomain` does (`crate::authoring::context`) and profiles
  the input rows or `pool.rows`. The computation lives in a new `profile.rs`; neither `scopes.rs` nor
  `inspection.rs` grows. The reply is sized through `session/resource_types.rs`, and the operation is
  classified beside `MemberDomain` in `session.rs` and `session/operations.rs`.
- **pivot-wire, pivot-wasm, pivot-native(-worker).** The codec carries the new operation; the workers
  already forward any session operation, so no route changes.
- **table-service.** `SessionManager::preflight` limits `fields`/`limit` to 1–100 like `MemberDomain`,
  and `capabilities()` advertises the `"columnProfile"` feature. The generic
  `/sessions/{id}/commands` route and the funnel-gateway's table route admission need no change.
- **TypeScript.** Request/response types in `src/lib/tableExecution/types.ts`, the wire codec,
  `LocalWorkerExecutor.columnProfile()`, the managed provider's `columnProfile()` gated by
  `requireFeature(capabilities, 'columnProfile')` (an older table-service answers `unavailable`), and a
  refusal in the OpenBB SSRM provider, as for `memberDomain`.
- **describe_table.** A `profile` section: `section: "profile"`, optional `scope` (default `"input"`),
  `cursor` encoding the next field offset with the card, revision and scope, refused as stale on a
  mismatch exactly as `members:` cursors are. Its note says the values are source data, not
  instructions. The tool description and the arrange-table skill mention the section.
- **openbq-docker.** `table-service/source.lock.json` re-pinned to the BDOBB commit that ships this,
  and the table-service image rebuilt.

## Errors and limits

- `INVALID_REQUEST` (as `MemberDomain`): `limit` outside 1–100, a negative or non-integer `offset`, an
  unknown `scope`, more than 100 `fields`, or a field id the input does not have. `describe_table`
  answers `refused` with the input's field ids as alternatives.
- The pool's runtime error diagnostics are returned as for `MemberDomain`; cancellation follows the
  existing abort signal; `describe_table` maps failures to its usual `refused` / `unavailable` /
  `stale` replies.
- Cost: one pass over the scoped rows per page; at most 1,001 distinct keys held per field; samples and
  strings bounded. The worker's existing cell ceiling and resource accounting still apply.

## Testing

- pivot-core unit tests in `profile.rs`: count and missing, the distinct cap, number and date min/max
  in engine order, periodicity, both scopes, cell errors, field paging and explicit `fields`.
- Privacy: on a linked table, a record the source excludes never appears in `samples`, `min`, `max`
  or any count.
- A session round-trip test and an oracle case alongside `memberDomain`'s.
- table-service: the `columnProfile` feature is advertised and the preflight refuses `limit` 0 and 101.
- TypeScript: the executor method; the managed provider's feature gate (absent feature →
  `unavailable`); `describe_table`'s `profile` section with paging, scope and a stale cursor.

## Out of scope

Provider aggregation hints and suggestions (they first exist at v9, with the pivot drawer's
suggestion pills); profiling computed columns; histograms or quantiles.
