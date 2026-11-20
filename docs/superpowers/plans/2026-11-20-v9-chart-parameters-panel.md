# V9 linked-chart Parameters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement and independently review this amendment in the existing isolated worktree.

**Goal:** Place linked-chart configuration in the existing Parameters panel and ship closed examples with the existing reopen chevron.

**Architecture:** WidgetCard owns one stable, hidden-when-closed panel host. Its `LinkedCardBody` passes that target and the existing open action to both linked renderers; portaling the source-picker button is restricted to chart/metric presentations, preserving the linked-table authoring path. The existing linked-chart and linked-KPI editors portal configuration to that host while preserving their mounted state and keeping applied outputs/probes in the card body. Reuse `paramsOpen`; no new saved state or portable schema.

**Tech Stack:** Existing React/React DOM, TypeScript, Zustand, Vitest, Playwright, installed Plotly.

**Spec:** [V9 linked-chart Parameters amendment](../specs/2026-11-20-v9-chart-parameters-panel-design.md).

## Global Constraints

- The user explicitly authorized this existing-panel convention before finalization; preserve the previously selected subagent execution and final independent review.
- No source/financial-definition/worker-protocol changes, new dependency/vendor, provider changes, publication or deployment.
- All editable chart configuration is in the existing Parameters region. Chart/status/notes/details/runtime drill stay in the body. Examples default closed; the existing chevron reopens them.
- Preserve one mounted editor, drafts, applied output, strict source/request ownership, exact measured worker and queued Apply guards. A collapsed/zero-sized probe cannot validate Apply; existing dimensioned body probes remain valid measurement mechanisms.
- Preserve native `paramsOpen` and existing viewer/locked/rail rules. Do not add v4 extension fields merely to encode the default closed state.

## Review Focus

1. Collapsing a portal host must not unmount or duplicate editors/workers, discard drafts, or remove the applied chart.
2. Opening/closing must not issue a backend GET, alter acquisition ownership, or reset the semantic question; changed available geometry still needs worker validation.
3. Builtin linked widgets have no ordinary backend parameters: their chevron/panel must still exist and focus the first configuration control.
4. Missing evidence/pins/fields must remain visible as repair guidance while closed and be repairable from Parameters.
5. Actual exported/imported examples are closed, yet their controls can be reopened and used on both table engines, with no unsupported transport keys.

---

### Task 1: Integrate the existing panel, examples and acceptance

**Files:**
- Modify `src/components/WidgetCard.tsx` (panel capability, stable host, source picker, existing chevron/menu/focus), `src/components/renderers/LinkedChartRenderer.tsx`, `src/components/renderers/LinkedKpiRenderer.tsx`.
- Create `src/components/renderers/LinkedParametersPortal.tsx` for `LinkedParametersPortal({target, children}: {target: HTMLElement | null; children: ReactNode})`, returning a portal to the supplied host, or no configuration DOM until the host exists. No production inline fallback.
- Add `parametersTarget: HTMLElement | null` and `onOpenParameters: () => void` to the linked renderer integration props; keep body output and draft measurement ownership separate from the portal.
- Modify only configuration wrappers in `LinkedChartRecipeControls.tsx`, `LinkedKpiControls.tsx`, `LinkedEtfSunburst.tsx`, `LinkedDualAxisOverlay.tsx`, `LinkedEstimateRevisions.tsx`, `LinkedMarketMap.tsx` to flatten settings-only disclosures; news/return/ownership fields are in `LinkedChartRecipeControls.tsx`.
- Modify `src/styles.css` narrowly for the hidden stable host/parameter form layout and bounded scrolling if necessary. Native `[hidden]` must remain visually and accessibly hidden despite flex styles.
- Update relevant `src/components/WidgetCard*.test.tsx`, renderer/codec/example tests and all affected `e2e/*` family specs/helpers to open the existing Parameters chevron when editing; do not globally force example cards open.
- Update `docs/examples/v9-next-*/` templates/README only where needed, chart help and durable next-chart verification/review/rulings. Existing empty/false open-state defaults may require tests rather than JSON edits.

**Interfaces:** Consumes the existing card `paramsOpen` state, panel/menu/chevron, stable linked renderer lifecycle and measured jobs. Produces one configuration host and the explicit portal/open props above. No saved option or acquisition-proof interface changes.

- [ ] Promote this design/plan into their dated `docs/superpowers/{specs,plans}` paths and commit the authorized amendment before product edits; record the implementation BASE after those docs.
- [ ] Write failing parent/browser tests: saved examples have no visible Chart type/recipe fields, chart remains visible; Show parameters opens exactly one Parameters region containing Choose source and all expected fields; Hide parameters preserves changed draft and applied output; reopen retains draft; absent normal backend params still yields the chevron; native open-state saves and fresh portable import closes.
- [ ] Add regressions for no extra source GET/revision reset on toggle, collapsed-zero/reopened draft geometry and queued Apply, invalid/missing-pin repair while closed, and KPI plus revision sizing convergence after reopen. Test normal and rail/read-only integration where existing behavior applies.
- [ ] Run affected tests and observe the intended RED. Implement the stable host/portal and flatten only settings disclosures. Keep measurements needed by applied drawing outside hidden configuration, and reject zero-sized collapsed measurements until a valid drawing-surface remeasurement. Preserve an already requested save when its existing source/geometry guard still holds; do not invent close-to-cancel semantics.
- [ ] Update actual browser editing helpers to use the existing chevron. Assert collapsed-first examples and reopened controls for all eight families, plus a basic linked chart/bullet/waterfall representative. Inspect light/dark/narrow screenshots, touch where control relocation affects sizing, and both engines' feature cases.
- [ ] Run affected unit tests, typecheck, lint, scrub, example imports, scratch-only catalog exclusion, production build and appropriate final client/browser gates once on the final UI candidate. Provider/image qualification remains valid if their files stay unchanged. Record raw/gzip deltas and exact warnings/skips without rerunning unchanged backend suites.
- [ ] Commit the UI/tests/docs as `fix: place linked chart configuration in Parameters`. Write `parameters-panel-report.md` with RED/GREEN commands/output, exact paths, screenshots inspected, commit SHAs, no-network/measurement evidence and concerns. Independent task review must pass before final whole-branch review.
