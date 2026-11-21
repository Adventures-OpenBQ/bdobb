# Pivot inspector shared-update verification

On November 21, 2026, the light, 1280 px Page inspector failed on its first attempt with `page.evaluate: Resulting promise was garbage collected.` The stack identifies the test's in-page import of `dashboardStore.ts` and shared-group mutation at line 21. The retry passed. The job reported 427 passed, eight skipped and one flaky. Its failure-only artifact upload skipped after the successful retry, so the hosted trace and its navigation history are unavailable. [Original CI job](https://github.com/Adventures-OpenBQ/bdobb/actions/runs/44900796420/job/136836065027)

## What failed at the browser boundary

In Playwright 1.62.1, Chromium's `CRExecutionContext.evaluateWithArguments` sends `Runtime.callFunctionOn` with `awaitPromise: true`. Its error handler translates the protocol's `Promise was collected` into the text above. An async callback that awaits a dynamic import leaves its return value pending across that boundary. The CI log cannot identify what made the promise collectible or whether the store had already changed. The first three ordinary local runs of the reported case passed.

The local control used Chrome Headless Shell 151.0.7922.34, the same build as CI, with V8 15.1.206.8 on macOS arm64. The inspector exercised the real viewer, Zustand store, table worker and saved dashboard. A Playwright route fetched Vite's regular response for `/src/stores/dashboardStore.ts` and appended one **diagnostic-only** export. ES dynamic import calls a module namespace's exported `then` with its native fulfillment callback. This allowed the experiment to control ownership of that callback directly. The real module has no such export. [ECMAScript dynamic import](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-continuedynamicimport) and [thenable resolution](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-newpromiseresolvethenablejob)

| Scenario at the shared update | Observation | Final result |
| --- | --- | --- |
| Original test, hold the import callback strongly, force GC, release the real exports | Callback survived. The popup changed from `R100,R101,missing` to `R101`. | Full inspector passed. |
| Original test, hold the same callback weakly, force GC, attempt release | Callback was collected. The popup still showed `R100,R101,missing`. | Playwright reported the same garbage-collected-promise error at the update. |
| Corrected test, same weak-mode store response, hold the external fixture request across forced GC | The document loaded the fixture and its static store import. The synchronous update changed the popup to `R101`. | Full inspector passed. |

CDP recorded zero main-frame navigations, context destructions or context clears between arming the diagnostic and reading the popup after each update. Delaying a real store re-export in the network and forcing GC succeeded without the added export. Eighty warm store imports also passed with GC queued before import fulfillment. These controls establish one way to lose the asynchronous return path. The exact trigger on the hosted runner remains unknown.

## How the update is delivered

`deliverSharedGroupValue` loads `e2e/fixtures/pivot-shared-group.ts` as an external module in the seeded viewer document. Playwright waits for the script load event. The module statically imports the same dashboard store that the app and table executor use. It installs a page-local function that takes the dashboard ID, group ID and new value. A synchronous evaluation invokes that function and completes the Zustand update before the test proceeds. The fixture and function have the test page's lifetime.

The Page inspector and ordinary group inspector deliver `R101` to group `g`. The Page cascade delivers `Budget` to that group. Each test still drives the real workers and checks the saved dashboard bytes. The inspector assertions cover the shared baseline, the viewer's 109 rows during the override, 112 observed members, selection after reset, paging, focus, touch targets, source-import counts and the saved definition. The cascade checks child/leaf rows and its chart.

## Reproduce the controlled comparison

Use the inspector at source revision `60cbc4f8` for the two original runs. For the corrected run, use the revision containing this document. Install the same locked dependencies and Chromium browser. In a disposable copy of the reported light-desktop case, register this response route **before** `seedApp`. It preserves Vite's response and the app's module identity. The added export hands back the actual exports, omitting only the diagnostic `then` to avoid recursively assimilating the namespace.

```js
await page.route('**/src/stores/dashboardStore.ts', async route => {
  const response = await route.fetch();
  await route.fulfill({
    response,
    body: await response.text() + `
      import * as selfForProbe from '/src/stores/dashboardStore.ts';
      export function then(resolve) {
        const {then: probeOnly, ...actualExports} = selfForProbe;
        if (!window.__gcArmed) { resolve(actualExports); return; }
        window.__gcWeak = new WeakRef(resolve);
        if (window.__gcRetain) window.__gcStrong = resolve;
        window.__gcResume = () => window.__gcWeak.deref()?.(actualExports);
        window.__gcPending();
      }
    `,
  });
});
```

Immediately before the shared update, attach the following probe. Set `retain` to `true` for the original strong control and `false` for both weak-mode runs. Keep the original update and all subsequent assertions. Record the popup's group value and collected lifetime events around the update in a `try/finally`.

```js
const cdp = await page.context().newCDPSession(page);
await cdp.send('Runtime.enable');
const lifetime = [];
page.on('framenavigated', frame => {
  if (frame === page.mainFrame()) lifetime.push(frame.url());
});
cdp.on('Runtime.executionContextDestroyed', event => lifetime.push(event.executionContextId));
cdp.on('Runtime.executionContextsCleared', () => lifetime.push('contexts cleared'));
await page.exposeFunction('__gcPending', async () => {
  await cdp.send('HeapProfiler.collectGarbage');
  console.log('resolver live', await page.evaluate(() => Boolean(window.__gcWeak.deref())));
  await page.evaluate(() => window.__gcResume());
});
await page.route('**/e2e/fixtures/pivot-shared-group.ts', async route => {
  await cdp.send('HeapProfiler.collectGarbage');
  await route.continue();
});
await page.evaluate(retain => {
  window.__gcRetain = retain;
  window.__gcArmed = true;
}, retain);
```

## Ordinary verification

From the client repository, use a fresh Vite/mock port pair and one Chromium worker.

```sh
BDOBB_BROWSER_PORT=51281 BDOBB_MOCK_PORT=51282 pnpm exec playwright test \
  e2e/pivot-page-runtime.spec.ts e2e/pivot-group-inspection.spec.ts \
  e2e/pivot-page-cascade.spec.ts --repeat-each=3 --workers=1 --retries=0 --reporter=list
```

All 51 cases passed without retries in 1.6 minutes. The three repetitions cover both sets of seven inspector variants, both native-worker cases and the Page cascade. `PIVOT_WASM_VERIFY_ONLY=1 pnpm test:run` passed 10,326 tests with 47 optional tests skipped. `pnpm typecheck` and `pnpm lint` passed. `pnpm knip` exited successfully and reported the existing unused exported `Monitor` type in `src/browser-shim/window.ts`.

## Independent review

A fresh independent Superpowers whole-fix review approved product commit `2e7d46460796d5a983c7adcf4d67126c698cbcd4` for publication and hosted CI, with no critical or important findings. [Full review](pivot-inspector-flake-review.md). One optional import-spacing observation is retained in the review. The review confirms preserved behavior and the scope of the controlled comparison; the exact first hosted trigger remains unknown.
