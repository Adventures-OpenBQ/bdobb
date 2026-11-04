# Pivot qualification matrix

Target: release/v4. Inventory baseline: `ed169dd1d6f0ba88cf5a8a2bb0945efaba27d828`. Requirements: approved 2026-11-03 design sections A–G. This is an assertion inventory and gap map, not evidence that unexecuted qualification passed. The previously reported 108 Statement tests in 12 files are historical baseline evidence; Task 1 verification is recorded in its report.

`Existing` means an assertion was located, not that it satisfies the entire requirement or has run here. Paths in the table are under `src/lib/statementModel/`, except `resultStore`, `linkedAnalytical` under `src/lib/tableExecution/` and the new verifier under `scripts/pivot-qualification/`. Required engine/platform execution remains a gap until attributable results exist. Correctness and required platform evidence gate release; performance is advisory. Limits/calendar changes are excluded.

| ID | Spec | Requirement | Located assertion file | Named assertion | Coverage / gap | Tier | Required environment |
|---|---|---|---|---|---|---|---|
| PIVOT-A-01 | A | Missing versus zero; negatives; optional/required lines | missingLines.test.ts | long shape: an optional line with no facts is blank, not #ERROR | Existing partial; new explicit zero/negative golden | PR | Node/TS and WASM |
| PIVOT-A-02 | A | Distinct duplicate fact IDs and duplicate row identities | compile.test.ts | duplicateFactsFailWithoutRevisionGuess | Existing partial; new distinct-ID/identity cases | PR | Node/TS and WASM |
| PIVOT-A-03 | A | Original/amended filing as-of selection | — | — | New; not run | PR | Node/TS and WASM |
| PIVOT-A-04 | A | Multiple companies, currencies, units; no silent mixed totals | linePolicy.test.ts | refuses mixed company currency and unit and preserves incoming errors | Existing refusal; new separate-company comparison | PR | Node/TS and WASM |
| PIVOT-A-05 | A | Annual/quarter overlap; fiscal boundaries; 52/53-week evidence | compile.test.ts | annualQuarterOverlapBlocked | Existing overlap; new real fiscal-boundary execution | PR | Node/TS and WASM |
| PIVOT-A-06 | A | Flow accumulation, stock endpoints, single refusal | linePolicy.test.ts | stockFlowRatioScopesDiffer: flow sums, stock selects latest explicit endpoint, single refuses rollup | Existing | PR | Node/TS and WASM |
| PIVOT-A-07 | A | Dependency scope, hidden formulas, required errors | compile.test.ts | hidden derived member remains a valid formula dependency | Existing; see assertion inventory | PR | Node/TS and WASM |
| PIVOT-A-08 | A | Absent, mapped and derived lines; reported versus calculated gross profit | catalog.test.ts | keeps provider aliases distinct and cash observations stock | Existing partial; new SEC execution | PR | Node/TS and WASM |
| PIVOT-A-09 | A | 98 facts / 110 Decimal cells, safe integers, fractional conversion refusal | verify-fixtures.node.mjs | unchanged_corpus_has_98_facts_and_110_expected_cells | New fixture verification passed; engine execution not run | PR | Node built-ins |
| PIVOT-A-10 | A | Refusal kind/scope/affected identities | linePolicy.test.ts | rejects duplicate stock facts before endpoint selection and incomplete flow spans | Existing partial; new identity assertions | PR | Node/TS and WASM |
| PIVOT-B-01 | B | Same seeded filter/sort/group/split/select/unselect/clear/reset/source trace | — | — | New; not run | PR fixed / extended rotating | TS + built WASM |
| PIVOT-B-02 | B | Values, errors, identities/order, subset, completeness, provenance | resultStore.test.ts | all responses preserve context and chart/subset IDs and revisions | Existing partial; new differential trace | PR / extended | TS + built WASM |
| PIVOT-B-03 | B | Explicit [] yields zero; clear/no selection yields eligible rows; removed identities | — | — | New dedicated regression; prior external fix is not suite evidence | PR | TS + WASM workers |
| PIVOT-B-04 | B | Typed collisions/nulls/formulas; saved seeds/traces and minimization | — | — | New; not run | PR / extended | TS + built WASM |
| PIVOT-B-05 | B | Stable IDs/dependencies beyond viewport | compile.test.ts | derived row selection survives reconciliation and reorder | Existing partial; new viewport-independent parity | Extended | TS + WASM |
| PIVOT-C-01 | C | Company/line switching, empty filter, all/clear/reset, error selection | — | — | New; not run | PR short / extended | Browser workers |
| PIVOT-C-02 | C | Chains/siblings: Statement, value chart, original raw drilldown | resultStore.test.ts | reselected child reaches chart and subset while sibling stays excluded | Existing unit seam; new browser chain | PR / extended | Chromium workers |
| PIVOT-C-03 | C | Excluded units, missing chart fields, renamed USD allowlist | — | — | New; not run; general unit guard out of scope | Extended | Browser workers |
| PIVOT-C-04 | C | Delayed/out-of-order, cancel, dispose/remount, source revision during transfer | — | — | New; not run | Extended | Transport fault injection + browser |
| PIVOT-C-05 | C | Stale coherent figures; successful empty clears; errors never current numeric | — | — | New visible-output acceptance; not run | Extended | Chromium/WebKit |
| PIVOT-D-01 | D | Pinned definitions/mappings/links/export-import | persistence.test.ts | snapshotReopensWithoutCatalog: Workspace interchange carries the exact pinned snapshot and remaps linked owners | Existing serialization; new app restart/local data | Extended / release | Browser + native macOS |
| PIVOT-D-02 | D | Durable selections versus session viewer params; reset/defaults | updates.test.ts | resets local changes while preserving bindings and Page membership | Existing model reset; new lifecycle acceptance | Extended / release | Browser + native macOS |
| PIVOT-D-03 | D | Missing/replaced local files, template labels/versions, chart fields | updates.test.ts | maps all stable semantic references across version prefixes without consulting display labels | Existing template mapping; new missing-file/chart acceptance | Extended | Browser + native macOS |
| PIVOT-D-04 | D | Public provenance; no private evaluator state or upstream formula replay | linkedAnalytical.test.ts | treats upstream formula columns as received values without replaying the producer formula | Existing unit coverage; new lifecycle acceptance | PR / extended | Node + browser workers |
| PIVOT-D-05 | D | Cross-window both directions and viewer persistence contract | — | — | New; not run | Release | Native macOS windows |
| PIVOT-E-01 | E | Worker termination, malformed input, documented row/column/byte limits | — | — | New qualification scenarios; not run | Extended | Browser workers |
| PIVOT-E-02 | E | Interrupted subset/refused acquisition; first/replacement failures; no partial completion | — | — | New fault matrix; not run | Extended | Transport seams + browser |
| PIVOT-E-03 | E | Previous coherent stale/error result; retry/reset recovers in-app | — | — | New; not run | Extended / release | Browser + native macOS |
| PIVOT-F-01 | F | Bulk 100k / 1m / 3,658,551 rows preserves duplicates/units/versions | — | — | New external benchmark; not run; bulk is not certified Statement | Release advisory | External SEC bulk + native process |
| PIVOT-F-02 | F | Certified attainable size and labeled valid synthetic cardinality | — | — | New; not run; 98-fact corpus is correctness only | Release advisory | External certified/synthetic manifests |
| PIVOT-F-03 | F | Stable hashed and prefix samples; skew/cardinality/missing/duplicate observations | — | — | New; not run | Release advisory | External data + deterministic sampler |
| PIVOT-F-04 | F | Phase timing, usable view, responsiveness, peak RSS versus WASM buffer | — | — | New; not run | Release advisory | Browser + OS instrumentation |
| PIVOT-F-05 | F | Repeated warm cycles/memory retention; cold/warm fresh isolated runs | — | — | New; not run | Release advisory | Sequential isolated builds/processes |
| PIVOT-F-06 | F | Five alternating observations or exploratory fewer; all samples/median/range | — | — | New; not run; no p95 claim or threshold gate | Release advisory | Pinned machine/runtime/locale/limits/checksums |
| PIVOT-G-01 | G | Both engines; Chromium/WebKit browser workers | — | — | New qualification execution; not run in Task 1 | PR / extended | Built WASM + browsers |
| PIVOT-G-02 | G | Native Tauri lifecycle/worker/import checklist | — | — | New; not run | Release required | Available macOS device |
| PIVOT-G-03 | G | Narrow viewport, coarse pointer, keyboard, scrolling/virtualization | — | — | New; not run | Extended / release | Browser + native macOS |
| PIVOT-G-04 | G | Other OS/devices remain unqualified; unrun/unsupported distinct | — | — | New evidence classification; not run | Release required | Explicit device inventory |

