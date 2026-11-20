# V9 screening and income chart review

## Independent whole-change review pending

The final reviewer should assess the approved three-chart design, the verification evidence and all three candidate changes. The commits in this table identify the review inputs. Review findings and their severities are pending.

| Repository | Review base | Candidate |
| --- | --- | --- |
| BDOBB | `c6911588ac5d7dba748008abe6aec1ab09ab2204` | `fd5edb848a3ffe0e3f6bc78a4065e310640206c5` |
| Canonical openbq-eodhd | `349f2de40773cf2e1d9e2993ebabf3184871c07d` | `5c54b403513ef5759a9c1d461da54669e2a6d91c` |
| openbq-docker | `f1ff723e66ece8bf404a8211716a62591d464581` | `fb2df569e30c618652a9eec00db95c7ec7d4ad86` |

The reviewer should cover acquisition before normalization, contradiction and omission survival through both engines and linked projections, regression limits and bubble area, dividend window and gap semantics, typed Statement currency and scale, Sankey reconciliation, source ownership and asynchronous rendering, visual evidence, and the limits of the paired package proof. Include the documentation commit in the evidence review. The two next-eight documentation commits in the BDOBB range belong to their own review.

[Approved design](../../../../superpowers/specs/2026-11-19-v9-screening-income-design.md) · [Implementation plan](../../../../superpowers/plans/2026-11-19-v9-screening-income.md) · [Verification and limits](verification.md) · [Controller rulings](rulings.md)

## Scoped review history

The task reviews closed the findings below. Whole-change review remains open.

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
