// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect } from '@playwright/test';
import { card, openParameters, plot, recordRecipeReplies } from './fixtures/chart-recipes';
import { readCapture, replayInstalledPrices, sourceId, table } from './fixtures/installed-prices';
import { liveRecipe, test } from './fixtures/return-summary';

const chart = 'Captured return summaries';
const scope = 'Observed quote-to-quote returns; exchange-session completeness unknown.';
const equity = '/equity/price/historical', etf = '/etf/historical';
const captures = [
  ['canonical-standards', ['/api/v1' + equity, '/api/v1' + etf]],
  ['deterministic-sdk', ['/api/v1/eodhd' + equity, '/api/v1/eodhd' + etf]],
  ['public-demo', ['/api/v1/eodhd' + equity]],
] as const;

for (const [name, endpoints] of captures) {
  for (const endpoint of endpoints) {
    test(`replays installed ${name} GET ${endpoint} through the table and recipe worker`, async ({ page, browser, engineEvidence }, info) => {
      const capture = readCapture(name).routes[endpoint];
      expect(capture.widget.data.dataKey).toBe(capture.selector);
      const readReplies = await recordRecipeReplies(page);
      const requests = await replayInstalledPrices(page, endpoint, capture, [
        { id: 'returns', widgetId: 'linked_chart', backendId: 'builtin', title: chart, params: {},
          linkedSource: { kind: 'widget', sourceWidgetId: sourceId },
          linkedChart: { type: 'return-summary', recipe: liveRecipe, measures: [], display: 'grouped' },
          layout: { x: 0, y: 0, w: 40, h: 29 } },
      ], 29);

      const widget = card(page, chart), graph = plot(page, chart);
      const expected = liveRecipe.symbols.map(symbol => ({ symbol, samples: capture.expected[symbol].returns }));
      const assertSamples = async (view: 'box' | 'violin') => {
        const series = async () => {
          const latest = (await readReplies()).reverse().find(({ reply }) =>
            'result' in reply && reply.result.ok && reply.result.returnSummary?.view === view)?.reply;
          return latest && 'result' in latest && latest.result.ok
            ? latest.result.returnSummary?.series.map(({ symbol, samples }) => ({ symbol, samples })) : undefined;
        };
        await expect.poll(series).toEqual(expected);
        await info.attach(`${view}-worker-samples`, {
          body: JSON.stringify(await series()), contentType: 'application/json',
        });
      };
      await expect(card(page, table).getByRole('columnheader', { name: /adjusted.close/i })).toBeVisible();
      await expect(graph.locator('.boxlayer path.box')).toHaveCount(2);
      await expect(widget.getByText(scope, { exact: true })).toBeVisible();
      await assertSamples('box');
      const requestCount = requests.length;
      expect(requestCount).toBeGreaterThan(0);
      expect(requests).toEqual(Array(requestCount).fill({ method: capture.method, query: capture.query }));

      if (name === 'public-demo') {
        const panel = await openParameters(widget);
        await panel.getByLabel('Return view').selectOption('violin');
        await panel.getByRole('button', { name: 'Apply chart settings' }).click();
        await expect(graph.locator('.scatterlayer path.js-fill')).toHaveCount(2);
        await assertSamples('violin');
        expect(requests).toHaveLength(requestCount);
      }
      await info.attach('installed-replay-runtime', {
        body: JSON.stringify({ ...engineEvidence, version: browser.version(), requests }), contentType: 'application/json',
      });
    });
  }
}
