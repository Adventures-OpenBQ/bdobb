# Rust Pivot foundation with SSRM-ready execution

Date: 2026-10-13
Status: written specification awaiting user review
Source baseline: Adventures-OpenBQ/bdobb, claude/v4-18-first-open,
74cc3f6c4c718cd76044722b954a7bc0761c8866.

## Intent and agreed scope

Move local Pivot and analytical table calculations into a portable Rust core,
preserving supported behavior and saved definitions. Run that core as WebAssembly
in a Web Worker for Tauri desktop, browser builds and iPad Safari. Establish a
provider contract suitable for future backend tables and a Server-Side Row Model
(SSRM). The user selected local execution with SSRM-ready interfaces, rather than
a production backend provider in this delivery.

The surrounding application and the existing table renderer remain TypeScript
in this stage. Moving table DOM rendering into Rust is the agreed subsequent
stage, not a requirement for completing the calculation foundation. Existing
styles and accessibility behavior remain acceptance constraints throughout.

Success means equivalent analytical results across supported platforms, bounded
result delivery, preserved identities and diagnostics, and an execution contract
that does not require future SSRM providers to imitate local input acquisition.

## Architecture and alternatives

Use a framework-independent Rust calculation crate with a Wasm worker adapter.
The crate depends on explicit analytical data and types, not DOM, React, Tauri,
network connections or worker globals. Native server adapters can use it later.
TypeScript retains orchestration, saved-state integration, input acquisition and
UI events. Existing file parsing can remain TypeScript; it must produce the same
validated input model before Rust executes calculations.

A native desktop engine plus Wasm browser engine adds an unnecessary second
transport in the first delivery. A DuckDB-led implementation requires additional
semantic compatibility work. DuckDB and SQL pushdown are optional future
accelerators, excluded from this delivery. They may execute only operations whose
equivalence has been established; Rust remains responsible for analytical meaning.

Current seams include src/lib/tableExecution/engine.ts, table.worker.ts,
resultStore.ts and types.ts; src/lib/pivotTable.ts; and the calculation, formula,
category, scope, fiscal and total modules under src/lib/tableModel/. The current
TableExecutor already exposes row blocks, totals, facets, selection, chart data,
inspection and bounded presented-result batches. Adapt these contracts rather
than introduce an unrelated parallel pipeline.

## Component responsibilities

1. Analytical contract: versioned definitions, validated values, bound identities,
   capability declarations and structured diagnostics.
2. Rust compiler and evaluator: binding validation, dependency checks, source and
   aggregate formulas, categories, fiscal resolution, filters, grouping and splits.
3. Rust result session: calculated state, stable group hierarchy, selection,
   scoped totals, facets, inspection and bounded row/export access.
4. Wasm worker adapter: input conversion, requests, publication and disposal.
5. TypeScript provider adapter: existing TableExecutor integration, worker lifecycle,
   request correlation and stale-response rejection.

Public wire definitions and internal engine structures are separate. Do not expose
the full internal calculated view as a UI snapshot. Column presentation metadata
and existing provenance, freshness and completeness information must survive the
adapter even where the evaluator does not consume them.

## Analytical contract and compatibility

Definitions contain source bindings, formulas with bound AST references,
categories, measures, source and result filters, runtime parameters, Pivot axes,
sorting, date buckets, fiscal context and subtotal configuration. Preserve saved
definitions through an adapter; users must not recreate tables. Validate protocol
and definition versions before calculation and refuse unknown versions explicitly.
Port both existing legacy Pivot execution and analytical table-model behavior;
legacy translation must be tested against its own fixtures.

The first wire version supports Unicode scalar strings. It explicitly refuses
unpaired UTF-16 surrogates at input and authoring boundaries, without normalization.
JavaScript previously accepted these edge inputs; this is a deliberate documented
compatibility limitation, so unrestricted JavaScript string parity is not claimed.
Worker/codec preflight enforcement belongs to the adapter implementation.

