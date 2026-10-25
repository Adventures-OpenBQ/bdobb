# Rita configures the shared table model

Date: 2026-10-07. Status: approved conversational design; written specification awaiting user review.

## Intent and approved decisions

Rita should configure an existing BDOBB table from a natural-language request, understand which arithmetic and filtering operations are available, and explain the resulting calculation. A request such as “group by FY, show average and total Volume, exclude these companies, and calculate Profit Margin” must produce an actual widget configuration using the same model and calculation engine as the pivot drawer.

The user selected:

- Start with Rita inside BDOBB, extending `bdobb-local`; an external standalone MCP is a future extension.
- Apply immediately after validation and calculation, with one Undo. There is no additional proposal/accept interaction.
- Cover the full current model: categories, duplicate measures, aggregates, formulas, filters, Pages and Statement templates.
- Support backend, CSV/XLS and linked tables. Linked calculations use only their immediate source's presented subset.
- Save full models in authoring mode. Viewer changes are restricted to existing viewer controls and are session-only.
- Use the shared engine for validation, preview, application and downstream recalculation.

Success means equivalent drawer and Rita configurations produce the same results, warnings, filtering scope, persistence and linked outputs. Rita interprets the request; the engine decides whether the configuration is valid and computes its values.

## Existing implementation and integration boundary

The current Rita integration is in `src/lib/agent/localTools.ts`, with `describe_table`, `arrange_table`, `tableProfile.ts`, `arrangeTable.ts`, the seeded `src/skills/arrange-table/SKILL.md`, and `agentEditsStore` Undo entries. Tools execute in the client through the existing agent tool protocol. A separately hosted HTTP MCP server is not required for this first phase.

The existing tools still describe backend tables through fetched rows and accept the earlier grouping/split/buckets/aggregationFns arrangement. They reject local-file tables. Those limitations cannot be carried into the new tools or bypassed by a second calculator.

The approved table foundation and Statement extension provide worker-owned input, model revisions, bounded schema/member/formula inspection, `TableExecutor.previewDefinition`, shared calculation, guarded model replacement, canonical persistence, linked output and viewer overrides. The completed Statement reference is PR #344, implementation `3e2477e09`, evidence follow-up `0340c6f8f`; pivot drawer reference is PR #338. These references describe prerequisites, not a claim that the current checkout already integrates them with Rita.

Implementation belongs on a Rita-enabled line that contains this shared table foundation and Statement extension. It must not add Rita to the v3 local-file release or modify another chat's release consolidation. The implementation plan must select the concrete release/base and reconcile its contracts before any product edits.

## Architecture

Extend the existing named tools rather than introduce a separate tool for every pill operation or accept unrestricted persistence JSON. Add a narrow adapter between the Rita tool dispatcher and the live table runtime. It translates validated, model-oriented operations into the same canonical intent edited by the drawer.

The adapter obtains the runtime associated with the requested widget and uses its accepted input and executor. It does not refetch backend rows to interpret a different dataset, parse a file on the agent side, read an ancestor's private input, or calculate in React. If no ready runtime or required executor capability exists, return an actionable unavailable result. Activation may use the app's ordinary acquisition lifecycle; an arrangement itself does not independently acquire data.

Capability discovery has two parts: machine-readable descriptors derived from shared validators/operator registries, and the Rita skill's explanation of financial meaning. The skill cannot enable an operation omitted or refused by the engine. No duplicated fixed list of legal aggregates, formula functions or temporal recipes is maintained in the agent adapter.

## Describe contract

`describe_table(card_id, section?, cursor?, search?)` remains read-only. The initial call returns a bounded summary; follow-up sections paginate members or inspect formula references. Sections use explicit stable IDs and continuation tokens bound to the widget, revision and category recipe.

The summary includes:

- Widget identity, source kind, current mode, editable/session-only controls and runtime readiness.
- An opaque revision witness covering the widget model, accepted input, owner/source association and immediate upstream revision.
- Available field IDs, labels, types and source/schema identity; bounded samples only where already permitted for Rita.
- Current canonical model summary: category instances and placements, measure instances and aggregates, row/aggregate formulas, filters by stage, Page selection, totals/display settings and pinned Statement template/overrides.
- Supported operations and their constraints: per-field aggregates, category recipes, formula signatures and binding scopes, filters and stage names, viewer controls and Statement mappings/policies.
- Current completeness, freshness, diagnostics, warnings and truncation/pagination indicators.

Labels are for presentation. Fields, measures, categories, formulas and members are addressed by stable IDs; labels and scalar strings are never substituted for typed member keys. Independent measures can reference the same field, and independent categories can derive Y and Q from the same date field.

Member discovery uses worker inspection and its eligibility/observation distinctions. It must not imply that a sample is the entire domain or expose a linked source's excluded/private records. Column names, cell samples and provider metadata remain untrusted source content under the existing Rita tool-result boundaries.

