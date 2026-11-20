# BDOBB v9 CI Knip repair

- Baseline `a595ff83f97be77fac6561c57b39d4f3104da047`.
- Fix `57fe98e317d35fc5c29281174bd01fce279571c2` on `codex/v9-next-eight-charts`.
- [CI build job on PR 87](https://github.com/Adventures-OpenBQ/bdobb/actions/runs/44763204472/job/136380866304).
- Local toolchain Node v26.13.0, pnpm 10.34.4 and Knip 6.45.1. The workflow selects Node 24.

## Failure and diagnosis

The build job stops before unit, web, build and later Cargo gates when `pnpm knip` exits 1. Running that command on the clean baseline produced `Unused files (7)`, `Unused exports (11)`, `Unused exported types (4)` and exit 1. The workflow and Knip rules make unused-file findings fatal and export/type findings warnings.

The seven files are independent executable reproductions under `docs/releases/validation/v9/next-charts/reproduce/`. The README documents six shell invocations and the historical `overlay-2-native-probe.mjs` with its earlier tick-strategy assertions. All seven were missing from Knip's entry list. Registering only the seven exact script paths removed every unused-file finding and exposed 19 `Unresolved imports` errors. Six scripts call dynamic `import('/src/...')` within Playwright `page.evaluate`. Vite serves those root-relative URLs from the checkout. Adding Knip's `paths` mapping from `/src/*` to `./src/*` resolved all 19 and `pnpm knip` exited 0 with the original warnings. This mapping allows the analyzer to find the targets and still report missing imports.

## Scope of the fix

| Finding | Disposition and traced use |
|---|---|
| Seven opt-in reproducers | Exact Knip entries for `etf-2-native-fill-comparison`, `etf-2-native-worker-probe`, `etf-2-rounded-midpoint-probe`, `market-map-2-renderer`, `overlay-2-native-probe`, `overlay-2-renderer` and `revision-2-renderer`. Their sources and dependencies stay in the analysis. |
| `dialog.ts` `save` | Retained the browser alias module as an exact Knip entry. Vite's browser mode resolves `@tauri-apps/plugin-dialog` to it. The real specifier's consumers include `chatExportFile.ts`. |
| `fs.ts` `mkdir`, `readDir`, `readFile`, `stat`, `writeFile` | Retained the browser alias module as an exact Knip entry. Vite's browser mode resolves `@tauri-apps/plugin-fs` to it. The shim tests pin the surface, and existing browser specs also load it dynamically. |
| `window.ts` `Monitor` | Kept the documented compatibility type and its baseline warning. The window shim has direct unit coverage. The current Vite alias map does not reference it. |
| `providerContract.ts` `ProviderContractError`, `capabilityPreflight` | Removed unused re-exports. Existing callers use `providerCapabilities.ts`; the contract keeps its own import of the error and its used `localCapabilities` re-export. |
| `dualAxisOverlay.ts` `overlayAxisTicks` | Removed the unused re-export. The recipe and renderer still import it from `overlayDisplay.ts`. |
| `newsCalendar.ts` `acquiredNewsWindow` | Removed the unused re-export. Recipe controls import it from `newsCalendarInput.ts`, which also uses it internally. |
| `providerKeysStore.ts` `KEY_MAINT_WIDGET_ID` | Removed the unused re-export. The definition and consumers remain in `lib/providerKeys.ts` and its tests. |
| `authoringValidation.ts` `Reference` | Removed the unused re-export. Its original definition and use in `DraftBindings` remain in `formulaProvenance.ts`. |
| `capabilities.ts` `Capabilities` | Removed the unused `ReturnType` alias. All runtime callers import `capabilitiesFor`. |
| `tableExecution/types.ts` `RuntimeParam` | Removed the unused re-export. `runtimeParams.ts` defines it and `pivotParamGroups.ts` imports it there. |

The private app has no published package export map. The seven source changes only remove unused exports and a comment attached to one of them. The workflow, rules, exemptions, alias source, browser scripts, provider implementation and financial behavior are outside the diff.

## Commands and results

```bash
pnpm knip
pnpm typecheck
pnpm lint
pnpm scrub
git diff --check
pnpm test:run \
  src/browser-shim/shims.test.ts \
  src/lib/tableExecution/rust/providerContract.test.ts \
  src/lib/tableExecution/rust/providerFactory.test.ts \
  src/lib/tableExecution/remote/openbbSsrm.test.ts \
  src/lib/tableExecution/remote/managedProvider.test.ts \
  src/lib/widgetData/chartRecipes/dualAxisOverlay.test.ts \
  src/lib/widgetData/chartRecipes/newsCalendar.test.ts \
  src/components/renderers/LinkedChartRecipeControls.test.tsx \
  src/stores/providerKeysStore.test.ts \
  src/lib/providerKeys.test.ts \
  src/components/renderers/table-model/FormulaPanel.test.tsx \
  src/lib/agent/tableModel/candidate.test.ts \
  src/lib/agent/tableModel/capabilities.test.ts \
  src/lib/tableExecution/runtimeParams.test.ts \
  src/lib/pivotParamGroups.test.ts
for script in docs/releases/validation/v9/next-charts/reproduce/*.mjs; do
  node --check "$script" || exit
done
```

- `pnpm knip` exited 0. Output `Unused exported types (1)` and `Monitor  type  src/browser-shim/window.ts:46:13`. No unused files, unresolved imports or dependency findings.
- `pnpm typecheck` exited 0. `pnpm lint` exited 0 on a sequential run. An initial concurrent ESLint invocation caught a temporary Vite configuration file during enumeration and exited 2 with `ENOENT` when the file disappeared. Sequential execution matched CI and produced no diagnostics.
- `pnpm scrub` exited 0 with `scrub-check: clean` and `header-check: clean`. Working-tree and staged `git diff --check` passed.
- Vitest reported `Test Files 15 passed (15)` and `Tests 330 passed (330)`. The suites cover the browser shim surface, provider session and adapter behavior, two chart recipes and their controls, key maintenance, formula authoring, Rita capabilities and pivot runtime parameters.
- Node syntax checks exited 0 for all seven script files. Browser executions of the opt-in probes and a new full suite were outside this static cleanup's focused verification. The release document identifies the product heads that received those earlier checks.

## Self-review and handoff

Verified the commit is a direct child of the requested baseline and touches nine paths, all listed by `git show --stat 57fe98e3`. The working tree was clean after commit. The durable release verification record includes the red and green outcome and restores Knip to the reproduction command. The one remaining warning is intentional compatibility surface. Remote CI for the new commit awaits review and publication through the controller. No push, merge, deployment, external checkout or catalog action was performed.
