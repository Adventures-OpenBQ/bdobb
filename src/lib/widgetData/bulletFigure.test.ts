// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { buildBulletFigure, bulletRequestIds } from './bulletFigure';
import type { DatasetColumn, DatasetRow, LinkedChartSettings, WidgetDataset } from './types';

const percent = { formatterFn: 'percent' as const };
const num = (id: string, label: string, format?: DatasetColumn['format']): DatasetColumn => ({ id, label, dtype: 'number', ...(format ? { format } : {}) });
const columns: DatasetColumn[] = [
    { id: 'symbol', label: 'Symbol', dtype: 'text' }, { id: 'period_ending', label: 'Period Ending', dtype: 'text' },
    { id: 'fiscal_period', label: 'Fiscal Period', dtype: 'text' }, { id: 'report_date', label: 'Report Date', dtype: 'text' },
    num('eps_actual', 'EPS Actual'), num('eps_consensus', 'EPS Consensus'), num('eps_low', 'EPS Low'), num('eps_avg', 'EPS Avg'), num('eps_high', 'EPS High'), num('eps_analysts', 'EPS Analysts'),
    num('revenue_actual', 'Revenue Actual'), num('revenue_low', 'Revenue Low'), num('revenue_avg', 'Revenue Avg'), num('revenue_high', 'Revenue High'), num('revenue_analysts', 'Revenue Analysts'),
    num('eps_growth_avg', 'EPS Growth Avg', percent), num('eps_growth_actual', 'EPS Growth Actual', percent),
    num('revenue_growth_avg', 'Revenue Growth Avg', percent), num('revenue_growth_actual', 'Revenue Growth Actual', percent),
    { id: 'band_status', label: 'Band Status', dtype: 'text' }, { id: 'band_note', label: 'Band Note', dtype: 'text' },
];
const WITHHELD = "EODHD's estimate range for this quarter doesn't match its recorded consensus (2.91 vs 1.98); range withheld.";
const nullTrend = { eps_low: null, eps_avg: null, eps_high: null, eps_analysts: null, revenue_low: null, revenue_avg: null, revenue_high: null, revenue_analysts: null, eps_growth_avg: null, revenue_growth_avg: null };
const rows: DatasetRow[] = [
    { id: 'q2', values: { symbol: 'AAPL', period_ending: '2026-03-31', fiscal_period: 'FQ2 2026', report_date: '2026-04-30', eps_actual: 2.01, eps_consensus: 1.95, ...nullTrend, revenue_actual: 111184000000, eps_growth_actual: null, revenue_growth_actual: null, band_status: 'no_estimate', band_note: null } },
    { id: 'q3', values: { symbol: 'AAPL', period_ending: '2026-06-30', fiscal_period: 'FQ3 2026', report_date: '2026-07-30', eps_actual: 2.02, eps_consensus: 1.88, eps_low: 1.82, eps_avg: 1.8924, eps_high: 1.99, eps_analysts: 28, revenue_actual: 109417000000, revenue_low: 107516300000, revenue_avg: 108959817930, revenue_high: 112168000000, revenue_analysts: 26, eps_growth_avg: 20.54, eps_growth_actual: 28.66, revenue_growth_avg: 15.87, revenue_growth_actual: 16.36, band_status: 'ok', band_note: null } },
    { id: 'q4', values: { symbol: 'AAPL', period_ending: '2026-09-30', fiscal_period: 'FQ4 2026', report_date: '2026-10-30', eps_actual: 2.05, eps_consensus: 1.98, ...nullTrend, revenue_actual: 114477000000, eps_growth_actual: 30.57, revenue_growth_actual: 7.94, band_status: 'withheld', band_note: WITHHELD } },
];
const dataset: WidgetDataset = { rows, columns, resultRevision: 1, outputRevision: 1, provenance: { sourceWidgetId: 'source' }, completeness: { kind: 'complete', warnings: [] }, freshness: { availability: 'available', stale: false } };
const settings: LinkedChartSettings = { type: 'bullet', category: 'fiscal_period', measures: ['eps_actual', 'revenue_actual'], display: 'grouped', period: 'FQ3 2026' };

