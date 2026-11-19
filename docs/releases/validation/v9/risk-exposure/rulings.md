# V9 risk and ETF chart implementation rulings

These controller decisions governed implementation and validation. They are reproduced in ledger order.

1. Execute tasks sequentially, including independent builder tasks — SDD forbids concurrent implementers in a shared checkout — costs some throughput but avoids shared index/commit conflicts.

2. Use focused task tests and typecheck while iterating, with one integrated full shipping run in Task8 — explicit approved plan and developer verification economy govern — an unforeseen cross-task issue may surface later and require regression fixes.

3. No provider/Docker change without concrete missing upstream fact — inspected existing ETF values and route ownership suffice for the planned BDOBB acquisition adapter — if actual transport proves insufficient, amend the dependency narrowly and verify it.

4. preserve first-batch decoder behavior; apply stricter observationSymbol-compatible checks to new price recipe symbols only — avoids import-valid but unusable selections — cost if wrong: legacy settings retain historical permissiveness.

5. Task2 may capture actual completed GET context in dataClient and certify Rust registerInput encoding — final wire parameters resolve after calendar lookup, and Rust raw input bypasses calculateView — costs extra scoped files/tests but preserves the spec acquisition boundary. Report names exact files for review.

6. distinguish original snapshot retrieved_at from current GET acquiredAt when both exist — serving an old snapshot is not an identity conflict; neither timestamp supplies holdings asOf — costs an optional evidence field and clearer two-time labels. Task2 tests/exports document this downstream.

7. for nonconstant histogram ranges too narrow to represent requested distinct finite bin boundaries, refuse with repair guidance rather than inventing dispersion or silently changing bin count — exact bin hover and numeric truth take precedence — cost if wrong: an extreme precision-degenerate dataset needs a different requested bin count or cannot chart. Normal tiny ranges remain tested/count-conserving.

8. multiplicative numerical display scaling is permitted when necessary to keep the full finite domain inside Plotly FP_SAFE, with original-value labels/hover retained — no translation or changed bins — cost: extra tested display branch. Earlier precision ruling applies only if absolute boundaries themselves collapse, not if only midpoints are unrepresentable. Task8 must prove extreme final bar visible in Chromium.

9. extract unchanged smallMultiplesGrid into Task7 viewport.ts and re-export from builder — share UI/worker breakpoints without importing chart math into main bundle — cost is a scoped prior-file edit, existing numeric tests remain.

10. allow parentReportsSourceStatus prop at WidgetCard call site — production parent owns source error/stale announcements while standalone renderer keeps source diagnostics and always keeps local errors — cost extra prop/callsite tests; protects prior behavior while enforcing one source notice.

11. Task8 may correct touch-only ETF exposure drag capture after real touch Chromium RED — Plotly prevents vertical scrolling inside tall dot plot — narrow coarse/touch-input setting must preserve desktop/other recipe zoom and marker hover/tap, add regression/browser evidence. No global Plotly config change.

12. incompatible unsaved exposure-mode draft disables Apply and retains last applied chart; actual imported/applied mismatch refuses and clears — mode-specific field controls prevent creating invalid settings — cost: source repair example flow must relink and bind before applying Region; runtime/import refusal still tested.
