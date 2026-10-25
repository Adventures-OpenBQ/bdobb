# v5: openbq-docker v5 pairing, one combined examples file (2026-10-14)

The v3 fix of 2026-10-14 (`docs/releases/validation/v3-repair/openbq-pairing-2026-10-14.md`: Demo providers on openbq-docker's widget ids with Nasdaq EPS in place of Alpha Vantage, the openbq-docker `apps-sync`, the pairing help) merged into v5 with a merge commit, and adjusted for this line.

**Pairing.** `package.json` `openbqDocker` is `v5.0.0` (tag present on openbq-docker); `openbbDocker` `v3.0.1` stays as the gateway-policy vendor record.

**`scripts/apps-sync.mjs`.** v3's scan (every `*apps.json` under `docs/examples`, loud failure on one `SERVED` does not name or a `SERVED` entry with no file) with every example of this line `SERVED`; the usage line says `EPISODE=5`. Dry run into a scratch directory with openbq-docker `v5.0.0`'s logo; nothing written to openbq-docker:

- `EPISODE=3`: 3 apps — Built-in widgets, Demo providers, Video Library
- `EPISODE=4`: 5 apps — those, V4 core tools, Parameters
- `EPISODE=5`: 7 apps — those, V5 Statement Example, Example Dashboard - Version 5.0.0 - Treasury Auctions

**V5 Statement Example.** `docs/examples/v5-financial-demo/apps.json` is now served: `SERVED` names it, and the scan reaches it (the old top-level `*.apps.json` filter skipped it silently). Its description is unchanged on v5–v7, whose examples carry no minimum-version sentence (f6d8ab02 added those on v8). Example Dashboards gains a *V5 Statement Example* section.

**Help.** Example Dashboards lists every example of the line, Demo providers and Video Library included, states the openbq-docker v5 pairing and the one combined file served from v3 on, `credentials.demo.env`, the logo served by openbq-docker's lanes hook without auth, `EPISODE=5 pnpm apps:sync` and the `v3.1.0-`/`v3.2.0-` file-name sentence, and no longer names the never-existing `claude/vN-bdobb-examples` branches. The stack page gains *What it serves to BDOBB: examples, demo keys and the logo* and the `credentials.demo.env` sentence under *Before first start*. Home's Example Dashboards entry names every example from 3.0.0.

**REVIEW, `src/lib/appsJson.examples.test.ts`: "ships at least the three known examples" is now "ships every known example file, and no file the list does not name"**, with `KNOWN` naming every example file on this line. The `arrayContaining` check is kept; the exact-list check is added. Stronger, not weaker.

**REVIEW, `src/lib/appsJson.examples.test.ts`: `files` was the top-level `*.apps.json` only; it now also reads every `<dir>/apps.json` under `docs/examples` (`v5-financial-demo/apps.json`).** Every `it.each` (the import against a registry that serves each card, and on v8+ the minimum-version and no-docks checks) now covers the V5 Statement Example as well; `KNOWN` names it. No check dropped. Added: "v5-financial-demo: the V5 Statement card names its fixture's widget and imports in the Statement view" — one app, the one card `synthetic_cash_flow`, exactly the id the fixture's `widgets.json` declares, its endpoint file beside it, imported in the Statement view with `collapsed: []`.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| header-check | clean |
| scrub-check | clean |
| `vitest run src/lib/appsJson.examples.test.ts src/help scripts/help-shots.test.mjs` | 8 files, 77 tests passed |
| `node --test web/*.test.mjs` | 33 passed |

Provisional on openbq-docker's side: the `openbb-videos` and EconDB extensions on v3, `credentials.demo.env`, `examples/bdobb/apps.json` holding every example and the `/openbq/bdobb-logo.svg` route are another agent's work in progress, not on openbq-docker's release branches at the time of writing.