Stable IDs in the table are mirrored in [`pivot-requirements.json`](pivot-requirements.json), consumed by the release report. Additional `PIVOT-N-*` IDs split required native lifecycle subitems; `PIVOT-E-refusal` tracks refusal-only negative capability. See [`pivot-release-qualification.md`](pivot-release-qualification.md) for evidence and decision rules.

## Reproducible portable corpus

Run `node --test scripts/pivot-qualification/verify-fixtures.node.mjs`. `verifyFixtures(root)` accepts the fixture directory and returns `{files:3, rows:98, expectedCells:110}`. Only the three payloads are hashed; the manifest does not hash itself. The reference carries six explicit filing-specific mapping records and pinned Statement definitions, the expected payload preserves Decimal strings independently of engine output, and the trace preserves original context IDs (including repeated IDs). Manifest source XML URLs/checksums are provenance; PR tests never fetch XML. Raw XML was checked locally during extraction; it is external, not committed. Fractional inputs are source observations, not computed fractional goldens; no blanket tolerance is introduced.

Each company's accession is explicit, with exact report periods. NVDA has two fiscal years, the other five one each. Missing numeric cells are not manufactured: the 110 expected numeric cells do not certify every line as complete. AMD and other incomplete templates may still emit required-line errors. Reported and calculated gross-profit identities remain distinct. This corpus does not certify bulk SEC facts or establish large-data performance.

