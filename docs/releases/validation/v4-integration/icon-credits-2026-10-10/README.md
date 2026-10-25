# v4 icon credits and Connections icon 2026-10-10 — receipts (FREEZE)

Branch `claude/v4-18-first-open`, on top of the copyright freeze `ecf5dde`. The audit's correction (2026-10-10) and the user's ruling: some interface icons are third-party, and their credits come over from bdobb-v2 (`src/assets/icons/LICENSE.md`, the `THIRD_PARTY_NOTICES.md` header). This line credits only the icons it ships.

**Icons this line ships:** the Pivot button ("Pivot" by Matt Garbarino) and the Connections rail icon ("connection" by Muh Syafri). **Not on this line:** Layout (from v5), Siemens "ai" (v6).

- **Connections icon swapped.** The rail's previous Connections glyph (55×55, "nodes joined by links", recorded only as "supplied by the user") could not be traced. bdobb-v2 has no source for it, and a web search for its path data found nothing. On the user's instruction it is replaced by bdobb-v2's credited "connection" by Muh Syafri (Noun Project, CC BY 3.0). The glyph block, comment and `fill-rule="evenodd"` are taken from bdobb-v2. This is the only product change. `RailIcon.test.tsx`: the Connections viewBox assertion changes from `0 0 55 55` to `0 0 100 100`, and a test pins the evenodd fill rule. Both failed before the swap.
- **`src/assets/icons/LICENSE.md`.** Ported from bdobb-v2's wording, keeping only this line's icons. The Siemens section carries the full MIT notice. bdobb-v2's references to Help ▸ Credits and help-guide footers are left out, because this line has neither; an in-app credits topic is pending the user's decision.
- **`THIRD_PARTY_NOTICES.md`.** `scripts/third-party-notices.mjs` now prints that file under an **Icons** heading, so `pnpm notices:check` keeps the credits. The "no icon sets are bundled" sentence is gone. The app icons, favicons and `src/assets/branding` stay listed as original BDOBB art, which the user confirmed.
- **`NOTICE`.** Lists the credited icons, and adds a trademark line for the OpenBB "BB" mark that `ConnectionsDialog.tsx` cuts from the openbb.co wordmark.
- **Other drawings checked against bdobb-v2's credit list.** `LockGlyph` (written in bdobb-v2 `d8b344aa3`), the `SectionIcon` strokes and the rail's own rect and stroke glyphs are in-house; none is in bdobb-v2's credit list.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| rail-tests | RailIcon + LeftRail: 106 passed |
| check-tests | header-check + scrub-check passed |
| notices-check | up to date |
| changed-files | `git diff --stat ecf5dde`: NOTICE, THIRD_PARTY_NOTICES.md, scripts/third-party-notices.mjs, RailIcon.tsx (the Connections glyph block only), RailIcon.test.tsx, plus the new src/assets/icons/LICENSE.md |
| diff-check | `git diff --check ecf5dde` exit 0 |
| scrub | scrub-check clean, header-check clean |

**Frozen.** The freeze is this commit. Product behaviour equals `ecf5dde`, except for the Connections rail glyph. Delivery: nothing pushed, no tag moved.
