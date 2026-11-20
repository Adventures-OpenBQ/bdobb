# Linked chart measure labels show their period

Date: 2026-11-15. Repo: Adventures-OpenBQ/bdobb. Home line: release/v4 (from `v4.0.0`), carried forward. Small change, approved in conversation.

**Why.** A statement's linked chart listed every period column as "Value" in its Measures checkboxes, so FY2023 could not be told from FY2025. The legend already named the same series correctly ("FY2024 — Value").

**Design.** One exported helper, `measureName(column)` in `src/lib/widgetData/chartFigure.ts`, builds the name from the column's split path labels and its label. The legend and the Measures checkboxes both use it. Columns without a split path keep their label, so existing figures are identical.

**Approaches.** Labelling the checkboxes differently from the legend was rejected: the box you tick should read like the series you see.

**Non-goals.** The Category list and any other control.

**Constraint.** Cut from `v4.0.0`, independent of #46 and the waterfall branch; expect a small conflict with #46 (same lines) at the carry.
