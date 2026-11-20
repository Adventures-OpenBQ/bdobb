# Estimate revision examples

1. Import the [Workspace template](../v9-next-estimate-revisions.apps.json).
2. On **Slope** or **Time path**, drop [the fictional single-issuer history](fictional-single-issuer.json). Use **Choose source** to attach the dropped table to the chart.
3. On **Bump**, drop [the fictional two-issuer universe](fictional-universe.json) and attach it to the chart.
4. Hover or tap a marker, or open **Estimate revision observations** with the keyboard to read original values, UTC observation times, batch IDs and signed changes.

Each file records fictional consensus for the same inclusive FQ target, January 1 through March 31, 2027, in three distinct November 2026 batches. The slope compares the first and last pins. The time path leaves a gap at the missing middle estimate. The bump chart compares all issuers against their positive estimates at the common baseline batch. Both issuers share rank 1 at baseline and at the final batch. The missing middle estimate makes the middle rank column unavailable for both issuers.

Production slope and path require a verified local history with one issuer visible. Bump also requires an independently documented stable universe and a positive estimate for every member at the common baseline. Pin both declared endpoint batches. A missing reading leaves the entire rank column unavailable, including at the current vintage. The live analyst estimates route supplies fiscal targets, consensus ranges and relative change fields. Those dates and fields cannot certify independently recorded vintages. All live revision views remain unavailable. The template and local examples use fictional data and omit live acquisitions.

An attached file triggers `MISSING_LOCAL_ASSET` when exporting a Workspace. To save the chart choices, relink to the empty local placeholder and remove the file-backed card before exporting. After import, drop the file again and use **Choose source**. If a saved vintage is unavailable, clear that pin and choose another recorded vintage explicitly.
