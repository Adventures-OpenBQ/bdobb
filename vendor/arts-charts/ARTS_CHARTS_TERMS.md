<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1. -->
<!-- SPDX-License-Identifier: BUSL-1.1 -->

# Arts Charts — supplemental terms

**Applies to release v12.0.0 and later.** Earlier releases are unaffected and
keep the terms they shipped under.

These terms are supplemental to the Business Source License 1.1 in `LICENSE`,
which governs this software. They add one condition, and they add it only to
material this project's copyright holder owns. SecretoftheUniverse.com LLC is
the Licensor of the Licensed Work under that licence, and offers these terms as
the Licensor; that is the basis for what follows.

Nothing here alters, restates, or extends the terms of any third-party
component. Where a third party's requirement is described below, it is
described for your information only, and that third party's own licence
governs it.

## 1. The Arts Charts mark

"The Arts Charts mark" means the bar-mark image rendered as a chart watermark
by `src/lib/chart/watermark.ts`, and the source artwork it is built from
(`src/assets/arts-charts-mark.svg` and `src/assets/arts-charts-mark-dark.svg`).
It is the property of SecretoftheUniverse.com LLC.

**Condition.** If you use this software, or any derivative work of it, to
produce a chart image, you must leave the Arts Charts mark in place on that
image. This applies whether the chart is kept for your own use or published,
broadcast, or otherwise shown to others, and whether it is exported, screenshot,
printed, or embedded.

**Removal.** SecretoftheUniverse.com LLC will consider granting terms for the
removal of the Arts Charts mark. Enquiries are welcome — see `README.md` for
contact details. Removal without such terms is not permitted by this licence.

## 2. The TradingView attribution logo — what their licence asks

Arts Charts renders through **Lightweight Charts™**, © 2023 TradingView, Inc.,
which is licensed to this project under Apache-2.0 and is **not** covered by
section 1 above. SecretoftheUniverse.com LLC has no authority over TradingView's
mark and grants no rights in it.

TradingView's own terms, as published with the library, ask that you:

> add the "attribution notice" from the NOTICE file and a link to
> <https://www.tradingview.com/> to the page of your website or mobile
> application that is available to your users

and offer the library's `attributionLogo` layout option as one way to satisfy
the link. That option **defaults to enabled**, and this project keeps it
enabled (`src/components/renderers/arts-charts/PanelHost.tsx`). The credit
itself is carried in `THIRD_PARTY_NOTICES.md` and shown in the application
under **Help ▸ Credits**.

Note what this is and is not. It is a request for attribution and a link on a
user-reachable page — **not** a watermark requirement, and not a term this
project can impose, waive, or license on TradingView's behalf. If you want to
disable the attribution logo, that is a matter between you and TradingView, and
you should approach them directly.

## 3. Interpretation

If any part of section 1 is held unenforceable, the remainder of these terms and
the whole of the Business Source License 1.1 continue to apply. These terms do
not reduce any permission the Business Source License 1.1 grants you in this
project's source code, including its Additional Use Grant; they attach to chart
images produced with the Arts Charts mark, and to nothing else.
