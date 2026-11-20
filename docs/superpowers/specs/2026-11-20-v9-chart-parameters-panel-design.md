# V9 linked-chart Parameters amendment

Date: 2026-11-20. User-authorized amendment to the running eight-chart implementation. The user supplied the existing convention and explicitly requested adopting it before finalization. Keep subagent implementation and independent review.

## Intent and selected approach

Use the existing card Parameters panel for linked-chart configuration. The user selected the existing docked panel, saved collapsed examples, and its existing chevron. Reuse `DashboardCard.paramsOpen` (absent means closed), its menu/chevron and focus behavior. Do not introduce another saved disclosure setting or v4 extension. A separate chart-settings drawer would leave two competing parameter surfaces and does not meet the requested convention.

## Behavior

- Put Choose source, Chart type, Category, Measures, Series from, and every recipe/KPI configuration field and Apply action inside the card's Parameters region. Cover all eight families and the basic/bullet/waterfall linked charts that use the same editor.
- The chart, current status/error/repair explanation, scope notes, original-value details and runtime chart navigation remain in the card body. Home/sector navigation is interaction, not authored configuration.
- Opening Parameters exposes the configuration without another recipe-settings disclosure. Remove/flatten configuration-only nested settings disclosures; retain observation/details disclosures in the body.
- Examples import with Parameters closed. Omit the existing native open flag or use its false default where supported; do not add an unsupported portable key. Users can reopen, edit, Apply, close and reopen using the existing chevron. Native per-card open-state persistence retains its existing semantics.
- Closing Parameters preserves draft settings and the applied chart. Keep one mounted editor/control tree using a stable hidden parameter host. Do not create two worker/editor instances or reset the draft merely because the panel closes. A display:none/zero-sized draft probe cannot validate Apply; the existing deliberately invisible, dimensioned body probe may still measure the actual drawing surface. Reopening remeasures any changed surface before accepting a candidate; applied rendering remains independent. Closing the panel alone does not cancel an already requested save that still satisfies its original source/geometry guard.
- Keep exact measured worker preflight, revision/source/request ownership, queued Apply guards, source-free import and source-owned network traffic. Panel toggling must not issue another backend data request or change the semantic question. Keep existing viewer/read-only/locked and rail/minimized behavior.
- Empty or invalid cards retain visible repair guidance and an accessible Open Parameters action, without duplicating editable fields in the body.

## Implementation boundary

WidgetCard owns the panel and a stable DOM host even while the linked panel is collapsed. The linked chart and linked KPI components portal only configuration into that host; their workers, probes and applied outputs stay mounted. Use the existing React DOM dependency. A small portal helper and explicit target/open callback props keep the integration local. Provider/source contracts, financial calculations, workers' wire protocol, and Docker source pin are unchanged.

## Acceptance

Prove closed initial example, single Parameters region, chevron/menu open/close, focus, source and all family fields under that region, draft survival, unchanged applied output and semantic revision on toggle, no additional source GET, exact candidate remeasurement before Apply, native saved open-state and portable fresh-closed behavior. Inspect actual light/dark/narrow browser captures with closed examples and reopened Parameters across every family, including KPI and data-dependent revision surfaces. Run affected unit/browser tests and one appropriate final client verification after the change. Independent review precedes final whole-branch review.
