// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LinkedChartRecipeControls, recipeAvailability } from './LinkedChartRecipeControls';
import type { DatasetColumn } from '../../lib/widgetData/types';
const columns = ['date', 'adjusted_close', 'symbol', 'close'].map(id => ({ id, label: id }));
const loadSymbols = vi.fn(async () => ['A', 'B']);
afterEach(cleanup);
it('requires a selected monthly symbol and saves explicit price/date bindings', async () => {
  const save = vi.fn();
  render(<LinkedChartRecipeControls kind="monthly-returns" columns={columns} loadSymbols={loadSymbols} disabled={false} onApply={save}/>);
  await screen.findByRole('option', { name: 'B' });
  expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled();
  expect(screen.queryByRole('option', { name: 'close' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'B' } });
  fireEvent.click(screen.getByRole('button', { name: /apply/i }));
  expect(save).toHaveBeenCalledWith({ version: 1, kind: 'monthly-returns', fields: { date: 'date', price: 'adjusted_close', symbol: 'symbol' }, symbol: 'B' });
});
it('defaults correlation to 252/60 and requires valid overlap and an explicit selection', async () => {
  const save = vi.fn();
  render(<LinkedChartRecipeControls kind="correlation" columns={columns} loadSymbols={loadSymbols} disabled={false} onApply={save}/>);
  fireEvent.click(await screen.findByLabelText('B'));
  expect(screen.getByLabelText('Lookback')).toHaveValue(252);
  expect(screen.getByLabelText('Minimum overlap')).toHaveValue(60);
  fireEvent.change(screen.getByLabelText('Minimum overlap'), { target: { value: '253' } });
  expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Minimum overlap'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: /apply/i }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ symbols: ['B'], lookback: 252, minOverlap: 4 }));
});
it('accepts a renamed guarded provider role and refuses a mislabeled underlying field or aggregated inputs', () => {
  const estimate: DatasetColumn[] = ['period_ending', 'band_status', 'eps_low', 'eps_avg', 'eps_high'].map((sourceFieldId, i) => ({ id: String(i), sourceFieldId, label: sourceFieldId }));
  expect(recipeAvailability('estimate-range', estimate)).toBeNull();
  expect(recipeAvailability('estimate-range', estimate.map(c => c.sourceFieldId === 'eps_avg' ? { ...c, id: 'eps_avg', sourceFieldId: 'volume' } : c))).toMatch(/average/i);
  expect(recipeAvailability('drawdown', columns.map(c => ({ ...c, measureId: 'aggregate' })))).toMatch(/adjusted|raw/i);
});

it('accepts an explicitly identified custom numeric adjusted-price field without silently choosing it', async () => {
  const custom: DatasetColumn[] = [...columns.filter(c => c.id !== 'adjusted_close'), { id: 'px', dtype: 'number', label: 'Provider price' }];
  expect(recipeAvailability('monthly-returns', custom)).toBeNull();
  const save = vi.fn();
  render(<LinkedChartRecipeControls kind="monthly-returns" columns={custom} loadSymbols={loadSymbols} disabled={false} onApply={save}/>);
  expect(screen.getByLabelText('Adjusted price')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Adjusted price'), { target: { value: 'px' } });
  await screen.findByRole('option', { name: 'B' });
  fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'B' } });
  fireEvent.click(screen.getByRole('button', { name: /apply/i }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ fields: { date: 'date', symbol: 'symbol', price: 'px' } }));
});

it('requires one distribution symbol and accepts integer bins from 5 through 100', async () => {
  const save = vi.fn();
  render(<LinkedChartRecipeControls kind="return-distribution" columns={columns} loadSymbols={loadSymbols} disabled={false} onApply={save}/>);
  const bins = screen.getByRole('spinbutton', { name: 'Bins' });
  expect(bins).toHaveValue(30);
  await screen.findByRole('option', { name: 'B' });
  const apply = screen.getByRole('button', { name: /apply/i });
  expect(apply).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'B' } });
  for (const value of [4, 5.5, 101, 5, 100]) {
    fireEvent.change(bins, { target: { value: String(value) } });
    if ([5, 100].includes(value)) {
      fireEvent.click(apply);
      expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ symbol: 'B', bins: value }));
    } else expect(apply).toBeDisabled();
  }
});

it('saves 1–12 small-multiple symbols in selection order', async () => {
  const values = Array.from({ length: 13 }, (_, i) => 'S' + i);
  const save = vi.fn();
  render(<LinkedChartRecipeControls kind="small-multiples" columns={columns} loadSymbols={async () => values} disabled={false} onApply={save}/>);
  const apply = screen.getByRole('button', { name: /apply/i });
  expect(apply).toBeDisabled();
  const reversed = [...values].reverse();
  for (const symbol of reversed) fireEvent.click(await screen.findByLabelText(symbol));
  expect(apply).toBeDisabled();
  fireEvent.click(screen.getByLabelText('S0'));
  fireEvent.click(apply);
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ symbols: reversed.slice(0, 12) }));
});

it('offers exposure modes and saves only presented bindings and mode', () => {
  const save = vi.fn();
  const load = vi.fn();
  render(<LinkedChartRecipeControls kind="etf-exposure" columns={['country', 'weight'].map(id => ({ id, label: id }))}
    loadSymbols={load} disabled={false} onApply={save}/>);
  expect(screen.getByLabelText('Exposure mode')).toHaveValue('region');
  fireEvent.click(screen.getByRole('button', { name: /apply/i }));
  expect(save).toHaveBeenCalledWith({ version: 1, kind: 'etf-exposure', mode: 'region', fields: { category: 'country', weight: 'weight' } });
  expect(load).not.toHaveBeenCalled();
  expect(screen.queryByLabelText(/weight basis|fund symbol/i)).toBeNull();
});

it('keeps an unavailable imported Pareto holding field visible for repair', () => {
  const save = vi.fn();
  render(<LinkedChartRecipeControls kind="etf-pareto" columns={['ticker', 'weight'].map(id => ({ id, label: id }))}
    saved={{ version: 1, kind: 'etf-pareto', fields: { holding: 'old', weight: 'weight' } }}
    loadSymbols={loadSymbols} disabled={false} onApply={save}/>);
  expect(screen.getByRole('group', { name: 'ETF holdings Pareto settings' })).toBeVisible();
  expect(screen.getByRole('option', { name: 'old (unavailable)' })).toBeVisible();
  const apply = screen.getByRole('button', { name: /apply/i });
  expect(apply).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Holding', { exact: true }), { target: { value: 'ticker' } });
  fireEvent.click(apply);
  expect(save).toHaveBeenCalledWith({ version: 1, kind: 'etf-pareto', fields: { holding: 'ticker', weight: 'weight' } });
});

it('offers only the category dimension for the selected exposure mode', () => {
  const columns = ['sector', 'country', 'weight'].map(sourceFieldId => ({ id: 'alias-' + sourceFieldId, sourceFieldId, label: sourceFieldId }));
  const save = vi.fn();
  render(<LinkedChartRecipeControls kind="etf-exposure" columns={columns} loadSymbols={loadSymbols} disabled={false} onApply={save}/>);
  expect(screen.queryByRole('option', { name: 'country' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Exposure mode'), { target: { value: 'region' } });
  expect((screen.getByLabelText('Exposure category') as HTMLSelectElement).options).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: /apply/i }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ mode: 'region', fields: { category: 'alias-country', weight: 'alias-weight' } }));
});
