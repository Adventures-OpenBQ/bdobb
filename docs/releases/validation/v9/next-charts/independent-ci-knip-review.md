# CI Knip repair review

## Spec compliance

**Compliant** for `a595ff83..57fe98e3`.

- [knip.json](../../../../../knip.json#L11) registers the seven exact reproducers. The [reproducer README](../../../../../docs/releases/validation/v9/next-charts/reproduce/README.md#L27) documents six commands and names the historical overlay probe at line 35. The ignores, rules and issue severities are outside the diff.
- [knip.json](../../../../../knip.json#L21) maps Vite's root-relative source specifiers to actual source files. A focused check found the 19 matching imports in the six relevant scripts, including [revision-2-renderer.mjs](../../../../../docs/releases/validation/v9/next-charts/reproduce/revision-2-renderer.mjs#L44). Knip's installed resolver returns a mapped module only if it resolves (`node_modules/knip/dist/typescript/resolve-module-names.js:166–181`). Its missing-import path records unresolved specifiers (`node_modules/knip/dist/typescript/get-imports-and-exports.js:180–203`). The mapping leaves the targets subject to analysis.
- [knip.json](../../../../../knip.json#L9) adds two exact shim roots. The focused alias check confirmed that [vite.config.ts](../../../../../vite.config.ts#L109) selects both aliases in browser mode at line 177. The normal dialog and FS imports are visible in [chatExportFile.ts](../../../../../src/lib/chatExportFile.ts#L4). The FS test enumerates the API in [shims.test.ts](../../../../../src/browser-shim/shims.test.ts#L31). The root entries retain those API exports while Knip continues to inspect the files and their imports.
- The seven source hunks only remove eight export names. The type removals are in [authoringValidation.ts](../../../../../src/components/renderers/table-model/authoringValidation.ts#L10), [capabilities.ts](../../../../../src/lib/agent/tableModel/capabilities.ts#L13) and [types.ts](../../../../../src/lib/tableExecution/types.ts#L5). Redundant value re-exports are removed from [providerContract.ts](../../../../../src/lib/tableExecution/rust/providerContract.ts#L6), [dualAxisOverlay.ts](../../../../../src/lib/widgetData/chartRecipes/dualAxisOverlay.ts#L22), [newsCalendar.ts](../../../../../src/lib/widgetData/chartRecipes/newsCalendar.ts#L14) and [providerKeysStore.ts](../../../../../src/stores/providerKeysStore.ts#L24). The focused package-surface check confirmed [package.json](../../../../../package.json#L3) marks the package private and declares no package export map. The source hunks preserve the builders, option and source validation, provider logic, and numerical behavior.
- [verification.md](../../../../../docs/releases/validation/v9/next-charts/verification.md#L180) restores Knip to the gate sequence. The follow-up at line 218 distinguishes the local repair evidence from earlier product qualification.

**Cannot verify from the diff.** The [implementer report](ci-knip-report.md#L61) records the local baseline and repair, Knip exit 0, 330 tests across 15 suites, typecheck, lint, scrub, whitespace checks and seven syntax checks. Covered suites were not rerun during review. The probes' end-to-end browser execution was outside these focused checks. The local run used Node 26 and the workflow uses Node 24. The controller should confirm the new head's actual PR CI before merge.

## Strengths

- The entry list records the opt-in CLI contract and the two mode-dependent aliases precisely. The resolver mapping preserves unresolved-import detection without an exemption.
- Each source edit is limited to its export declaration or the removed export's comment. The existing provider-contract import and used `localCapabilities` re-export are intact.

## Issues

**Critical:** 0.

**Important:** 0.

**Minor:** 1.

- [window.ts](../../../../../src/browser-shim/window.ts#L46) still produces Knip's baseline unused-type warning for `Monitor`. The warning is nonfatal and retaining the compatibility type is within scope.

## Assessment

**Task quality: Approved.** The fix addresses the reported CI failure with exact entry roots, a checked resolver mapping and static export cleanup. Final merge readiness depends on the new head's PR CI.
