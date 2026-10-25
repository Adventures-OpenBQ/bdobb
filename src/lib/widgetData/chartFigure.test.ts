// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { buildLinkedFigure } from './chartFigure';
import type { WidgetDataset, LinkedChartSettings } from './types';
const settings: LinkedChartSettings = { type: 'column', category: 'label', measures: ['a', 'b'], display: 'grouped' };
const dataset: WidgetDataset = { rows: [{ id: 'r1', values: { label: 'Same', a: 10, b: null }, groupPath: [{ field: 'region', value: 'US' }] }, { id: 'r2', values: { label: 'Same', a: 20, b: 30 } }], columns: [{ id: 'label', label: 'Label', dtype: 'text' }, { id: 'a', label: 'Revenue', dtype: 'number', aggregation: 'sum' }, { id: 'b', label: 'Cost', dtype: 'number' }], resultRevision: 1, outputRevision: 1, provenance: { sourceWidgetId: 'source' }, completeness: { kind: 'complete', warnings: [] }, freshness: { availability: 'available', stale: false } };
function figure(s = settings, d = dataset) { const r = buildLinkedFigure(d, s, 'dark'); if (!r.ok)
    throw new Error(r.message); return r.figure; }
it('uses two ordered traces and distinct row positions for repeated labels with null gaps and full hover paths', () => {
    const f = figure();
    expect(f.data).toHaveLength(2);
    expect(f.data[0]).toMatchObject({ type: 'bar', x: ['r1', 'r2'], y: [10, 20] });
    expect(f.data[1]).toMatchObject({ y: [null, 30] });
    expect(f.layout.xaxis).toMatchObject({ tickvals: ['r1', 'r2'], ticktext: ['Same', 'Same'] });
    expect((f.data[0] as {
        text: string[];
    }).text[0]).toContain('region: US');
    expect((f.data[0] as {
        text: string[];
    }).text[0]).toContain('sum');
});
it('maps grouped/stacked columns horizontal bars and scatter lines', () => {
    expect(figure().layout.barmode).toBe('group');
    expect(figure({ ...settings, display: 'stacked' }).layout.barmode).toBe('stack');
    expect(figure({ ...settings, type: 'bar' }).data[0]).toMatchObject({ orientation: 'h', x: [10, 20], y: ['r1', 'r2'] });
    expect(figure({ ...settings, type: 'line' }).data[0]).toMatchObject({ type: 'scatter', mode: 'lines+markers', connectgaps: false });
});
it('retains mapping errors rather than inferring missing or nonnumeric measures', () => {
    for (const measures of [[], ['missing'], ['label']])
        expect(buildLinkedFigure(dataset, { ...settings, measures }, 'dark').ok).toBe(false);
    expect(buildLinkedFigure(dataset, { ...settings, category: 'missing' }, 'dark').ok).toBe(false);
    for (const value of [Infinity, NaN, '10'])
        expect(buildLinkedFigure({ ...dataset, rows: [{ id: 'r1', values: { label: 'x', a: value } }] }, { ...settings, measures: ['a'] }, 'dark').ok).toBe(false);
});
it('converts safe bigint counts only with count aggregation proof', () => {
    const d = { ...dataset, rows: [{ id: 'r1', values: { label: 'x', a: 3n } }] };
    expect(buildLinkedFigure(d, { ...settings, measures: ['a'] }, 'dark').ok).toBe(false);
    const proven = { ...d, columns: d.columns.map(c => c.id === 'a' ? { ...c, aggregation: 'count' as const } : c) };
    expect(figure({ ...settings, measures: ['a'] }, proven).data[0]).toMatchObject({ y: [3] });
    expect(buildLinkedFigure({ ...proven, rows: [{ id: 'r1', values: { a: 9007199254740992n } }] }, { ...settings, measures: ['a'] }, 'dark').ok).toBe(false);
});
it('keeps measure colors and uirevision across refresh/theme/reordering but changes mapping revision', () => {
    const f = figure();
    const refresh = buildLinkedFigure({ ...dataset, outputRevision: 9 }, settings, 'light');
    expect(refresh.ok).toBe(true);
    if (refresh.ok)
        expect(refresh.figure.layout.uirevision).toBe(f.layout.uirevision);
    const reordered = figure({ ...settings, measures: ['b', 'a'] });
    expect((reordered.data[1] as {
        marker: unknown;
    }).marker).toEqual((f.data[0] as {
        marker: unknown;
    }).marker);
    expect(figure({ ...settings, type: 'line' }).layout.uirevision).not.toBe(f.layout.uirevision);
});

it('labels split series with company identity and keeps that color across financial measures', () => {
    const split = (id: string, label: string, company: string) => ({ id, label, dtype: 'number' as const, splitPath: [{ field: 'Symbol', value: company }] });
    const source = { ...dataset, columns: [dataset.columns[0], split('amd-revenue', 'Revenue', 'AMD'), split('avgo-revenue', 'Revenue', 'AVGO'), split('amd-income', 'Operating income', 'AMD')], rows: [{ id: '2024', values: { label: '2024', 'amd-revenue': 100, 'avgo-revenue': 200, 'amd-income': 25 } }] };
    const revenue = figure({ ...settings, measures: ['amd-revenue', 'avgo-revenue'] }, source);
    const income = figure({ ...settings, measures: ['amd-income'] }, source);
    expect(revenue.data[0]).toMatchObject({ name: 'AMD — Revenue', y: [100] });
    expect(revenue.data[1]).toMatchObject({ name: 'AVGO — Revenue', y: [200] });
    expect(income.data[0]).toMatchObject({ name: 'AMD — Operating income', y: [25] });
    expect((income.data[0] as { marker: unknown }).marker).toEqual((revenue.data[0] as { marker: unknown }).marker);
    expect((revenue.data[0] as { marker: unknown }).marker).not.toEqual((revenue.data[1] as { marker: unknown }).marker);
});

it('renders a valid bigint split member when the producer omits its optional member key', () => {
    const source = { ...dataset, columns: [dataset.columns[0], { id: 'sales', label: 'Revenue', dtype: 'number' as const, splitPath: [{ field: 'company', value: 1n }] }], rows: [{ id: '2024', values: { label: '2024', sales: 100 } }] };
    expect(figure({ ...settings, measures: ['sales'] }, source).data[0]).toMatchObject({ name: '1 — Revenue', y: [100] });
});

it('places a horizontal company legend below the plot with room for fiscal-year labels', () => {
    const layout = figure().layout;
    expect(layout.legend).toMatchObject({ orientation: 'h', x: 0.5, xanchor: 'center', y: -0.3, yanchor: 'top' });
    expect((layout.margin as {b:number}).b).toBeGreaterThanOrEqual(80);
});

it('keeps multiline financial details in hover rather than printing them inside bars', () => {
    expect(figure().data[0]).toMatchObject({ textposition: 'none', hovertemplate: '%{text}<extra></extra>' });
});