## Existing named assertion inventory

These names are literal source strings; template interpolation denotes parameterized assertions. Each entry is evidence of an assertion location only. Shared seams support later suites but do not substitute for real-worker, browser or native checks.


### `src/lib/statementModel/catalog.test.ts`

- `validCatalogsHaveUniqueOrderedIds`
- `keeps provider aliases distinct and cash observations stock`

### `src/lib/statementModel/compile.test.ts`

- `statementExpandsIntoOrdinaryReportRows and sectionHeadingsNeverSumComponents`
- `duplicateFactsFailWithoutRevisionGuess`
- `annualQuarterOverlapBlocked`
- `hiddenParentFieldCannotBeRecovered and restored schema recovers`
- `required unmapped lines fail instead of borrowing other line facts`
- `hidden output retains formula dependencies while suppressing observed rows`
- `derived row selection survives reconciliation and reorder`
- `formula override replaces pinned definition before cycle validation`
- `empty runtime map works, unsupported runtime values fail`
- `incoming cell errors survive private projection`
- `fiscal bounds-only binding gives repairable diagnostics instead of calendar defaults`
- `error display tokens preserve their incoming error without unpivot type failure`
- `long source binds item and value without unpivot and rejects unknown item identities`
- `authoritative cross-company fiscal warnings retain source and bounds`
- `result filters evaluate declared derived members before qualification`
- `derived member references compose across sections without source facts`
- `unqualified Value in a line formula is rejected before recursive evaluation`
- `hidden derived member remains a valid formula dependency`
- `executes authored item checklists before and after an explicit update without changing company/fiscal keys`

### `src/lib/statementModel/coverage.test.ts`

- `${kind} flow refuses a missing ${position} dependency period in the requested scope`
- `${kind} stock refuses a missing requested latest endpoint`
- `${kind} complete flow and explicit latest stock retain their distinct results`