type Trace = { type: string; value: number; gauge: { shape: string; axis: { range: number[]; ticksuffix?: string }; bar: { thickness: number }; steps: { range: number[]; color: string }[]; threshold?: { value: number } } };
type Annotation = { text: string; x: number; xanchor: string; yanchor: string };
function build(s: Partial<LinkedChartSettings> = {}, d: Partial<WidgetDataset> = {}, maxDecimals = 2, theme: 'light' | 'dark' = 'light') {
    const r = buildBulletFigure({ ...dataset, ...d }, { ...settings, ...s }, theme, maxDecimals);
    if (!r.ok) throw new Error(r.message);
    return { traces: r.figure.data as Trace[], annotations: r.figure.layout.annotations as Annotation[], notes: r.notes, revision: r.revision, figure: r.figure };
}
function refusal(s: Partial<LinkedChartSettings> = {}, d: Partial<WidgetDataset> = {}) {
    const r = buildBulletFigure({ ...dataset, ...d }, { ...settings, ...s }, 'light', 2);
    if (r.ok) throw new Error('expected a refusal');
    return r;
}
const withRow = (id: string, patch: Record<string, unknown>) => ({ rows: rows.map(r => r.id === id ? { ...r, values: { ...r.values, ...patch } } : r) });

describe('buildBulletFigure', () => {
    it('one indicator per chosen metric, FQ3', () => {
        const { traces, annotations } = build();
        expect(traces).toHaveLength(2);
        for (const t of traces) expect(t).toMatchObject({ type: 'indicator', gauge: { shape: 'bullet' } });
        const eps = traces[0].gauge;
        expect(eps.steps[0]).toEqual({ range: [1.82, 1.99], color: '#c9d6ea' });
        expect(eps.steps).toHaveLength(2);
        expect((eps.steps[1].range[0] + eps.steps[1].range[1]) / 2).toBeCloseTo(1.8924, 6);
        expect(eps.steps[1].range[1] - eps.steps[1].range[0]).toBeLessThan(0.01);
        expect(eps.steps[1].color).toBe('#ffffff');
        expect(eps.threshold?.value).toBe(2.01);
        expect(traces[0].value).toBe(2.02);
        expect(annotations.map(a => [a.x, a.xanchor, a.yanchor])).toEqual([[0.72, 'left', 'middle'], [0.72, 'left', 'middle']]);
    });
    it('beat vs average', () => {
        const [eps, revenue] = build().annotations;
        expect(eps.text).toContain('2.02');
        expect(eps.text).toContain('▲ 0.13');
        expect(eps.text).toContain('#2e8b57');
        expect(revenue.text).toContain('109.42B');
        expect(revenue.text).toContain('▲ 457.18M');
    });
    it('withheld quarter, FQ4', () => {
        const { traces, annotations, notes } = build({ period: 'FQ4 2026' });
        expect(traces[0].gauge.steps).toHaveLength(1);
        const [tick] = traces[0].gauge.steps;
        expect(tick.color).toBe('#8a94a6');
        expect((tick.range[0] + tick.range[1]) / 2).toBeCloseTo(1.98, 6);
        expect(annotations[0].text).toContain('▲ 0.07<br>vs consensus');
        expect(traces[1].gauge.steps).toEqual([]);
        expect(traces[1].gauge.threshold?.value).toBeCloseTo(109.417, 6);
        expect(notes.filter(n => n === WITHHELD)).toHaveLength(1);
    });
    it('miss', () => {
        const { annotations } = build({}, withRow('q3', { eps_actual: 1.76, eps_avg: 1.88 }));
        expect(annotations[0].text).toContain('▼ 0.12');
        expect(annotations[0].text).toContain('#d1495b');
        expect(annotations[0].text).not.toContain('-');
    });
    it('negative EPS keeps its sign and a miss its magnitude', () => {
        const { traces, annotations } = build({ measures: ['eps_actual'] }, withRow('q3', { eps_actual: -0.5, eps_avg: -0.38, eps_low: -0.6, eps_high: -0.2 }));
        expect(annotations[0].text).toContain('-0.5');
        expect(annotations[0].text).toContain('▼ 0.12');
        expect(traces[0].value).toBe(-0.5);
        expect(traces[0].gauge.axis.range[0]).toBeLessThan(-0.6);
    });
    it('axis unit', () => {
        const trillion = withRow('q3', { revenue_actual: 1.2e12, revenue_low: 1.1e12, revenue_avg: 1.15e12, revenue_high: 1.25e12 });
        const { traces, annotations } = build({}, trillion);
        expect(traces[1].gauge.axis.ticksuffix).toBe('T');
        expect(traces[1].value).toBeCloseTo(1.2, 9);
        expect(traces[1].gauge.steps[0].range).toEqual([1.1, 1.25]);
        expect(annotations[1].text).toContain('1.2T');
        expect(build().traces[1].gauge.axis.ticksuffix).toBe('B');
        expect(traces[0].gauge.axis.ticksuffix ?? '').toBe('');
        const growth = build({ measures: ['eps_growth_actual'] });
        expect(growth.traces[0].gauge.axis.ticksuffix).toBe(' %');
        expect(growth.annotations[0].text).toContain('28.66 %');
        expect(growth.annotations[0].text).toContain('8.12 pts');
    });
    it('previous quarter by period_ending', () => {
        const descending = { rows: [...rows].reverse() };
        expect(build({}, descending).traces[0].gauge.threshold?.value).toBe(2.01);
        // filtered: FQ3 removed, so FQ4's reference is FQ2, never a neighbouring row
        expect(build({ period: 'FQ4 2026' }, { rows: [rows[2], rows[0]] }).traces[0].gauge.threshold?.value).toBe(2.01);
        const first = build({ period: 'FQ2 2026' });
        expect(first.traces[0].gauge.threshold).toBeUndefined();
        expect(first.notes).toContain('No previous quarter in the linked table, so no reference line.');
        const bare = { columns: columns.filter(c => c.id !== 'period_ending'), rows: rows.map(r => { const { period_ending: _, ...values } = r.values; return { ...r, values }; }) };
        const none = build({ period: 'FQ4 2026' }, bare);
        expect(none.traces[0].gauge.threshold).toBeUndefined();
        expect(none.notes).toContain('No previous quarter in the linked table, so no reference line.');
    });
    it('default period', () => {
        expect(build({ period: undefined }, { rows: [rows[1], rows[2], rows[0]] }).traces[0].value).toBe(2.05);
        const bare = { columns: columns.filter(c => c.id !== 'period_ending') };
        expect(refusal({ period: undefined }, bare)).toMatchObject({ refused: true, message: 'Choose a quarter.' });
    });
    it('refusals', () => {
        expect(refusal({}, { rows: [{ ...rows[1], groupPath: [{ field: 'symbol', value: 'AAPL' }] }] })).toMatchObject({ refused: true, message: 'Bullet needs one row per quarter — ungroup the table.' });
        expect(refusal({ period: 'FQ9 2030' })).toMatchObject({ refused: true, message: 'Quarter FQ9 2030 is not in the linked table.' });
        expect(refusal({ measures: ['eps_avg'] })).toMatchObject({ refused: true, message: 'Bullet metrics must be *_actual columns.' });
        expect(buildBulletFigure(dataset, { ...settings, measures: [] }, 'light', 2).ok).toBe(false);
        expect(buildBulletFigure(dataset, { ...settings, measures: ['missing_actual'] }, 'light', 2).ok).toBe(false);
    });
    it('not reported', () => {
        const { traces, notes, annotations } = build({}, withRow('q3', { eps_actual: null }));
        expect(traces[0].gauge.bar.thickness).toBe(0);
        expect(notes).toContain('EPS Actual: not reported');
        expect(annotations[0].text).not.toContain('▲');
        expect(traces[1].gauge.bar.thickness).toBeGreaterThan(0);
    });
    it('missing range siblings', () => {
        const d = { columns: columns.filter(c => c.id !== 'eps_low' && c.id !== 'eps_high') };
        const { traces, notes } = build({}, d);
        expect(traces[0].gauge.steps.some(s => s.color === '#c9d6ea')).toBe(false);
        expect(notes).toContain('Range columns for EPS Actual are not shown in the linked table');
        expect(notes.some(n => n.includes('Revenue Actual'))).toBe(false);
    });
    it('growth metrics never get the range note, since the provider sends no growth range', () => {
        expect(build({ measures: ['eps_growth_actual'] }).notes.some(n => n.startsWith('Range columns'))).toBe(false);
    });
    it('an average without a band is drawn as a grey tick, and the beat is measured against it', () => {
        const growth = build({ measures: ['eps_growth_actual'] });
        expect(growth.traces[0].gauge.steps).toHaveLength(1);
        const [tick] = growth.traces[0].gauge.steps;
        expect(tick.color).toBe('#8a94a6');
        expect((tick.range[0] + tick.range[1]) / 2).toBeCloseTo(20.54, 6);
        expect(growth.annotations[0].text).toContain('▲ 8.12 pts');
        expect(growth.annotations[0].text).not.toContain('vs consensus');
        const d = { columns: columns.filter(c => c.id !== 'eps_low' && c.id !== 'eps_high'), rows: rows.map(r => { const { eps_low: _l, eps_high: _h, ...values } = r.values; return { ...r, values }; }) };
        const hidden = build({ measures: ['eps_actual'] }, d);
        expect(hidden.traces[0].gauge.steps).toHaveLength(1);
        expect(hidden.traces[0].gauge.steps[0].color).toBe('#8a94a6');
        expect((hidden.traces[0].gauge.steps[0].range[0] + hidden.traces[0].gauge.steps[0].range[1]) / 2).toBeCloseTo(1.8924, 6);
        expect(hidden.annotations[0].text).toContain('▲ 0.13');
        expect(hidden.annotations[0].text).not.toContain('vs consensus');
    });
    it('maxDecimals', () => {
        const zero = build({}, {}, 0);
        expect(zero.annotations[0].text.split('<br>')[0]).toBe('2');
        expect(zero.revision).not.toBe(build({}, {}, 2).revision);
        expect(build({ period: 'FQ4 2026' }).revision).not.toBe(build().revision);
    });
    it('dark theme colours', () => {
        const { traces, figure } = build({}, {}, 2, 'dark');
        expect(traces[0].gauge.steps.map(s => s.color)).toEqual(['#3a4a63', '#1e242e']);
        expect(traces[0].gauge).toMatchObject({ bar: { color: '#dfe4ec' }, threshold: { line: { color: '#d1495b' } } });
        expect(figure.layout).toMatchObject({ paper_bgcolor: '#1e242e', font: { color: '#dfe4ec' } });
        expect(traces.map(t => (t as unknown as { domain: { x: number[] } }).domain.x)).toEqual([[0.24, 0.7], [0.24, 0.7]]);
        expect(traces.map(t => (t as unknown as { title: unknown }).title)).toEqual([{ text: 'EPS', font: { size: 12 } }, { text: 'Revenue', font: { size: 12 } }]);
    });
});

describe('bulletRequestIds', () => {
    it('returns only presented siblings', () => {
        const presented = new Set(['fiscal_period', 'eps_actual', 'eps_low', 'eps_avg', 'eps_consensus', 'revenue_actual', 'revenue_high', 'band_note', 'symbol']);
        expect(bulletRequestIds(['eps_actual', 'revenue_actual'], presented)).toEqual(['eps_low', 'eps_avg', 'eps_consensus', 'revenue_high', 'band_note']);
        expect(bulletRequestIds(['eps_actual'], new Set(columns.map(c => c.id)))).toEqual(['eps_low', 'eps_avg', 'eps_high', 'eps_consensus', 'period_ending', 'band_note']);
    });
});