Preserve the baseline's source/aggregate scope distinction, dependency ordering,
member-scope resolution, Page/checklist/runtime constraints and Pivot-off behavior.
Retain distinctions among absent input, excluded members, missing members and
members with no counterpart in retained context. Fiscal behavior requires the
same per-company metadata, period evidence, warnings and refusal conditions.
Preserve Statement compilation/evaluation behavior used by table calculations.

Totals re-evaluate operations against relevant source identities; displayed
subtotals are never substituted for source records. Ratios and non-additive
measures must be evaluated at each requested scope. Chart, export and linked
dataset consumers share the same calculated revision and scope semantics.

Use explicit wire encodings for missing values, null, typed member keys and values
that JSON cannot faithfully carry. Preserve baseline BigInt/nonfinite handling
where accepted by existing contracts. Do not silently coerce text or blanks into
numeric zero. Preserve arithmetic errors and dependency diagnostics. Match date
ordering for first/last, missing-value filtering, distinct-count normalization,
locale/numeric text ordering and stable ties. Locale-sensitive comparison needs
an explicit locale input and compatibility implementation or adapter; a bytewise
Rust comparator is not an acceptable substitute.

The conceptual sequence is validation, source evaluation and eligibility,
category/fiscal/member resolution, grouped measures and aggregate formulas,
result qualification, scoped totals, then publication. Actual execution must
preserve existing dependencies among these steps; it is not permission to reorder
the baseline's semantic stages. Any discovered baseline defect is documented and
approved separately rather than hidden inside the migration.

## Provider and SSRM boundary

Separate input acquisition from execution. Local providers register a complete
acquired dataset, with its honest completeness metadata. Future remote providers
bind an opaque source/snapshot reference; they do not require downloading source
rows into the client. This delivery specifies the remote acquisition contract but
implements only the local provider.

Each session negotiates protocol version and capabilities. Each calculation
operates against an input snapshot and definition revision. Requests carry session
identity, request identity and the existing widget/input/model/output revision
coordinates. Responses identify the matching result revision. Publish only a
fully prepared result; stale or failed calculations cannot replace the active
result. Schema and row requests must refer to the same published revision.

The common result interface provides:

- Apply a definition and receive columns, top-level count, completeness and diagnostics.
- Fetch rows by stable group-ID path and bounded offset/limit, including stable row
  IDs, child counts and selection state. Counts describe siblings under that parent.
- Obtain scoped totals, facets, member domains, previews and inspection evidence.
- Update selection by stable identities, including all-matching with exclusions.
- Request chart data and stream exports/presented subsets with backpressure.
- Cancel requests and dispose sessions and their resources.

Authoring binding, schema inspection, runtime parameters and identity-witness
behavior remain compatible with existing consumers. Capability declarations
identify supported definition versions, aggregations, formulas, fiscal behavior,
inspection and selection operations. Refuse unsupported definitions before
publication with a structured diagnostic. Never silently fall back to calculation
over loaded row blocks.

Future SSRM calculates over the complete relevant backend scope, independent of
loaded client pages. Dynamic pivot columns belong to the result revision and
reflect that scope, not the currently fetched block. Stable ordering includes
deterministic ties. Snapshot expiration or unavailable counts must be represented
explicitly, never converted into apparent empty results or invented exact counts.
Incomplete source metadata remains visible; the local engine cannot infer records
that were never acquired.

## Worker, iPad and resource behavior

Require no Wasm threads or SharedArrayBuffer for baseline operation. Keep acquired
input and calculated results worker-owned and transfer bounded blocks. The UI
adapter retains only bounded delivery caches. Conversion may transiently duplicate
input; measure that cost and avoid resending the dataset on every model change.

Define configurable limits for input admission, pivot output width, request sizes,
row batches, export batches, inspection, concurrent transfers and cached blocks.
Carry forward existing validated protocol limits. New operational ceilings must
be selected from representative desktop and real-device iPad measurements before
default activation. Predictable limit failures return explicit diagnostics and do
not publish a partial result as a complete calculation. Wasm traps and worker loss
receive a separate adapter-level failure and reset path; browser process eviction
cannot be promised to produce a recoverable Rust error.

