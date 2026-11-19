# V9 risk and ETF chart verification

The native workspace contains four chart cards and four fictional source tables. Chromium exercised the dashboard through the import, refresh, filter, relink and save controls. A second page imported the exported workspace, issued four new source requests and displayed the changed region weight returned to that page. [Open the example](../../../../examples/v9-risk-exposure/README.md)

## Local candidates

| Repository | Tested commit |
| --- | --- |
| BDOBB with examples, help and acceptance tests | `f900f8bb3107ebc68579c6d4549edf26d4611637` |
| openbq-eodhd | `349f2de40773cf2e1d9e2993ebabf3184871c07d` |
| openbq-docker | `f1ff723e66ece8bf404a8211716a62591d464581` |

Both paired repositories had clean worktrees at their design pins. This batch implements acquisition evidence and presentation in BDOBB. Its verification scope for the provider and Docker was repository identity and cleanliness. The native example uses local fixture responses.

## Chromium acceptance

Playwright 1.62.1 drove Chromium 151.0.7922.34 on arm64 macOS. Desktop coverage used a 1600 × 1000 viewport in both themes. The touch case used an 880 × 980 mobile context and a 383-pixel-wide regional plot viewport. The browser imported the same manifest and received the same JSON documents available from the companion HTTP server.

| Chart | Evidence |
| --- | --- |
| Return distribution | Seven daily returns fell into five bins with counts 2, 0, 2, 0 and 3. Both the zero price and the missing observation broke adjacent returns. Hovering the final bin exposed its inclusive 25% boundary. A second acquisition with the largest finite price put the entire count-one bar inside the axis. Hover displayed its original upper bound of `1.7976931348623157E310%`. [Light](screenshots/light-distribution.png) · [Dark](screenshots/dark-distribution.png) · [Extreme hover](screenshots/extreme-bin.png) |
| Small multiples | CEDAR, ALDER and BIRCH started at 100 on March 3, shared an end date of March 16 and had matched vertical scales. Zooming a panel changed all three ranges. Dragging the card’s resize handle changed the grid from three columns to two and retained the selected order and zoom on every axis. [Light](screenshots/light-panels.png) · [Dark](screenshots/dark-panels.png) |
| Holdings Pareto | The leading 50 of 60 holdings accounted for 71% of fund assets. All delivered holdings accounted for 73.2%. The chart reported complete transport and partial provider coverage. Filtering the table to ten rows changed the coverage disclosure. [Light](screenshots/light-holdings.png) · [Dark](screenshots/dark-holdings.png) |
| ETF exposure | Five sectors included a visible Utilities marker at 0%. Requesting regions from the sector table produced a refusal. Relinking to the geographic table and applying its country field drew all twenty labels and original weights. A finger swipe within the plot reached Willow Cape. Tapping its zero marker showed the category, reported weight and equity-exposure basis. [Light](screenshots/light-sectors.png) · [Dark](screenshots/dark-sectors.png) · [Touch](screenshots/narrow-region.png) |

Price refresh with a paged receipt cleared the histogram. Restoring the bounded receipt recovered it. Applying seven bins and the regional exposure settings survived native export and import. Removing the region source cleared that chart and left the holdings plot available.

The touch test initially found 492 pixels of unreachable vertical overflow. Plotly’s drag handler canceled the native swipe. The exposure renderer now enables touch scrolling for a coarse primary pointer and lets Plotly handle the tap once, preserving its hover label. The browser regression covers the resulting gestures. Desktop and watchlist figures retain their existing drag modes. The example was exercised in Chromium and mobile emulation.

## Shipping checks

Node 26.13.0 and pnpm 10.34.4 ran the seven shipping commands individually in the order below on November 19, 2026. Before these gates, the native import suite passed 77 tests, the new Chromium suite passed five, and the combined first- and second-batch Chromium suite passed all nine in 29.4 seconds. The example server returned HTTP 200 for its registry and all four data files, with the expected 35, 60, 5 and 20 rows.

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm typecheck` | 0 | TypeScript passed. |
| `pnpm lint` | 0 | ESLint passed. |
| `pnpm test:run` | 0 | 9,351 passed across 509 files. Seven opt-in integration files skipped 47 tests. |
| `pnpm scrub` | 0 | Content scan and source header check passed. |
| `pnpm test:web` | 0 | 57 passed. |
| `pnpm build` | 0 | Vite 6.4.3 emitted the production assets and source maps. |
| `git diff --check` | 0 | Whitespace check passed. |

The full test run and first-batch baseline each emitted 1,734 React `act` warnings across the same 150 test cases. Per-test and component counts matched. The four WidgetCard emitters covered the visible date range, TradingView UDF specification, managed Statement view and reported fiscal labels. TableRenderer’s dropped-column case also logged its missing column, and its two autosize cases logged jsdom’s unimplemented canvas context. Vite reported mixed static/dynamic imports for the logger and dashboard store, and chunks over 500 kB. Playwright’s Node processes reported the NO_COLOR/FORCE_COLOR environment warning.

## Production size

The first-batch build used product commit `0ee0bdba8020d5a61a991af0ca7f4b093a443d88`. Its lockfile and the candidate’s lockfile share Git blob `9cc9190f5148e3eae53cf927c4ce7f5e1a91d66b`. Totals include every regular file in `dist`.

| Output | First batch | Risk and ETF candidate | Change |
| --- | ---: | ---: | ---: |
| Files | 130 | 130 | 0 |
| All bytes | 46,767,718 | 46,935,403 | +167,685 |
| JavaScript bytes | 7,801,507 | 7,837,696 | +36,189 |
| Source map bytes | 28,395,000 | 28,526,434 | +131,434 |

The recipe worker accounts for 50,933 bytes of JavaScript and a 208,758-byte map in the candidate. The diff against the first-batch product was empty for the package manifest, lockfile and Plotly trace registration. The four recipes draw with the existing bar and scatter modules.
