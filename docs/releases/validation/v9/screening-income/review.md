# V9 screening and income chart review

## Independent finding 5 confirmation pending

The independent whole-change review returned **With fixes**, with seven Important findings. The original candidate was BDOBB `b371605869db9a70476a44b7fd600ed1db39b1cd` (product `fd5edb848a3ffe0e3f6bc78a4065e310640206c5`), canonical provider `5c54b403513ef5759a9c1d461da54669e2a6d91c` and Docker `fb2df569e30c618652a9eec00db95c7ec7d4ad86`. The implementer reproduced the findings, committed fixes and ran the paired acceptance checks. The first independent re-review of the following ranges closed findings 1–4, 6 and 7. It returned **With fixes** on finding 5 because a full-record period missing net income still allowed Apply.

| Repository | Fix base | Corrected product |
| --- | --- | --- |
| BDOBB | `b371605869db9a70476a44b7fd600ed1db39b1cd` | `4f5e254eeccb4daad55cb70c6616f7b205e5c5dd` |
| Canonical openbq-eodhd | `5c54b403513ef5759a9c1d461da54669e2a6d91c` | `6f9f1cb20475c3204867bf03c3f3dc5f7141ca96` |
| openbq-docker | `fb2df569e30c618652a9eec00db95c7ec7d4ad86` | `0e843db5465725f124075709528ea485618c87ad` |

The finding 5 follow-up spans BDOBB `cbbb1269bdebfc25e012ca48b726c9d865666524..2d95868da701f9fa698d6f25f8c25f7a5217cbf8`. The draft and worker now use the same presented-period resolver. Both require finite, source-verified mandatory anchors, accept the existing unmodified gross-profit calculation and allow absent optional expenses. Mounted-parent and Chromium tests preserved the applied FY 2026 settings and plot while FY 2025 displayed a repair. A subsequent refresh invalidating FY 2026 cleared the plot. The controller owns independent confirmation of this follow-up. [Browser capture](screenshots/income-ineligible-draft.png)

| # | Reproduction on the earlier behavior | Change and verified result |
| --- | --- | --- |
| 1 | The generated screener field named the percent formatter. The old packaged HTTP row held 0.05 and the actual Chromium table cell displayed 0.05 %. | The provider now emits `normalizedPercent`. The same upstream 5 percentage points, paired packaged row 0.05, and generated widget column produce a 5 % cell in the real source table. |
| 2 | The local loader accepted verified dividend coverage with paged, partial and sample delivery. The matched HTTP receipt previously omitted scope reconciliation. | Local ingress rejects the contradictory file. HTTP ingress withholds proof for negative delivery on the envelope or its results object. Normal HTTP arrays with verified evidence and generic unknown table scope still draw. A real HTTP dotted selector test preserves the negative envelope and withholds its receipt. |
| 3 | A qualified listing suffix could contradict the exchange. Delivered unadjusted dividend basis, a diagnostic claiming an absent raw conflict, incompatible FY/FQ labels and a mismatched fiscal year were accepted. | Both acquisition paths check delivered rows and closed receipt facts before projection. Consistent unsafe facts remain available for repair. TypeScript and compiled Rust retain the amount-basis refusal through another link after removing the field. Source-line aliases and display-period renaming remain supported. |
| 4 | At 2025-02-01 with nominal January year end, the provider returned 2026/FY and 2026/Q1. | The opted-in provider preserves actual end and FY/FQ kind. Only the annual bucket supplies an FY label. Fiscal years and numbered quarters remain unknown from a nominal month. Legacy callers keep the old labels. The canonical quarter snapshot crossed both actual Statement engines and its chart title read “FQ · 2025-02-01 · USD × 1000”. |
| 5 | A mounted chart offered Apply for a valid dividend receipt with unknown coverage. The first re-review also reproduced enabled Apply for a full-record fiscal period missing net income. | Workers and draft choices share the static receipt, selected-cohort and selected-period checks. The draft identifies the repair, disables Apply and keeps the applied chart. Selecting an eligible cohort or period enables Apply. The follow-up checks mandatory presented anchors before Apply using the same checks as the worker. |
| 6 | A newly linked chart disabled Dividend steps for a genuine zero-row, zero-column, verified source. | The parent checks evidence from the current executor revision. The draft uses the acquired instrument and canonical bindings for a new chart and keeps existing field aliases on verified-empty refresh. A first-use mounted test applies the settings and displays the covered no-events result. Unknown coverage, filtered-to-zero and invalid-event sources retain separate outcomes. |
| 7 | In the 780 × 480 Chromium plot the acquired fractional yields 0.1, 0.10000000000000002 and 0.10000000000000003 landed at X pixels 0, 512 and 1024 in a 695 px plot. The fitted endpoint was also clipped. | When coordinate offset and span risk pixel cancellation, the chart widens the display range and preserves each original value and the observed fit endpoints. DOM geometry checks compare all marker centers and both line ends with the real plot domain at 780 × 480, 390 × 440 and 1100 × 620. |

