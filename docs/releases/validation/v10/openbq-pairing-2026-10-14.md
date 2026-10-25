# v10: openbq-docker v10 pairing, one combined examples file (2026-10-14)

The v3 fix of 2026-10-14 (`docs/releases/validation/v3-repair/openbq-pairing-2026-10-14.md`: Demo providers on openbq-docker's widget ids with Nasdaq EPS in place of Alpha Vantage, the openbq-docker `apps-sync`, the pairing help) merged into v10 with a merge commit, and adjusted for this line.

**Pairing.** `package.json` `openbqDocker` is `v10.0.0` (tag present on openbq-docker); `openbbDocker` `v3.0.1` stays as the gateway-policy vendor record.

**`scripts/apps-sync.mjs`.** v3's scan (every `*apps.json` under `docs/examples`, loud failure on one `SERVED` does not name or a `SERVED` entry with no file) with every example of this line `SERVED`; the usage line says `EPISODE=10`. Dry run into a scratch directory with openbq-docker `v10.0.0`'s logo; nothing written to openbq-docker:

- `EPISODE=3`: 3 apps — Built-in widgets, Demo providers, Video Library
- `EPISODE=4` … `EPISODE=8`: 5, 7, 8, 9, 11 apps, as on those lines
- `EPISODE=9`: 12 apps — adds Example Dashboard - Version 9.0.0 - Calendars
- `EPISODE=10` (and no `EPISODE`): 13 apps in `examples/bdobb/apps.json` — adds Example Dashboard - Version 10.0.0 - Live Grid, with the logo like the rest — and 1 app, the live-grid example as it is, in `live-grid/apps.json`, byte-identical to openbq-docker `v10.0.0`'s `live-grid/apps.json`

**The live-grid example.** On v10 it now goes into the combined `examples/bdobb/apps.json` like every example (`SERVED` entry `{ also: "live-grid/apps.json" }`), so the API's `/apps.json` lists it; its cards are live-grid's widgets and resolve once that service is connected. The sync also keeps writing it, as it is, to `live-grid/apps.json`, because openbq-docker v10's live-grid service still reads that file (`live-grid/app/main.py` `APPS_PATH`, baked by `live-grid/Dockerfile`) and serves it at its own `/apps.json`. Example Dashboards says both. `package.json` already carried `"openbqDocker": "v10.0.0"`; unchanged.

**Help.** Example Dashboards lists every example of the line, Demo providers and Video Library included, states the openbq-docker v10 pairing and the one combined file served from v3 on, `credentials.demo.env`, the logo served by openbq-docker's lanes hook without auth, `EPISODE=10 pnpm apps:sync` and the `v3.1.0-`/`v3.2.0-` file-name sentence, and no longer names the never-existing `claude/vN-bdobb-examples` branches. The stack page gains *What it serves to BDOBB: examples, demo keys and the logo* and the `credentials.demo.env` sentence under *Before first start*. Home's Example Dashboards entry names every example from 3.0.0.

**REVIEW, `src/lib/appsJson.examples.test.ts`: "ships at least the three known examples" is now "ships every known example file, and no file the list does not name"**, with `KNOWN` naming every example file on this line. The `arrayContaining` check is kept; the exact-list check is added. Stronger, not weaker.

The `files` change, the V5 Statement test and the minimum-version regex (REVIEW notes on v5 and v8) arrive by the merge unchanged. The live-grid test is unchanged: the example file is still what `apps:sync` writes, verbatim, to `live-grid/apps.json`.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| header-check | clean |
| scrub-check | clean |
| `vitest run src/lib/appsJson.examples.test.ts src/help scripts/help-shots.test.mjs` | 8 files, 154 tests passed |
| `node --test web/*.test.mjs` | 52 passed |
| full unit suite, `vitest run --maxWorkers=2` | 439 files passed, 6 skipped; 8027 tests passed, 29 skipped |

Provisional on openbq-docker's side: the `openbb-videos` and EconDB extensions on v3, `credentials.demo.env`, `examples/bdobb/apps.json` holding every example and the `/openbq/bdobb-logo.svg` route are another agent's work in progress, not on openbq-docker's release branches at the time of writing.