Cancellation initially invalidates obsolete work and rejects stale publication.
A synchronous Wasm call cannot process a cancellation message until it yields.
Hard interruption may replace the worker and invalidate its session, requiring
re-registration. Cooperative interruption is a later optimization unless needed
to meet measured responsiveness. Disposal releases Rust handles, worker state,
pending requests and bounded transfers.

## Rendering and CSS

Keep src/components/renderers/TableRenderer.tsx and its existing table interactions
in this delivery. It consumes result blocks without analytical recalculation.
The later Rust renderer owns an isolated DOM subtree mounted by React and uses
ordinary HTML, preserving classes, table structure, ARIA, focus behavior and CSS
variables. It must preserve the project's theme and font tokens, coarse-pointer
targets and existing animation policy. The Rust calculation contract must not
embed CSS decisions or require canvas/native widgets.

## Migration and validation

Capture representative baseline fixtures before switching providers. Use the
TypeScript evaluator as a test oracle during migration, with reviewed expected
outputs for cases that should remain stable. Do not run both full engines in
production by default, especially on iPad. Keep rollback as an explicit provider
choice during rollout, not a silent fallback that conceals incompatibilities.

Port contract/types, compiler/evaluator and result storage; connect the worker;
then validate and activate Rust. Reuse existing saved-state and execution adapters.
The implementation plan will sequence these changes and specify build packaging,
runtime initialization and numeric tolerances; implementation has not begun.

Acceptance requires:

- Equivalent legacy and analytical Pivot, source and aggregate formulas, member
  scopes, fiscal and Statement behavior, grouping/splits, filters and totals.
- Exact identities, typed keys, ordering structure, selection and error/warning
  codes; equivalent diagnostic evidence and completeness metadata.
- Explicit per-operation numeric tolerances where floating-point accumulation
  warrants them, with separate checks for null/missing and error cases.
- Saved-definition compatibility, Pivot-off behavior, previews, authoring,
  group-domain inspection, chart output, linked subsets and exports.
- Revision isolation, stale-response rejection, invalid protocol refusal,
  capability refusal, bounded transfers, cancellation, disposal and worker failure.
- Shared conformance tests run against local Rust and a deterministic remote
  provider test double to exercise block loading and capabilities without building
  a production SSRM service.
- Desktop Tauri, browser and real iPad Safari validation. Desktop WebKit automation
  supplements but does not replace iPad device testing.
- Existing CSS, accessibility and table interaction checks remain passing.

Measure first-load/initialization cost, calculation latency, repeated model edits,
peak memory, input conversion and row/export transfer cost on representative
datasets. Establish performance targets from those baselines before activation;
no unmeasured speedup is an acceptance claim. Use existing engine/protocol unit
tests, tableModel tests, execution contracts and browser Pivot/runtime tests as
the starting fixture inventory.

## Deferred work and review boundary

Production backend/SSRM providers, SQL translation, DuckDB acceleration, native
desktop transport and Rust DOM rendering are subsequent work. They must preserve
this semantic and result contract. The written specification requires user review
before an implementation plan is prepared. No product code or dependencies are
changed by this design stage.

### Reviewed recipe and runtime ordering seam (Task 5)

Protocol 1 may carry `analyticalRecipeSource`, an ordered tagged `WireValue`
representation of the original analytical definition. The core validates its
plain-data budget, decodes it to the typed model, and proves agreement with the
supplied typed analytical definition before using it solely for authoring recipe
fingerprints. Ordered object properties in fiscal bindings and reachable bound
ASTs are retained, including JavaScript integer-index property order. Missing or
inconsistent evidence explicitly refuses authoring/member-domain witnesses;
callers cannot provide an unverified replacement recipe. Saved schema version 1
is unchanged. Execution continues to consume typed definitions and cell values.