[Approved design](../../../../superpowers/specs/2026-11-19-v9-screening-income-design.md) · [Implementation plan](../../../../superpowers/plans/2026-11-19-v9-screening-income.md) · [Verification and limits](verification.md) · [Controller rulings](rulings.md)

## Scoped review history

The task reviews closed the findings below. The whole-change review and follow-up dispositions appear above.

| Task | Finding and disposition | Scoped confirmation |
| --- | --- | --- |
| 1. Provider receipt | A malformed latest income period could disappear before the requested limit was applied. Denial-shaped or malformed envelopes could appear empty. The provider now audits acquisition identity and period selection before certifying and distinguishes verified empty data from malformed responses. The empty-fixture reference was corrected. | `a8c9ecc` → `5c54b403` on openbq-eodhd |
| 2. Packaging | The reviewer confirmed canonical file equality and the packaged receipt and legacy-route coverage. The existing aiohttp, pip and EconDB fixture diagnostics remain recorded. | `fb2df569` on openbq-docker |
| 3. Transport and projection | The backend snapshot fallback could bypass opt-in or request matching. A contradictory screener delivery count could retain a receipt. The two fix rounds enforced the completed request and the v1 normalized/delivered count invariant. | `b4fbe3a0` → `f8d828b9` → `d4a9060e` |
| 4. Options and typed Statement input | Scoped review accepted the decoder and resolver, including native placement with preserved typed origin. The existing React `act` diagnostics remain recorded. | `970cba11` |
| 5. Bubble regression | Finite inputs could lose covariance during normalization, and the installed SVG circle renderer could round an admitted radius to zero. Exact centered moments preserve representable values. The builder now refuses an unrepresentable plot at the actual SVG rounding boundary. | `2364dca8` → `f1fefc08` |
| 6. Dividend steps | A no-column source of invalid observations lost its scope and counts. Plotly's fixed axis bounds could flatten the dividend and bubble charts. The worker preserves window and counts, and installed-renderer tests confirm ordinary autorange with clipping bounds. | `33a65c9e` → `393fed3b` |
| 7. Income Sankey | An ordinary fractional bridge could fail reconciliation, and status could omit the direction of signed adjustments. The builder now reports the signed difference within the bounded tolerance and preserves the original values in the rendered links. | `329954b1` → `589a8d44` |
| 8. Controls and lifecycle | The screening draft exposed cohort choices without a valid acquisition receipt, and repair copy claimed a wait on a settled view. The mounted parent now gates the draft on valid acquired evidence and gives repair guidance with one source notice. | `b32c4925` → `b35e62f1` |
| 9. Browser and examples | Dark Sankey tooltip contrast fell below 4.5:1 and the terminal capture overlapped the import notice. The scoped palette passes the conservative 4.5:1 bound in both themes with native opacity. The repositioned card capture shows the full terminal tooltip. | `896118e9` → `fd5edb84` |

Record subsequent whole-change findings, reviewed fixes, exact reviewed SHAs and final independent disposition here.
