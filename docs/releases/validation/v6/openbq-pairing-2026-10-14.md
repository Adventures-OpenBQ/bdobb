# v6: openbq-docker v6 pairing, one combined examples file (2026-10-14)

The v3 fix of 2026-10-14 (`docs/releases/validation/v3-repair/openbq-pairing-2026-10-14.md`: Demo providers on openbq-docker's widget ids with Nasdaq EPS in place of Alpha Vantage, the openbq-docker `apps-sync`, the pairing help) merged into v6 with a merge commit, and adjusted for this line.

**Pairing.** `package.json` `openbqDocker` is `v6.0.0` (tag present on openbq-docker); `openbbDocker` `v3.0.1` stays as the gateway-policy vendor record.

**`scripts/apps-sync.mjs`.** v3's scan (every `*apps.json` under `docs/examples`, loud failure on one `SERVED` does not name or a `SERVED` entry with no file) with every example of this line `SERVED`; the usage line says `EPISODE=6`. Dry run into a scratch directory with openbq-docker `v6.0.0`'s logo; nothing written to openbq-docker:

- `EPISODE=3`: 3 apps — Built-in widgets, Demo providers, Video Library
- `EPISODE=4`: 5 apps — those, V4 core tools, Parameters
- `EPISODE=5`: 7 apps — those, V5 Statement Example, Example Dashboard - Version 5.0.0 - Treasury Auctions
- `EPISODE=6`: 8 apps — those, Example Dashboard - Version 6.0.0

**Help.** Example Dashboards lists every example of the line, Demo providers and Video Library included, states the openbq-docker v6 pairing and the one combined file served from v3 on, `credentials.demo.env`, the logo served by openbq-docker's lanes hook without auth, `EPISODE=6 pnpm apps:sync` and the `v3.1.0-`/`v3.2.0-` file-name sentence, and no longer names the never-existing `claude/vN-bdobb-examples` branches. The stack page gains *What it serves to BDOBB: examples, demo keys and the logo* and the `credentials.demo.env` sentence under *Before first start*. Home's Example Dashboards entry names every example from 3.0.0.

**REVIEW, `src/lib/appsJson.examples.test.ts`: "ships at least the three known examples" is now "ships every known example file, and no file the list does not name"**, with `KNOWN` naming every example file on this line. The `arrayContaining` check is kept; the exact-list check is added. Stronger, not weaker.

The `files` change and the V5 Statement test (REVIEW, from v5's receipt) arrive by the merge unchanged.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| header-check | clean |
| scrub-check | clean |
| `vitest run src/lib/appsJson.examples.test.ts src/help scripts/help-shots.test.mjs` | 8 files, 92 tests passed |
| `node --test web/*.test.mjs` | 33 passed |

Provisional on openbq-docker's side: the `openbb-videos` and EconDB extensions on v3, `credentials.demo.env`, `examples/bdobb/apps.json` holding every example and the `/openbq/bdobb-logo.svg` route are another agent's work in progress, not on openbq-docker's release branches at the time of writing.