### `src/lib/statementModel/formats.test.ts`

- `keeps numeric scoped line formats through presented, row and chart delivery and linked input`
- `explicit template and overridden formula formats precede source hints`
- `preserves heterogeneous actual XLS numeric formats through import and Statement calculation`

### `src/lib/statementModel/linePolicy.test.ts`

- `stockFlowRatioScopesDiffer: flow sums, stock selects latest explicit endpoint, single refuses rollup`
- `rejects duplicate stock facts before endpoint selection and incomplete flow spans`
- `refuses mixed company currency and unit and preserves incoming errors`
- `rejects overlapping authoritative stock intervals with different fiscal labels`
- `FQ flows require disjoint contiguous authoritative quarters`
- `an optional line with no facts is blank; a required one is an error`
- `an optional line whose values are null, undefined or empty is blank`
- `real calculation errors on an optional line stay errors`

### `src/lib/statementModel/missingLines.test.ts`

- `long shape: an optional line with no facts is blank, not #ERROR`
- `long shape: a required line with no facts stays #ERROR`
- `a formula that depends on a blank optional line keeps the existing missing-input error`
- `wide shape: a blank cell on an optional line is blank, not #ERROR`
- `long shape: a nonnumeric value on an optional line stays #ERROR`
- `exports the blank as empty in CSV, JSON and XLSX`

### `src/lib/statementModel/nestedFormulas.test.ts`

- `rejects a ${name} member self-cycle during compilation`
- `evaluates a valid nested ${name} derived dependency`
- `rejects a multi-formula cycle hidden inside unary and IF member values`
- `nested selectors replace the active line only within their own subtree`

### `src/lib/statementModel/periodSelectors.test.ts`

- `${kind} explicit fiscal selector replaces requested evidence across display columns`
- `${kind} nested derived fiscal selector passes the replaced scope to its dependencies`
- `${kind} unavailable target fiscal member remains an error`
- `${kind} target evidence and facts cannot come from another ${field} context`

### `src/lib/statementModel/persistence.test.ts`

- `snapshotReopensWithoutCatalog: Workspace interchange carries the exact pinned snapshot and remaps linked owners`
- `overridesSurviveCopyAndRename: native detached persistence preserves local identities and excludes compiled state`
- `retains unknown snapshots inert in native persistence and refuses unsupported portable export`
- `round trips referenced ordinary producers across tabs while omitting unrelated optional fields`
- `refuses foreign portable owners instead of guessing a link target`
- `never evaluates optional ${key} ${throwing?'throwing':'counting'} accessors`
- `never evaluates nested link ${key} ${throwing?'throwing':'counting'} accessors`
- `refuses cyclic and excessively deep optional envelopes without losing the ordinary card`

### `src/lib/statementModel/rollups.test.ts`

- `ratio recomputes policy-aware numerator/denominator over fiscal scopes`

### `src/lib/statementModel/updates.test.ts`

- `resets local changes while preserving bindings and Page membership`
- `maps all stable semantic references across version prefixes without consulting display labels`
- `retains removed overridden lines visibly and refuses unresolved execution and validation`
- `retains detached semantic before and after defaults, mappings and order even without conflicts`

### `src/lib/statementModel/validation.test.ts`

- `unknownSchemasStayInert`
- `rejectUnsafeSnapshotAndUnownedFormulaIds`
- `rejectDuplicateDestinationMappings`
- `rejects contradictory orders, malformed bindings and formula policies`
- `rejects missing fiscal context and source/identity collisions`
- `returns detached validated intent and never executes nested accessors`
- `allows explicit reuse of a source field for distinct lines`
- `rejects hostile graphs and unowned formula definition/value/category IDs`
- `allows owned replacement formulas but rejects unknown targets and duplicate overrides`

### `src/lib/tableExecution/linkedAnalytical.test.ts`

