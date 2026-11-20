# v9 chart expansion dependencies

The BDOBB port starts from v9 product commit `a96b96195619e0c66f416bb8fb929bb8dac18cd7` and uses the checked-in plan at `9da0c304af1d3306812c350629e369066b03500b`. The chart commits below are from `Adventures-OpenBQ/bdobb`.

## Linked composition

| Donor commit | Paths and behavior carried |
| --- | --- |
| `180347bb039ebdc2236bae38f58be8ac5dd7a9e9` | `src/lib/widgetData/types.ts`, `src/lib/appsExtensionsV4.ts` and persistence/import tests for Pie, 100% stacked and series orientation. |
| `eae44c9dc148b35606b3fd75b925fa0d4dd75117` | `src/lib/widgetData/chartFigure.ts` and its tests for series from rows, identity colors and figure notes. |
| `c183c77b89beaada126a009b2aa13d28faf96d92` | `src/lib/widgetData/chartFigure.ts` and its tests for Pie, 100% stacked and share refusals. |
| `6c0a33ba56940ff9b82e2d00f6a5e51011d1a8c8` | `src/components/renderers/LinkedChartRenderer.tsx` and its tests for composition controls. |
| `c2bcb894ef691bf69877de4ab36e185695b0695f` | Figure and renderer changes for aggregation hover, unique pie labels and stale refusal clearing. |
| `51910e6b3176b877467225ae70741482cd89700c` | `src/lib/plotly.ts` and figure/test changes for partial Pie registration and percent slice labels. |

## Bullet

| Donor commit | Paths and behavior carried |
| --- | --- |
| `97e886ffe0830ee918bfbb4cdda2a17da3b49a1e` | Linked settings and import/persistence validation, including saved quarter. |
| `8fa902618b6f60ceaa2211a7bf967e8eb1788699` | `src/lib/widgetData/bulletFigure.ts`, dispatch through `chartFigure.ts`, partial indicator registration, shared abbreviation helper in `src/lib/format.ts` and tests. |
| `a69c3edf8c03fe0a76075c4e461d6bacdefc9c6c` | Linked renderer quarter control, actual metric selection, presented-column requests and precision redraw tests. |
| `9cc581a1ee798426a2366c886a68053cff7f4164` | Average tick without a band and an unavailable saved quarter. |
| `6f461bf23869da39779c07cfdb338ed643bc9c65` | Bullet title and consensus label layout, plus growth range note behavior. |
| `baf9ed7d85c20cf502b74de298f02ed1ffc3b8c9` | `src/lib/plotly.ts` and its tests for purging before an indicator redraw. |

## Waterfall

| Donor commit | Paths and behavior carried |
| --- | --- |
| `1ae6f008dd77d026612d3d9f14fa9243ef26727c` | `src/lib/widgetData/waterfallFigure.ts`, typed income statement figure dispatch, partial waterfall registration and reconciliation tests. |
| `4d76cffb183986a71b3439a2a5d7966058ee640f` | Linked renderer controls, waterfall setting cleanup, dashboard import validation and tests. |
| `78219efe111d10faa53368abc3acf7bb7d0d5589` | Missing notes use presented line labels. The two-period compilation and moved-expense regressions are in `src/lib/widgetData/waterfallStatement.test.ts`. |

The waterfall determines sign from each line's home template section. The port leaves the donor-only pivot qualification changes out of the chart integration.

The waterfall settings/import rules combine with the composition and bullet rules. A waterfall always uses statement lines as positions and period columns as series. Bullet reads its estimate values only from presented columns. All trace modules are registered individually in `src/lib/plotly.ts`.

## Statement editor

| Donor commit | Paths and behavior carried |
| --- | --- |
| `9d8786df66e9fa80839b6b651ad4782a920b6c1a` | `src/lib/statementModel` derives displayed membership from saved line placement, validates it, compiles it and preserves it through updates and resets. |
| `60a59b1caae30725cfad2ca19ef0f8668690acc3` | `StatementPanel.tsx` adds the section picker and line Move up control. |
| `78219efe111d10faa53368abc3acf7bb7d0d5589` | Picker options follow the user's section order. The compiled waterfall test covers a cost line displayed in Income that still steps down. |

V9 also uses displayed membership for Statement presentation metadata and export. Section reset restores section settings while retaining per-line placements. Line reset returns the line to its home section, and full reset clears every placement.
