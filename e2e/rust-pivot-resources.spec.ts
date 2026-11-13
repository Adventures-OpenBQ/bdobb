// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '@playwright/test';
declare global {
    interface Window {
        pivotResourceHarness: {
            resourceProbe(): Promise<unknown>;
            replacementProbe(): Promise<unknown>;
            terminatedWorkerProbe(): Promise<unknown>;
            malformedFileProbe(): Promise<unknown>;
        };
    }
}
test('actual Wasm worker enforces injected resource limits and preserves publication', async ({ page }) => {
    await page.goto('http://127.0.0.1:4175/built/');
    await expect(page.locator('#status')).toHaveText('Portable Pivot ready');
    expect(await page.evaluate(() => window.pivotResourceHarness.resourceProbe())).toEqual({ admission: 'RESOURCE_LIMIT', state: 'RESOURCE_LIMIT', width: { error: 'RESOURCE_LIMIT', rows: ['r0', 'r1', 'r2'], totalRevision: 1 }, reacquisition: { error: 'RESOURCE_LIMIT', totalRevision: 1 }, cache: { error: 'RESOURCE_LIMIT', totalRevision: 1 }, batch: { error: 'RESOURCE_LIMIT', totalRevision: 1 }, backpressure: { rows: 500, final: false, rejected: 'RESOURCE_LIMIT', released: 500 } });
});
test('rapid cancelled edit replaces actual worker and restores committed source model and selection', async ({ page }) => {
    await page.goto('http://127.0.0.1:4175/built/');
    await expect(page.locator('#status')).toHaveText('Portable Pivot ready');
    const result = await page.evaluate(() => window.pivotResourceHarness.replacementProbe());
    expect(result).toMatchObject({ rejected: 'Table request cancelled', workers: 2, terminated: 1, ids: ['r0', 'r1', 'r2'], totalRevision: 1, selection: { kind: 'none' } });
});

test('terminated actual WebWorker recovers through explicit cancellation reset with committed selection', async ({ page }) => {
    await page.goto('http://127.0.0.1:4175/built/');
    await expect(page.locator('#status')).toHaveText('Portable Pivot ready');
    expect(await page.evaluate(() => window.pivotResourceHarness.terminatedWorkerProbe())).toEqual({
        route: 'WebWorker.terminate -> pending apply abort -> reset and rehydrate', rejected: 'Table request cancelled', workers: 2,
        before: [90], after: [90], revision: { widgetId: 'source', input: 1, model: 1, output: 1 }, selection: { kind: 'explicit', ids: ['r2'] },
    });
});
test('malformed first and replacement files refuse publication and valid retry recovers without app reopen', async ({ page }) => {
    await page.goto('http://127.0.0.1:4175/built/');
    await expect(page.locator('#status')).toHaveText('Portable Pivot ready');
    expect(await page.evaluate(() => window.pivotResourceHarness.malformedFileProbe())).toEqual({
        first: 'INVALID_REQUEST', replacement: 'INVALID_REQUEST', retained: [10, 20, 90],
        retainedRevision: { widgetId: 'source', input: 1, model: 1, output: 1 }, repaired: [7],
        repairedRevision: { widgetId: 'source', input: 3, model: 3, output: 3 },
    });
});