- `passes upstream qualified warnings through ordinary tables without changing source age or acquisition bounds`
- `keeps incoming errors beside new local errors and publishes no private analytical state`
- `treats upstream formula columns as received values without replaying the producer formula`
- `transfers compact warning origins and formula descriptors through a second producer`
- `rejects private or oversized warning projections at the worker boundary`
- `retains temporal category meaning on selected aggregate member paths`
- `a linked report totals past an upstream pivot group whose values are all null`

### `src/lib/tableExecution/resultStore.test.ts`

- `blocksDoNotChangeMeanOrLast`
- `facetsTotalsAndChartsIgnoreFetchOrder`
- `binds revisions and streams an honest empty final batch`
- `child reads have sibling counts and cannot mutate the stored view`
- `all responses preserve context and chart/subset IDs and revisions`
- `reselected child reaches chart and subset while sibling stays excluded`
- `delivers declarative stable group paths and complete input schema`
- `file input inspection infers numeric and date kinds in the worker`
- `inspection date periodicity uses complete input rather than loaded groups`
- `serves independent measures consistently through tiny blocks chart and selected subsets`
- `reports instance aggregations and preserves their metadata across chart and subset transfers`
- `reaggregates only presented upstream instance values in a linked child`
- `keeps an already bound split chart stable across duplication edits and new split members`
- `incoming producer formula columns remain raw inputs while local source outputs stay out of authoring symbols`

### `src/lib/tableExecution/subsetTransfer.test.ts`

- `commits complete metadata and rejects partial, reordered and foreign revision input`
- `rejects mismatched request identity within one transfer`

## Task 2 independent financial boundary evidence

Task 2 adds `qualification.test.ts` and `sec-statements/edge-cases.json` after inspecting the inventory above. These are hand-specified synthetic invariants, not SEC facts or candidate-generated goldens. Existing broad assertions remain; additions strengthen exact errors/affected identities and missing financial boundaries.

| Existing coverage | Added assertion / scope |
|---|---|---|
| `missingLines.test.ts` blank/error display | `missing_is_not_zero_missing`, `missing_is_not_zero_explicit_zero`; direct missing-input versus exact zero |
| `compile.test.ts` duplicate diagnostic | `distinct_id_duplicate_is_refused`, `same_source_identity_is_not_double_counted`; exact scope error/message/IDs, including repeated identity |
| `linePolicy.test.ts` mixed-context boolean refusal | `mixed_company_and_currency_refuse_company/currency/unit`; exact error/message/IDs |
| `compile.test.ts` overlap exception | `annual_quarter_overlap_refuses`; whole-input invalid-structure diagnostic, binding path and unchanged refused source |
| `linePolicy.test.ts` calendar-year stock/flow | `fifty_three_week_flow_and_stock_endpoints_flow/stock`; 371-day and contiguous 364-day authoritative years, negative latest stock |
| `linePolicy.test.ts` single refusal | `single_period_eps_refuses_rollup`, `single_period_eps_preserves_observation`; exact binary fraction, zero absolute/ULP tolerance declared |
| No filing-selection policy coverage | `amendment_asof_chooses_one_filing`; explicit pre/post amendment IDs and evaluator values, no acquisition feature |
| `compile.test.ts` calculated gross profit | `reported_and_calculated_lines_stay_distinct_and_missing_dependencies_propagate`; deliberately different reported 999 and calculated 40, null dependency invalid-type |
| Task 1 verifier checks valid corpus | `safe_integer_boundary_is_exact`; exact maximum safe accumulated integer; verifier mutation test refuses unsafe integer and lossy decimal after rehashing payloads |

The 12 direct policy cases run independently in TS and native Rust (`independent_financial_boundary_oracles`), without consulting candidate output or using TS as the Rust oracle. Filing policy, explicit whole-input overlap diagnostic and reported/calculated full-engine assertions run in TS here; existing native frozen fixtures still exercise overlap and formulas. Task 3 remains responsible for required TS/WASM traces and SEC engine execution. Task 2 is not browser/native-app acceptance. See the Task 2 report for attributable commands, first-run outcomes, hashes and limitations.
