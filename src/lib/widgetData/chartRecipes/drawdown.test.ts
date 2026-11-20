// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { buildDrawdown } from './drawdown';
import { drawdownOptions, priceDataset } from './fixtures';

const context = { theme: 'light', maxDecimals: 2, today: '2026-02-01' } as const;
const row = (day: number, price: number | null, symbol = 'A') => ({
  date: `2026-01-${String(day).padStart(2, '0')}`, adjusted_close: price, symbol,
});

describe('buildDrawdown', () => {
  it('tracks the loaded peak from unsorted observations', () => {
    const dataset = priceDataset([row(8, 90), row(5, 100), row(7, 120), row(6, 80)]);
    const result = buildDrawdown(dataset, drawdownOptions, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.figure.data).toEqual([
      expect.objectContaining({ type: 'scatter', fill: 'toself', connectgaps: false, showlegend: false }),
      expect.objectContaining({
        type: 'scatter', name: 'A', connectgaps: false,
        x: ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'],
        text: ['0 %', '-20 %', '0 %', '-25 %'],
      }),
    ]);
    const trace = result.figure.data[1] as { y: number[] };
    expect(trace.y).toHaveLength(4);
    [0, -.2, 0, -.25].forEach((value, i) => expect(trace.y[i]).toBeCloseTo(value));
    expect(result.figure.layout.title).toEqual(expect.objectContaining({ text: 'Drawdown from peak in loaded history' }));
    expect(result.notes.join(' ')).toMatch(/2026-01-05.*2026-01-08/);
  });

  it('keeps separate peaks and gap barriers for each symbol', () => {
    const dataset = priceDataset([
      row(5, 100), row(6, null), row(7, 0), row(8, 75),
      row(5, 40, '<B>'), row(6, 10, '<B>'),
    ]);
    const result = buildDrawdown(dataset, { ...drawdownOptions, symbols: ['A', '<B>'] }, context);
    if (!result.ok) throw new Error(result.message);
    expect(result.figure.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'A', y: [0, null, null, -.25], connectgaps: false }),
      expect.objectContaining({ name: '&lt;B&gt;', y: [0, -.75] }),
    ]));
    expect(result.notes.join(' ')).toContain('2 price gap');
  });

  it('closes each filled run at zero without shading across a missing date', () => {
    const dataset = priceDataset([row(5, 100), row(6, 75), row(7, null), row(8, 87.5), row(9, 50)]);
    const result = buildDrawdown(dataset, drawdownOptions, context);
    if (!result.ok) throw new Error(result.message);
    expect(result.figure.data).toEqual([
      expect.objectContaining({
        fill: 'toself', connectgaps: false, showlegend: false, legendgroup: 'A', hoverinfo: 'skip',
        x: ['2026-01-05', '2026-01-05', '2026-01-06', '2026-01-06', null,
          '2026-01-08', '2026-01-08', '2026-01-09', '2026-01-09'],
        y: [0, 0, -.25, 0, null, 0, -.125, -.5, 0],
      }),
      expect.objectContaining({ name: 'A', legendgroup: 'A', connectgaps: false, y: [0, -.25, null, -.125, -.5] }),
    ]);
  });

  it('keeps a stable line and fill per symbol when a refresh introduces a gap', () => {
    const rows = [row(5, 100), row(6, 85), row(7, 80), row(5, 50, 'B'), row(6, 40, 'B'), row(7, 38, 'B')];
    const options = { ...drawdownOptions, symbols: ['A', 'B'] };
    const initial = buildDrawdown(priceDataset(rows), options, context);
    rows[1] = row(6, null);
    const refreshed = buildDrawdown(priceDataset(rows), options, context);
    if (!initial.ok || !refreshed.ok) throw new Error('Expected both figures to be valid');
    expect(refreshed.revision).toBe(initial.revision);
    type Trace = { uid: string; legendgroup: string; showlegend?: boolean; mode: string };
    const roles = (data: unknown[]) => (data as Trace[]).map(({ uid, legendgroup, showlegend, mode }) => ({
      uid, legendgroup, role: mode === 'none' ? 'fill' : 'line', legend: showlegend !== false,
    }));
    const before = roles(initial.figure.data);
    expect(before).toEqual([
      { uid: expect.any(String), legendgroup: 'A', role: 'fill', legend: false },
      { uid: expect.any(String), legendgroup: 'A', role: 'line', legend: true },
      { uid: expect.any(String), legendgroup: 'B', role: 'fill', legend: false },
      { uid: expect.any(String), legendgroup: 'B', role: 'line', legend: true },
    ]);
    expect(new Set(before.map(trace => trace.uid)).size).toBe(4);
    expect(roles(refreshed.figure.data)).toEqual(before);
  });

  it('names omitted selections and refuses when no selected symbol survives', () => {
    const dataset = priceDataset([row(5, 100), row(5, 90), row(5, 25, 'B'), row(5, null, 'C')]);
    const result = buildDrawdown(dataset, { ...drawdownOptions, symbols: ['A', 'B', 'C'] }, context);
    if (!result.ok) throw new Error(result.message);
    expect(result.figure.data).toEqual([
      expect.objectContaining({ legendgroup: 'B', showlegend: false }),
      expect.objectContaining({ name: 'B', y: [0] }),
    ]);
    expect(result.notes.join(' ')).toMatch(/Conflicting duplicate prices.*A/s);
    expect(result.notes.join(' ')).toMatch(/C.*no valid/i);
    expect(buildDrawdown(dataset, drawdownOptions, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/Conflicting duplicate prices.*A/s),
    });
  });

  it('shares eligibility restrictions for incomplete history', () => {
    const dataset = priceDataset([row(5, 100)]);
    dataset.completeness.kind = 'paged';
    expect(buildDrawdown(dataset, drawdownOptions, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringContaining('fully loaded'),
    });
  });

  it('keeps revision and symbol color on refresh and resets revision for a changed window or selection', () => {
    const rows = [row(5, 100), row(6, 80), row(5, 50, 'B')];
    const dataset = priceDataset(rows);
    const refreshed = { ...priceDataset([...rows, row(7, 75)]), outputRevision: 2, resultRevision: 2 };
    const result = buildDrawdown(dataset, drawdownOptions, context);
    const refresh = buildDrawdown(refreshed, drawdownOptions, { ...context, theme: 'dark', maxDecimals: 3 });
    const newWindow = buildDrawdown(priceDataset(rows, '2026-01-02'), drawdownOptions, context);
    const newSelection = buildDrawdown(dataset, { ...drawdownOptions, symbols: ['B', 'A'] }, context);
    if (!result.ok || !refresh.ok || !newWindow.ok || !newSelection.ok) throw new Error('Expected four valid figures');
    expect(refresh.revision).toBe(result.revision);
    expect(refresh.figure.layout.uirevision).toBe(result.revision);
    expect(refresh.figure.data[1]).toMatchObject({ y: [0, expect.closeTo(-.2), -.25] });
    expect(newWindow.revision).not.toBe(result.revision);
    expect(newSelection.revision).not.toBe(result.revision);
    const traces = newSelection.figure.data as { name: string; line: { color: string } }[];
    expect(traces.find(trace => trace.name === 'A')?.line.color).toBe((result.figure.data[1] as typeof traces[number]).line.color);
  });
});
