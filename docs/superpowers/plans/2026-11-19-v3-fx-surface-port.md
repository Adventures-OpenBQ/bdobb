# V3 FX linked surface implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Carry the completed PR65 FX linked-surface behavior into V3 and qualify it before advancing; later lines use their existing linked-chart architecture.

**Architecture:** A dashboard/card-scoped runtime publication reuses the source card's acquisition and shared table projection. A linked card subscribes to it. Persist source intent and selected fields, with explicit card-ID remapping across transport/duplication; keep runtime data ephemeral.

**Tech stack:** Existing React, Zustand, TanStack Table and Plotly; no new dependencies.

**Spec:** User-approved existing FX surface V3–V10; PR65 at365daf7c281f9417febabd8d407f21bee3d4f7b6. Narrow V3 adapter selected because V3 predates V4's table execution architecture. User explicitly requests continuous execution and has opted out of intermediate design questions.

## Constraints and review focus

- Preserve V3 profile rejection of unrelated V4/pivot/TemporalDB state. PR75's pivot formulas/category sorting remain for V4+ reconciliation.
- Row0-only compact header ruling remains in force; source selectors live in the linked card body.
- Card identity is `(dashboardId, sourceCardId)`, not endpoint/widget ID. Dataset availability, effective query identity and generation must qualify publication.
- Project complete filtered/sorted source rows, never only virtualized rows; share real accessor/filter/sort functions, including hover-cell accessors and dotted keys.
- Source view/minimize changes retain projection ownership; deletion/loading/error/empty/obsolete generations must not display stale content as current. Source deletions never rebind by endpoint.
- Surface uses schema category/series hints, numeric strike, source expiry order, null cells, pair/date splits, shared color scale, max6plots, min2rows; one measure draws a line.
- Compatible app and Workspace transport, dashboard duplicate, local reload and reference remapping must ship together. Runtime rows and figures are never serialized.

## Tasks

- [x] 1. RED numerical/shape tests; port narrow pure PR65 surface builder and register Plotly surface trace. GREEN tests; commit.
- [x] 2. RED projection/publication tests. Extract shared projection semantics from TableRenderer, add dashboard/card-scoped publication independent of rendered source view. GREEN tests for filters/sorting, two cards, loading/error/empty and ownership cleanup; commit.
- [ ] 3. RED local and transport identity tests. Add bounded linked settings and source metadata to V3 types/store/extension codec; implement two-pass mapping for duplicate/apps/Workspace. Preserve unrelated extension refusals. GREEN round-trip and missing-source tests; commit.
- [ ] 4. RED renderer/source-action tests. Create linked surface from source table action; expose source/category/measures settings; subscribe without independent acquisition; show explicit unavailable/refused/loading state. GREEN source/renderer tests; commit.
- [ ] 5. Real FX source plus surface browser exercise: filter/refetch, two source instances, empty state, save/reload, export/import and duplicate. Update help/recipe/source offers and qualification matrix.
- [ ] 6. Typecheck/lint/unit/build, applicable browser/native regressions and one independent whole-branch review; repair findings with reproducing tests. Only final complete assembly may become Ready.

Task1 verification: eight shape/numeric tests and the surface registry test were observed RED then GREEN; combined16 focused tests pass. Full tracked suite3362passes(8opt-in skips), typecheck/lint/build pass. Source publication and transport/UI remain incomplete.

Task2 verification: publication/lease/projection/acquisition tests observed RED then GREEN;74focused tests pass. Full suite3376passes(8opt-in skips); typecheck/lint/build pass. Runtime publication hook is independent of source renderer; WidgetCard wiring remains Task4, and transport/state remains Task3.