## Arrange contract and execution

`arrange_table(card_id, expected_revision, arrangement)` accepts a strict, versioned operation envelope. The first contract version is `table-model/1`. It describes edits, not an arbitrary dashboard object or executable expression string.

Supported operation families cover every authorable control currently supported by the shared table model:

- Add/update/remove/reorder/place category instances and their native or Y/Q/FY/FQ recipes, including the engine's supported explicit member groups and group labels.
- Add/duplicate/update/remove/reorder measure instances, choose their supported aggregate, labels and supported formats.
- Add/update/remove row or aggregate formulas using validated expression ASTs and bound stable references.
- Add/update/remove category/value checklists, supported ranges/predicates and calculated-result filters, preserving their explicit stages.
- Set or clear the single Page category and its complete selected member set; distinguish All, None and explicit selections according to existing intent.
- Set supported sorting, output visibility, column order, report activation and totals/display controls.
- Apply a built-in Statement template with explicit mappings, edit supported widget overrides, reset overrides or adopt an explicitly supplied valid template update through the existing comparison/update rules.
- Change existing viewer controls in session scope when that is the widget's current mode.

Authoring may expose the model's existing control-promotion and parameter bindings only where the shared capability description permits them. It must retain restrictions such as unsupported Statement runtime parameters. Full-model support means parity with supported controls, not permission to invent a new control or function.

Model data supplied by Rita is bounded and strictly validated. Unknown operations, fields or AST nodes are errors. The adapter does not accept source retargeting, provider credentials, chart configuration or arbitrary persistence fields within this envelope. Widget creation remains with Rita's existing tools.

New instance IDs are allocated by the app. A request can give each newly created object a unique request-local alias so a later operation in the same arrangement can refer to it. The adapter resolves aliases before shared validation and returns the alias-to-stable-ID mapping. Existing objects must use discovered stable IDs. Duplicate aliases, unknown references and collisions refuse the whole arrangement.

Execution is one transaction from the user's perspective:

1. Check current access/mode, widget/runtime identity and revision witness.
2. Detach the previous canonical configuration for Undo and build a candidate from the current configuration plus all requested edits.
3. Bind references and run shared structural, arithmetic, filter, template and cycle validation.
4. Calculate the candidate through the live executor's bounded preview capability without publishing it or activating linked descendants.
5. Recheck access, accepted source/owner association and revisions after the asynchronous calculation and immediately before the guarded durable write or session publication.
6. Commit through the existing table runtime. No success is returned for a failed durable write. Publish the accepted model through the ordinary pipeline and cascade downstream recalculation.
7. Register one Undo only for a successful change, and return the applied summary, final revision, stable IDs, warnings and affected linked-output status.

A no-op returns `unchanged` and creates no Undo entry. A typed formula cell error, incomplete period or fiscal-alignment warning is treated exactly as the equivalent drawer operation: hard validation failures refuse, supported calculations with warnings remain visible and must be explained. The adapter does not classify every diagnostic as a refusal or invent a silent fallback.

Rita does not automatically repeat a mutation whose result is uncertain. On stale revisions or an interrupted response she re-inspects the model; a retry must not blindly duplicate measures or Undo entries. The result distinguishes validation refusal, stale state, commit failure and a successfully committed change awaiting downstream readiness.

## Arithmetic and semantic guidance

Capabilities specify supported operators/functions, argument types, binding scope, null/error behavior, filter scope and totals semantics. Formula ASTs bind through the same authoring machinery as the drawer. Unknown references and circular dependencies are reported with affected stable IDs and paths where available. No JavaScript execution, string eval or agent-side calculation is introduced.

Rita chooses arithmetic by meaning, not merely numeric type. Period flows such as traded volume may be summed; balances and closing values use the supported endpoint policy; identifiers may be counted. Ratios, percentages, per-share and cumulative figures must not be silently summed. A simple mean is identified as unweighted; a weighted mean requires an explicitly supported formula and weight field.

“Profit Margin by FY” should use an aggregate ratio of the appropriate profit and revenue measures, not a mean of individual margins, when the available data and requested meaning support that interpretation. If “profit”, “average price” or another semantic choice has multiple plausible meanings, Rita asks one focused question rather than guessing. Provider-reviewed policies and Statement line rules take precedence over heuristics.

FY/FQ require the engine's authoritative fiscal metadata. Rita must not invent a fiscal calendar or treat Y/Q as interchangeable with FY/FQ. Companies with differing fiscal calendars retain the existing alignment warning. Unsupported rollups remain unsupported even when a skill example would be mathematically plausible.

## Filtering and Pages

Each filter is identified by the actual shared model stage and target ID. Source eligibility/constraints restrict the observations available to calculations; calculated-result filters determine which calculated output is presented. Rita must explain the difference when it changes the requested meaning, such as excluding companies before a total versus hiding totals below a threshold afterward. No hidden filter order is inferred from the request's word order.

