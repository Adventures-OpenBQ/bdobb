// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from '@playwright/test';
import { build } from 'esbuild';

let script: string;
test.beforeAll(async () => {
  // Bundle the actual renderer, React's production scheduler and installed Plotly.
  const result = await build({
    entryPoints: ['e2e/fixtures/etf-sunburst-teardown.tsx'],
    bundle: true, format: 'iife', jsx: 'automatic', outdir: 'out', write: false,
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}', global: 'globalThis' },
  });
  script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text;
});

type Graph = HTMLElement & {
  _ev?: { listenerCount: (event: string) => number };
  removeListener?: unknown;
};

for (const mode of ['timer', 'transition'] as const) {
  test(`replaces a mounted ETF plot after a ${mode} without a page error`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<main id="root" data-transition="${mode === 'transition'}"></main>`);
    await page.addScriptTag({ content: script });
    expect(errors).toEqual([]);
    const graph = page.getByTestId('chart-plot');
    await expect(graph.locator('.sunburstlayer path.surface')).toHaveCount(3);
    await expect.poll(() => graph.evaluate(node => (node as Graph)._ev?.listenerCount('plotly_sunburstclick'))).toBe(1);
    const retired = await graph.elementHandle();

    await page.getByRole('button', { name: 'Replace ETF plot' }).click();
    const replacement = page.getByText('Replacement view is ready', { exact: true });
    await expect.poll(async () => errors.length > 0 || await replacement.isVisible()).toBe(true);
    expect(errors).toEqual([]);
    await expect(replacement).toBeVisible();
    await expect(graph).toHaveCount(0);
    expect(await retired.evaluate(node => ({ connected: node.isConnected, listener: typeof (node as Graph).removeListener })))
      .toEqual({ connected: false, listener: 'undefined' });
    await retired.dispose();
  });
}
