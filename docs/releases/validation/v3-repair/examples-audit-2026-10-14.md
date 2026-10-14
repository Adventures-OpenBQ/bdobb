# v3 example-dashboard audit fixes (2026-10-14)

The example-dashboard audit of 2026-10-14 (finding 2, finding 13 and the examples test's name) corrected on the lowest line, then merged up v3 → v10.

**Finding 2, re-verified.** BDOBB v3 pairs with `openbb-docker` `v3.0.1` (`package.json` `openbbDocker`). At that tag the image installs no `openbb-videos` extension (`git grep -i videos v3.0.1` in openbb-docker finds nothing), and its `workspace_apps.json` serves two apps: *Built-in widgets* and *Demo providers* with six provider cards, no `videos_video_custom_obb`. The Example Dashboards page and the stack page now say that the Video Library example and the Demo providers' video card need a stack with the `openbb-videos` extension, and that v3.0.1 serves neither. The example files are unchanged, cards included.

`scripts/apps-sync.mjs` at v3 has no "not served" notion: `OWNER` routes every example to an `openbb-docker` file, and v3 has no `SERVED` table. So the script is unchanged here. The v4 line's `SERVED` table already marks the Video Library `false`.

**Finding 13.** The Example Dashboards page now says the file names (`v3.1.0-*`, `v3.2.0-*`) record the sub-release that introduced each example, and that BDOBB 3.0.0 keeps them because the sync keys on them. No file is renamed.

**REVIEW, `src/lib/appsJson.examples.test.ts`: "ships at least the three known examples" is now "ships every known example file, and no file the list does not name".** The `arrayContaining` assertion is kept unchanged over the same three names, now held in `KNOWN`. A second assertion is added: the sorted file list equals `KNOWN`, so a new example file fails until it is named. The test is stronger, not weaker.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| header-check | clean |
| scrub-check | clean |
| `vitest run src/lib/appsJson.examples.test.ts src/help scripts/help-shots.test.mjs` | 7 files, 60 tests passed |