Recipe sorting uses a separate fallible host comparator with the negotiated
locale and default `Intl.Collator` options, matching recipe `localeCompare`
semantics. Pivot's base/numeric comparator is not substituted. Runtime parameter
entries, fiscal-company entries and category constraints retain baseline
insertion order so shared preview budgets, collation ties and diagnostic order
remain stable. Fiscal-company lookups retain an index. A UTF-16 preview that
would create a lone surrogate explicitly refuses the Unicode-scalar wire
boundary rather than rewriting that value. These seams require worker wiring
and browser conformance in the later adapter tasks.

The fiscal metadata seam preserves primitive FY quarter evidence even though the
ordinary TypeScript fiscal-period type describes a numeric optional quarter.
Arrays and records in an FY quarter property explicitly refuse with fiscal-context:
normalized baseline periods compare such values by shared JavaScript object
reference, which the protocol's tagged-tree representation cannot preserve.
No authoritative fiscal resolution or recipe is fabricated for that schema edge.
FQ quarter metadata remains a numeric integer from 1 through 4. Source-filter
objects retain the ordinary-record semantics of the baseline's structuredClone
boundary; null-prototype input objects become ordinary objects before execution.
Own non-callable toString properties survive that boundary and their coercion
failures must propagate as request errors rather than broaden source eligibility.

### Task 10 serialized AST compatibility boundary

Protocol 1 refuses unknown or malformed serialized formula AST kinds as unsupported
IR. Some corrupt saved ASTs formerly yielded TypeScript partial independent cells;
Rust refuses that whole candidate recoverably, retains authored intent and any prior
successful publication when input is unchanged, and supports repair without source
reacquisition. Known AST shapes with missing references, cycles or formula type errors
retain supported diagnostic and independent-output semantics. This exception adds no
business fallback, AST rewriting or calculation over fetched result pages.

## Experimental bounded-state acquisition profile

Task 12 adds an explicitly opt-in estimated state budget. The existing file
acquisition parsers, including compressed workbook expansion, have no established
workspace bound before typed Dataset admission. A worker configured with
`maxStateBytes` therefore refuses `importFile` recoverably with `RESOURCE_LIMIT`
before invoking the parser, retaining its committed source/model/publication.
Validated `registerInput` remains the bounded admission path. Other resource caps
and uncapped experimental Rust workers preserve supported file imports. This is a
resource-profile restriction, not a general removal of Rust acquisition support or
a claim that caller-owned parsing is covered by the session budget.

### Task 12 preclone JS byte-profile boundary

Opt-in byte admission must precede full request validator cloning. The queued half
of maxStateBytes reserves both raw and validated copies and releases reservation
on validation failure, settlement or disposal. Descriptor-only correlation preserves
valid replies without getters/cloning; invalid Unicode/type correlations are not echoed.
Sparse array slots count before clone/expansion. BigInt JS storage/conversion has no
established pre-conversion bound: maxStateBytes refuses it anywhere in requests, and
maxInputBytes/inputBytes refuse it in acquired Dataset cells/metadata before cloning
or decimal encoding. Other independent row/width/transfer caps and uncapped semantics
remain available. Unavailable bounds are explicit RESOURCE_LIMIT, never fixed-size
scalar guesses or serialized Infinity/null metric proxies.

### Reviewed top-level source identity boundary (final review)

Protocol 1 acquisition refuses repeated JavaScript object instances used as the
`values` property of two or more source rows, with recoverable worker
`INVALID_REQUEST` and an explicit unsupported-input-representation message.
This check runs after existing resource/preclone and Unicode/plain-data validation
and before per-row tagged-tree conversion. The TypeScript legacy implicit-measure
path keys originals by that object identity and selects the last aliased row;
a tagged tree cannot retain that identity relation. Refusal preserves the old
source, model and publication instead of silently de-aliasing the candidate.
It applies uniformly at acquisition, including raw and analytical callers, since
a later model edit can activate the identity-dependent legacy path.

Programmatic callers must create a separate top-level values object per row
(for example `{...row.values}`). Distinct objects with equal values remain
supported, as do shared nested cell objects unless the existing FY-quarter
identity boundary applies. JSON/file-produced row objects are unaffected.
There is no provider capability enum or worker error-code expansion.
