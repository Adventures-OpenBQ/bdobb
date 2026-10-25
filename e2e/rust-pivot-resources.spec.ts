// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '@playwright/test';
declare global {
    interface Window {
        pivotResourceHarness: {
            resourceProbe(): Promise<unknown>;
            replacementProbe(): Promise<unknown>;
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
