# Unpublished v3 baseline correction

User explicitly authorized rebuilding the unpublished clean v3 and replacing its local v3.0.0 tag after validation. Original tag target: 93bf263386c7de59c11c76303aceb6ab08c1bde1. This checkout is isolated on codex/clean-v3-repair, with no remote; v4/v5 candidate source is untouched.

Restore donor storage fix 4ac9cd071857472220000602e3f37a335503fcee, credited to Art Cashin and Claude Opus 5.5. It references storage issue #316. The native setup creates the app-data root before the frontend's first settings temp-file write; directory errors remain nonfatal and the existing startup warning reports subsequent save failures.

The missing fix was reproduced on a genuinely fresh v5 native profile, and the restored setup removed the startup warning. This v3 requires its own build, fresh-profile launch and cumulative reference/regression evidence before the tag is replaced. Calendar/Keys improvements belong to v4; per-dashboard Workspace tab seeding and New Workspace menu belong to v5. No push or final v4/v5 tag is authorized.

## Validated replacement

Current correction passed 2,903 unit assertions (seven opt-in reference cases skipped in that run and passed separately), 91 browser cases with one opt-in skip, seven reference contracts, all 71 reference widgets, reference Run/numeric refresh checks and nine OpenBQ Docker rendering cases. Native release build passed; a fresh isolated profile created settings without the startup warning. Typecheck, lint, scrub and diff checks passed.

The first reference rendering run exposed stale rehearsal setup: saved-layout arrays were assigned directly instead of normalized to dashboard parameter strings. The corrected rehearsal passed all 71 widgets; PDF selection now targets its own file rail. No product fix was introduced for those harness failures.

[Qualification receipt](validation/v3-repair/qualification.json), [reference inventory](validation/v3-repair/reference-render-results.json), [native receipt](validation/v3-repair/native.json) and [log hashes](validation/v3-repair/log-hashes.json) retain the evidence. Original annotated tag object `4c110d4c33544dcf919c58113f08ea64cc35bdbb` is preserved as `refs/archive/v3.0.0-before-baseline-correction`, targeting the original commit above. Earlier qualification documents describe that original build; this correction receipt supersedes them for the replacement tag.

Final v4 must incorporate this corrected v3 commit into its ancestry before release qualification. Moving the local tag in the candidate repositories does not merge their source or qualify #344/#345. Final v5 must then reconcile its isolated delta onto qualified v4.