Pages remain limited to one category, with the full selected member set. A Page may contain multiple values. Y, Q, FY and FQ derive categories from the same underlying date field where supported. Category and member IDs preserve scalar collisions and typed identity.

Linked tables compute only from the immediate presented public dataset, even when that dataset originated from another linked widget. Existing revision cascades recalculate descendants on Apply, Undo and session control changes. Rita does not fetch through the chain, recover excluded ancestors or claim stale downstream results are fresh.

## Statements

Expose only installed, validated template versions and their supported mappings/policies. Creating a Statement requires explicit wide/long bindings and required company/period/fiscal evidence. Do not infer mappings from arbitrary similarly named columns or introduce a provider acquisition path.

Widget overrides retain the approved template behavior: line/section order, labels, supported formulas/formats and visibility. Template updates remain explicit and use the existing immutable Before/After comparison, correspondence remapping and conflict rules. Rita can describe a conflict and valid resolutions; she cannot silently drop unmatched intent, fabricate a newer template version or change a pinned snapshot in place.

## Modes, Undo and concurrency

Authoring permits the full supported configuration. Viewer mode exposes only controls already declared session-editable by the current widget; Rita cannot promote new controls, alter saved formulas/templates or persist viewer changes. Session changes and their Undo remain in the same session.

Undo restores the previous configuration, not an old copy of source rows. It uses the ordinary validation and runtime pipeline against current input, then cascades recalculation. If the previous configuration is now invalid or the widget has been deleted, return an explicit Undo failure without a partial restore. If another actor edited the configuration after Rita's change, refuse an overwrite and report that intervening edit; an explicit user request to restore can be issued as a new inspected arrangement.

Undo metadata must carry the applied model witness and previous configuration. Extending the existing asynchronous Undo callback/reporting surface is allowed where necessary to present a failed restoration honestly; silently swallowing the failure is not acceptable. A session control change tracks only the controls it changed and similarly refuses overwriting intervening changes.

The same authority checks cover read-only mode changes, source retargeting, upstream changes, delayed worker replies, owner activation and failed persistence. A stale candidate is discarded; Rita re-inspects before constructing a fresh candidate. Backend parameter changes remain separate existing tools because they may acquire a new dataset and invalidate this witness.

## Errors, results and Rita skill

Errors are structured and bounded: code, operation index, target ID, field/path, explanation and engine-derived valid alternatives where available. Report all independently discoverable structural problems together. A later calculation failure may need a subsequent response; do not promise that one pass can discover every data-dependent error.

Success returns a concrete before/after summary and actual applied IDs, warnings, completeness/freshness and the state of linked recalculation. Rita explains what changed, which filter stage she used, any fiscal or arithmetic warning, and that Undo is available. She does not claim descendants are ready while they are recalculating or awaiting a source.

Update the existing seeded arrange-table skill with the inspect → interpret → single arrange → explain procedure. Examples must use advertised operations and actual discovered identities, cover duplicates, aggregate ratios, filter stages, fiscal categories, Pages, Statements and viewer scope, and explicitly separate ambiguity questions from extra confirmation. The app's tool schema remains authoritative over instructional examples.

## Verification

Meaningful unit/contract coverage must establish capability parity with the drawer; strict operation validation and alias binding; cycles and unknown references; stage-aware filtering; full Page set identity; independent measures/categories; Statement mappings/updates; bounded member discovery; and revision/access guard behavior.

Integration tests use actual local tool dispatch and the real worker for CSV/XLS, backend-registered and linked inputs. Equivalent Rita/drawer definitions must match values, order, diagnostics, formats, totals and presented output. Apply must be all-or-nothing, one Undo, and restore the previous model against current input. A failed durable write or changed source must not publish a candidate or register a successful edit.

Browser tests exercise the mocked Rita tool-call round trip through the real runtime, visible pill/model changes, one Undo, derived formulas, filtering stages, fiscal warnings, Statement overrides, viewer session restrictions, source changes and linked chart cascades. Existing Rita and ordinary-table scenarios remain covered. A real Rita acceptance run verifies tool discovery, interpretation, explanation and correction of a refused request; provider/model availability failures are reported separately from product behavior.

Required branch checks follow the target repository/release checks. No exhaustive new test suite is added solely to mirror every operation setter; prioritize semantic outcomes and authority/persistence boundaries.

## Scope and future extension

This phase implements an in-app structured tool contract, capability descriptions and Rita guidance. It introduces no external MCP transport, server calculation executor, Polars integration, SSRM backend, Arts Charts panels, arbitrary code execution or new financial calculation semantics.

A future standalone MCP can adapt this same contract once authenticated runtime access and external-client ownership are designed. It must not require rewriting the calculator or changing the Rita-facing operation semantics. Future server execution can supply the same executor capabilities without making the agent responsible for arithmetic.
