# v8: openbq-docker v8 pairing, one combined examples file (2026-10-14)

The v3 fix of 2026-10-14 (`docs/releases/validation/v3-repair/openbq-pairing-2026-10-14.md`: Demo providers on openbq-docker's widget ids with Nasdaq EPS in place of Alpha Vantage, the openbq-docker `apps-sync`, the pairing help) merged into v8 with a merge commit, and adjusted for this line.

**Pairing.** `package.json` `openbqDocker` is `v8.0.0` (tag present on openbq-docker); `openbbDocker` `v3.0.1` stays as the gateway-policy vendor record.

**`scripts/apps-sync.mjs`.** v3's scan (every `*apps.json` under `docs/examples`, loud failure on one `SERVED` does not name or a `SERVED` entry with no file) with every example of this line `SERVED`; the usage line says `EPISODE=8`. Dry run into a scratch directory with openbq-docker `v8.0.0`'s logo; nothing written to openbq-docker:

- `EPISODE=3`: 3 apps — Built-in widgets, Demo providers, Video Library
- `EPISODE=4`: 5 — adds V4 core tools, Parameters
- `EPISODE=5`: 7 — adds V5 Statement Example, Example Dashboard - Version 5.0.0 - Treasury Auctions
- `EPISODE=6`: 8 — adds Example Dashboard - Version 6.0.0
- `EPISODE=7`: 9 — adds Example Dashboard - Version 7.0.0
- `EPISODE=8`: 11 — adds Example Dashboard - Version 8.0.0, Example Dashboard - Version 8.0.0 - Pinned Cards

**Minimum-version sentences** (this line carries them since f6d8ab02). Demo providers and Video Library take v3's new descriptions and keep their ending "Opens in BDOBB 3.0.0 or later."; the V5 Statement Example's description gains "Opens in BDOBB 5.0.0 or later.", phrased as f6d8ab02 phrased the v3 files. Example Dashboards' minimum-version paragraph names the V5 Statement Example's v5 extension. `package.json` already carried `"openbqDocker": "v8.0.0"`; unchanged.

**Help.** Example Dashboards lists every example of the line, Demo providers and Video Library included, states the openbq-docker v8 pairing and the one combined file served from v3 on, `credentials.demo.env`, the logo served by openbq-docker's lanes hook without auth, `EPISODE=8 pnpm apps:sync` and the `v3.1.0-`/`v3.2.0-` file-name sentence, and no longer names the never-existing `claude/vN-bdobb-examples` branches. The stack page gains *What it serves to BDOBB: examples, demo keys and the logo* and the `credentials.demo.env` sentence under *Before first start*. Home's Example Dashboards entry names every example from 3.0.0.

**REVIEW, `src/lib/appsJson.examples.test.ts`: "ships at least the three known examples" is now "ships every known example file, and no file the list does not name"**, with `KNOWN` naming every example file on this line. The `arrayContaining` check is kept; the exact-list check is added. Stronger, not weaker.

**REVIEW, `src/lib/appsJson.examples.test.ts`, "%s names the minimum BDOBB version in its description": the line regex was `/^v(\d+)\./` and is now `/^v(\d+)[.-]/`.** With `files` now including `v5-financial-demo/apps.json` (v5's REVIEW, merged), the old pattern would not match that name; the new one reads its major (5) the same way. Every other check in the test is unchanged, and it now covers one more file: the V5 Statement Example must say "BDOBB 5.0.0 or later", at or above its v5 envelope. The `files` change and the V5 Statement test arrive by the merge unchanged.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| header-check | clean |
| scrub-check | clean |
| `vitest run src/lib/appsJson.examples.test.ts src/help scripts/help-shots.test.mjs` | 8 files, 136 tests passed |
| `node --test web/*.test.mjs` | 42 passed |

Provisional on openbq-docker's side: the `openbb-videos` and EconDB extensions on v3, `credentials.demo.env`, `examples/bdobb/apps.json` holding every example and the `/openbq/bdobb-logo.svg` route are another agent's work in progress, not on openbq-docker's release branches at the time of writing.
