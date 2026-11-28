// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { definition, input, revision } from '../../lib/tableExecution/fixtures';
import type { ChartResult } from '../../lib/tableExecution/types';
import type { EtfSunburstOptions, RecipeContext, RecipeResult } from '../../lib/widgetData/chartRecipes/types';
import { useMeasuredRecipe, type MeasuredRecipeJob } from './useMeasuredRecipe';

const worker = vi.hoisted(() => ({ run: vi.fn(), dispose: vi.fn() }));
vi.mock('../../lib/widgetData/chartRecipes/workerClient', () => ({ createRecipeWorker: () => worker }));

it('keeps a matching draft refusal visible while resizing without admitting an unchecked measurement', async () => {
  const refusal = { ok: false, refused: true, message: 'Original weight cannot be drawn at this size.' } as const;
  let finish!: (result: RecipeResult) => void;
  worker.run.mockResolvedValueOnce(refusal).mockImplementationOnce(() => new Promise<RecipeResult>(resolve => { finish = resolve; }));
  const options: EtfSunburstOptions = { kind: 'etf-sunburst', version: 1, fund: 'VTI.US', snapshot: 'latest', depth: 2,
    fields: { holding: 'symbol', sector: 'sector', weight: 'weight' } };
  const baseContext: RecipeContext = { theme: 'light', maxDecimals: 2, today: '2026-11-21' };
  const response = { requestId: 'measured-draft', revision, completeness: input.completeness, diagnostics: [] };
  const data: ChartResult = { ...input, ...response, kind: 'chartData' };
  const job: MeasuredRecipeJob<EtfSunburstOptions> = { current: () => true, load: async () => data,
    revision, columns: input.columns, ready: { ...response, kind: 'viewReady', columns: input.columns, topLevelCount: input.rows.length,
      inspection: { inputColumns: input.columns, inputPeriodicity: {}, definition, aggregations: {} } } };
  const measurement = (width: number) => ({ box: { width, height: 360 }, baseContext, context: { ...baseContext, viewportWidth: width, viewportHeight: 360 } });
  const matches = () => true;
  const { result, rerender } = renderHook(({ measured, question, producer }) => useMeasuredRecipe(producer, question, measured, matches),
    { initialProps: { measured: measurement(800), question: options, producer: job } });
  await waitFor(() => expect(result.current.checked).toEqual(refusal));
  rerender({ measured: measurement(650), question: options, producer: job });
  await waitFor(() => expect(worker.run).toHaveBeenCalledTimes(2));
  expect(result.current.checked).toBeUndefined();
  expect(result.current.pendingRefusal).toEqual(refusal);
  await act(async () => finish({ ok: false, refused: true, message: 'Rechecked at 650 pixels.' }));
  await waitFor(() => expect(result.current.checked).toMatchObject({ message: 'Rechecked at 650 pixels.' }));
  expect(result.current.pendingRefusal).toBeUndefined();
  worker.run.mockImplementation(() => new Promise(() => {}));
  rerender({ measured: measurement(600), question: { ...options, depth: 1 }, producer: job });
  expect(result.current.checked).toBeUndefined();
  expect(result.current.pendingRefusal).toBeUndefined();
  rerender({ measured: measurement(550), question: options, producer: { ...job } });
  expect(result.current.pendingRefusal).toBeUndefined();
});
