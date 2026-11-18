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

// Pinned on pre-Rows code: existing cards must keep byte-identical figures.
const pin = (s: LinkedChartSettings) => JSON.stringify(figure(s));
it('existing grouped column cards give byte-identical figures', () => {
    expect(pin(settings)).toMatchInlineSnapshot(`"{"data":[{"type":"bar","name":"Revenue","x":["r1","r2"],"y":[10,20],"orientation":"v","textposition":"none","marker":{"color":"#ef8354"},"text":["Same<br>region: US<br>Revenue (sum): 10","Same<br>Revenue (sum): 20"],"hovertemplate":"%{text}<extra></extra>"},{"type":"bar","name":"Cost","x":["r1","r2"],"y":[null,30],"orientation":"v","textposition":"none","marker":{"color":"#71c7a1"},"text":["Same<br>region: US<br>Cost: Missing","Same<br>Cost: 30"],"hovertemplate":"%{text}<extra></extra>"}],"layout":{"uirevision":"[\\"column\\",\\"label\\",[\\"a\\",\\"b\\"],\\"grouped\\"]","margin":{"l":48,"r":12,"t":12,"b":80},"barmode":"group","xaxis":{"type":"category","categoryorder":"array","categoryarray":["r1","r2"],"tickmode":"array","tickvals":["r1","r2"],"ticktext":["Same","Same"]},"showlegend":true,"legend":{"orientation":"h","x":0.5,"xanchor":"center","y":-0.3,"yanchor":"top"},"paper_bgcolor":"#1e242e","plot_bgcolor":"#1e242e","font":{"color":"#dfe4ec"}}}"`);
});
it('existing stacked bar cards give byte-identical figures', () => {
    expect(pin({ ...settings, type: 'bar', display: 'stacked' })).toMatchInlineSnapshot(`"{"data":[{"type":"bar","name":"Revenue","x":[10,20],"y":["r1","r2"],"orientation":"h","textposition":"none","marker":{"color":"#ef8354"},"text":["Same<br>region: US<br>Revenue (sum): 10","Same<br>Revenue (sum): 20"],"hovertemplate":"%{text}<extra></extra>"},{"type":"bar","name":"Cost","x":[null,30],"y":["r1","r2"],"orientation":"h","textposition":"none","marker":{"color":"#71c7a1"},"text":["Same<br>region: US<br>Cost: Missing","Same<br>Cost: 30"],"hovertemplate":"%{text}<extra></extra>"}],"layout":{"uirevision":"[\\"bar\\",\\"label\\",[\\"a\\",\\"b\\"],\\"stacked\\"]","margin":{"l":48,"r":12,"t":12,"b":80},"barmode":"stack","yaxis":{"type":"category","categoryorder":"array","categoryarray":["r1","r2"],"tickmode":"array","tickvals":["r1","r2"],"ticktext":["Same","Same"]},"showlegend":true,"legend":{"orientation":"h","x":0.5,"xanchor":"center","y":-0.3,"yanchor":"top"},"paper_bgcolor":"#1e242e","plot_bgcolor":"#1e242e","font":{"color":"#dfe4ec"}}}"`);
});
it('existing line cards give byte-identical figures', () => {
    expect(pin({ ...settings, type: 'line' })).toMatchInlineSnapshot(`"{"data":[{"type":"scatter","name":"Revenue","x":["r1","r2"],"y":[10,20],"mode":"lines+markers","connectgaps":false,"line":{"color":"#ef8354"},"marker":{"color":"#ef8354"},"text":["Same<br>region: US<br>Revenue (sum): 10","Same<br>Revenue (sum): 20"],"hovertemplate":"%{text}<extra></extra>"},{"type":"scatter","name":"Cost","x":["r1","r2"],"y":[null,30],"mode":"lines+markers","connectgaps":false,"line":{"color":"#71c7a1"},"marker":{"color":"#71c7a1"},"text":["Same<br>region: US<br>Cost: Missing","Same<br>Cost: 30"],"hovertemplate":"%{text}<extra></extra>"}],"layout":{"uirevision":"[\\"line\\",\\"label\\",[\\"a\\",\\"b\\"],\\"grouped\\"]","margin":{"l":48,"r":12,"t":12,"b":80},"barmode":"group","xaxis":{"type":"category","categoryorder":"array","categoryarray":["r1","r2"],"tickmode":"array","tickvals":["r1","r2"],"ticktext":["Same","Same"]},"showlegend":true,"legend":{"orientation":"h","x":0.5,"xanchor":"center","y":-0.3,"yanchor":"top"},"paper_bgcolor":"#1e242e","plot_bgcolor":"#1e242e","font":{"color":"#dfe4ec"}}}"`);
});
it('existing explicit columns cards give byte-identical figures', () => {
    expect(pin({ ...settings, seriesFrom: 'columns' })).toMatchInlineSnapshot(`"{"data":[{"type":"bar","name":"Revenue","x":["r1","r2"],"y":[10,20],"orientation":"v","textposition":"none","marker":{"color":"#ef8354"},"text":["Same<br>region: US<br>Revenue (sum): 10","Same<br>Revenue (sum): 20"],"hovertemplate":"%{text}<extra></extra>"},{"type":"bar","name":"Cost","x":["r1","r2"],"y":[null,30],"orientation":"v","textposition":"none","marker":{"color":"#71c7a1"},"text":["Same<br>region: US<br>Cost: Missing","Same<br>Cost: 30"],"hovertemplate":"%{text}<extra></extra>"}],"layout":{"uirevision":"[\\"column\\",\\"label\\",[\\"a\\",\\"b\\"],\\"grouped\\"]","margin":{"l":48,"r":12,"t":12,"b":80},"barmode":"group","xaxis":{"type":"category","categoryorder":"array","categoryarray":["r1","r2"],"tickmode":"array","tickvals":["r1","r2"],"ticktext":["Same","Same"]},"showlegend":true,"legend":{"orientation":"h","x":0.5,"xanchor":"center","y":-0.3,"yanchor":"top"},"paper_bgcolor":"#1e242e","plot_bgcolor":"#1e242e","font":{"color":"#dfe4ec"}}}"`);
});

const years: WidgetDataset = { ...dataset,
  columns: [{ id: 'item', label: 'Item', dtype: 'text' }, { id: 'fy24', label: 'FY2024', dtype: 'number' }, { id: 'fy25', label: 'FY2025', dtype: 'number' }],
  rows: [{ id: 'cash', values: { item: 'cash', fy24: 10, fy25: 30 } }, { id: 'inv', values: { item: 'inventory', fy24: 30, fy25: 10 } }] };
const rows: LinkedChartSettings = { type: 'column', category: 'item', measures: ['fy24', 'fy25'], display: 'grouped', seriesFrom: 'rows' };

it('rows mode builds one trace per row with the measure columns as x', () => {
  const f = figure(rows, years);
  expect(f.data).toHaveLength(2);
  expect(f.data[0]).toMatchObject({ type: 'bar', name: 'cash', x: ['fy24', 'fy25'], y: [10, 30] });
  expect(f.layout.xaxis).toMatchObject({ tickvals: ['fy24', 'fy25'], ticktext: ['FY2024', 'FY2025'] });
  const text = (f.data[0] as { text: string[] }).text[1];
  expect(text).toContain('cash'); expect(text).toContain('FY2025'); expect(text).toContain('30');
  expect(figure({ ...rows, type: 'bar' }, years).data[0]).toMatchObject({ orientation: 'h', x: [10, 30], y: ['fy24', 'fy25'] });
  expect(figure({ ...rows, type: 'line' }, years).data[0]).toMatchObject({ type: 'scatter', x: ['fy24', 'fy25'] });
});
it('rows mode labels a split measure position with its split path', () => {
  const split = { ...years, columns: [years.columns[0], { ...years.columns[1], splitPath: [{ field: 'Symbol', value: 'AMD' }] }] };
  expect(figure({ ...rows, measures: ['fy24'] }, split).layout.xaxis).toMatchObject({ ticktext: ['AMD — FY2024'] });
});
it('rows mode keeps duplicate category values as separate, disambiguated series', () => {
  const d = { ...years, rows: [
    { id: 'a', values: { item: 'Revenue', fy24: 1 }, groupPath: [{ field: 'Segment', value: 'cloud', label: 'Cloud' }] },
    { id: 'b', values: { item: 'Revenue', fy24: 2 }, groupPath: [{ field: 'Segment', value: 'devices', label: 'Devices' }] },
    { id: 'c', values: { item: 'Cost', fy24: 3 } }, { id: 'd', values: { item: 'Cost', fy24: 4 } }] };
  const f = figure({ ...rows, measures: ['fy24'] }, d);
  expect(f.data.map(t => (t as { name: string }).name)).toEqual(['Revenue — Segment: Cloud', 'Revenue — Segment: Devices', 'Cost', 'Cost (2)']);
  expect((f.data[2] as { marker: unknown }).marker).toEqual((f.data[3] as { marker: unknown }).marker);
});
it('an item keeps its colour by identity, whatever the row order or measure set', () => {
  const a = figure(rows, years), b = figure({ ...rows, measures: ['fy25'] }, { ...years, rows: [...years.rows].reverse() });
  expect((b.data[1] as { marker: unknown }).marker).toEqual((a.data[0] as { marker: unknown }).marker);
});
it('rows mode changes the revision; columns mode keeps it', () => {
  expect(figure(rows, years).layout.uirevision).not.toBe(figure({ ...rows, seriesFrom: undefined }, years).layout.uirevision);
  expect(figure({ ...settings, seriesFrom: 'columns' }).layout.uirevision).toBe(figure().layout.uirevision);
});
it('success carries an empty notes list for plain charts', () => {
  const r = buildLinkedFigure(dataset, settings, 'dark');
  expect(r.ok && r.notes).toEqual([]);
});

const refused = (s: LinkedChartSettings, d: WidgetDataset) => { const r = buildLinkedFigure(d, s, 'dark'); expect(r).toMatchObject({ ok: false, refused: true }); return (r as { message: string }).message; };
const withRows = (vals: [string, number | null, number | null][]) => ({ ...years, rows: vals.map(([item, fy24, fy25], i) => ({ id: `r${i}`, values: { item, fy24, fy25 } })) });

it('percent sets barnorm, a percent axis and the share in the hover', () => {
  const f = figure({ ...rows, display: 'percent' }, years);
  expect(f.layout).toMatchObject({ barmode: 'stack', barnorm: 'percent', yaxis: { ticksuffix: '%' } });
  expect((f.data[0] as { text: string[] }).text[0]).toMatch(/10[\s\S]*25\.0%/); // cash FY2024: 10 of 40
  expect(figure({ ...settings, type: 'bar', display: 'percent' }).layout).toMatchObject({ barnorm: 'percent', xaxis: { ticksuffix: '%' } });
});
it('pie builds one pie trace over the rows of one measure and refuses more than one', () => {
  const f = figure({ type: 'pie', category: 'item', measures: ['fy25'], display: 'grouped' }, years);
  expect(f.data).toEqual([expect.objectContaining({ type: 'pie', labels: ['cash', 'inventory'], values: [30, 10], sort: false, textinfo: 'percent' })]);
  expect(refused({ type: 'pie', category: 'item', measures: ['fy24', 'fy25'], display: 'grouped' }, years)).toBe('Pie shows one measure — choose one');
  // Plotly merges equal pie labels, so duplicates must already be unique
  expect(figure({ type: 'pie', category: 'item', measures: ['fy24'], display: 'grouped' }, withRows([['Cost', 1, 1], ['Cost', 2, 2]])).data[0]).toMatchObject({ labels: ['Cost', 'Cost (2)'], values: [1, 2] });
});
it('a pie slice has the colour of the same row in a rows chart', () => {
  const pie = figure({ type: 'pie', category: 'item', measures: ['fy25'], display: 'grouped' }, years);
  expect((pie.data[0] as { marker: { colors: string[] } }).marker.colors[0]).toEqual((figure(rows, years).data[0] as { marker: { color: string } }).marker.color);
});
it('pie and percent refuse negative values, listing at most five', () => {
  expect(refused({ ...rows, display: 'percent' }, withRows([['cash', 10, 5], ['treasury_stock', 2, -4]]))).toBe("Can't show shares of negative values: treasury_stock (FY2025).");
  const many = withRows(Array.from({ length: 7 }, (_, i) => [`neg${i}`, -1, 1] as [string, number, number]));
  expect(refused({ type: 'pie', category: 'item', measures: ['fy24'], display: 'grouped' }, many)).toBe("Can't show shares of negative values: neg0 (FY2024), neg1 (FY2024), neg2 (FY2024), neg3 (FY2024), neg4 (FY2024), and 2 more.");
});
it('pie and percent refuse a zero total, naming the year or measure', () => {
  expect(refused({ ...rows, display: 'percent' }, withRows([['cash', 0, 5], ['inventory', 0, 5]]))).toBe("Can't show shares of a zero total: FY2024.");
  expect(refused({ type: 'pie', category: 'item', measures: ['fy24'], display: 'grouped' }, withRows([['cash', 0, 1]]))).toBe("Can't show shares of a zero total: FY2024.");
});
it('missing values are left out and listed, and the chart still draws', () => {
  const r = buildLinkedFigure(withRows([['cash', 10, 5], ['inventory', null, 5]]), { ...rows, display: 'percent' }, 'dark');
  expect(r).toMatchObject({ ok: true, notes: ['Missing: inventory (FY2024)'] });
  const pie = buildLinkedFigure(withRows([['cash', 10, 5], ['inventory', null, 5]]), { type: 'pie', category: 'item', measures: ['fy24'], display: 'grouped' }, 'dark');
  expect(pie).toMatchObject({ ok: true, notes: ['Missing: inventory (FY2024)'], figure: { data: [{ labels: ['cash'], values: [10] }] } });
});
it('an all-missing stack is listed as missing, not refused as a zero total', () => {
  expect(buildLinkedFigure(withRows([['cash', null, 5], ['inventory', null, 5]]), { ...rows, display: 'percent' }, 'dark')).toMatchObject({ ok: true, notes: ['Missing: cash (FY2024), inventory (FY2024)'] });
});
it('grouped, stacked and line charts keep negatives and give no notes', () => {
  const d = withRows([['cash', 10, null], ['treasury_stock', -4, 1]]);
  for (const display of ['grouped', 'stacked'] as const) expect(buildLinkedFigure(d, { ...rows, display }, 'dark')).toMatchObject({ ok: true, notes: [] });
});
it('leftover fields from another type still draw', () => {
  const line = figure({ ...rows, type: 'line', display: 'percent' }, withRows([['cash', -1, 2]]));
  expect(line.data[0]).toMatchObject({ type: 'scatter' }); expect(line.layout).not.toHaveProperty('barnorm');
  const pie = figure({ type: 'pie', category: 'item', measures: ['fy25'], display: 'percent', seriesFrom: 'rows' }, years);
  expect(pie.data[0]).toMatchObject({ type: 'pie', labels: ['cash', 'inventory'] });
});

const agg = (vals: [string, number][]): WidgetDataset => ({ ...dataset, columns: [{ id: 'item', label: 'Item', dtype: 'text' }, { id: 'a', label: 'Revenue', dtype: 'number', aggregation: 'sum' }], rows: vals.map(([item, a], i) => ({ id: `r${i}`, values: { item, a } })) });
it('rows and pie hover carry the measure aggregation, like columns hover', () => {
  const d = agg([['cash', 1], ['inventory', 2]]);
  const text = (f: ReturnType<typeof figure>) => (f.data[0] as { text: string[] }).text[0];
  expect(text(figure({ type: 'column', category: 'item', measures: ['a'], display: 'grouped', seriesFrom: 'rows' }, d))).toContain('Revenue (sum): 1');
  expect(text(figure({ type: 'pie', category: 'item', measures: ['a'], display: 'grouped' }, d))).toContain('Revenue (sum): 1');
});
it('a real label equal to a generated suffix still gets a unique pie name', () => {
  const d = agg([['Revenue', 1], ['Revenue', 2], ['Revenue (2)', 3]]);
  const labels = (figure({ type: 'pie', category: 'item', measures: ['a'], display: 'grouped' }, d).data[0] as { labels: string[] }).labels;
  expect(new Set(labels).size).toBe(3);
  expect(labels.slice(0, 2)).toEqual(['Revenue', 'Revenue (2)']);
});

// The CFTC FX implied-vol table: a row per strike, a vol column per expiry, pair and date on every row.
const volColumns = [{ id: 'strike', label: 'Strike', dtype: 'number' as const }, { id: 'vol_1m', label: '1M', dtype: 'number' as const }, { id: 'vol_3m', label: '3M', dtype: 'number' as const }, { id: 'pair', label: 'Pair', dtype: 'text' as const }, { id: 'date', label: 'Date', dtype: 'text' as const }];
const volRow = (id: string, pair: string, strike: number, m1: number | null, m3: number) => ({ id, values: { strike, vol_1m: m1, vol_3m: m3, pair, date: '2026-11-17' } });
const vol: WidgetDataset = { ...dataset, columns: volColumns, rows: [volRow('r1', 'EURUSD', 1.05, 7.1, 7.4), volRow('r2', 'EURUSD', 1.1, null, 7.0), volRow('r3', 'USDJPY', 150, 9.2, 9.5), volRow('r4', 'USDJPY', 155, 8.8, 9.1)] };
const surface: LinkedChartSettings = { type: 'surface', category: 'strike', measures: ['vol_1m', 'vol_3m'], display: 'grouped' };
it('draws one surface per pair/date: x strike, y expiry, z vol, each in its own titled scene on a shared colour scale', () => {
    const f = figure(surface, vol);
    expect(f.data).toEqual([
        expect.objectContaining({ type: 'surface', scene: 'scene', coloraxis: 'coloraxis', x: [1.05, 1.1], y: [0, 1], z: [[7.1, null], [7.4, 7.0]], text: [['Strike: 1.05<br>1M: 7.1', 'Strike: 1.1<br>1M: Missing'], ['Strike: 1.05<br>3M: 7.4', 'Strike: 1.1<br>3M: 7']] }),
        expect.objectContaining({ type: 'surface', scene: 'scene2', x: [150, 155], z: [[9.2, 8.8], [9.5, 9.1]] }),
    ]);
    expect(f.layout.scene).toMatchObject({ domain: { x: [0, 0.5] }, yaxis: { tickvals: [0, 1], ticktext: ['1M', '3M'] } });
    expect(f.layout.scene2).toMatchObject({ domain: { x: [0.5, 1] } });
    expect((f.layout.annotations as { text: string }[]).map(a => a.text)).toEqual(['EURUSD — 2026-11-17', 'USDJPY — 2026-11-17']);
});
it('draws a single untitled surface when the rows carry no pair or date', () => {
    const bare = { ...vol, columns: volColumns.slice(0, 3), rows: vol.rows.slice(0, 2) };
    const f = figure(surface, bare);
    expect(f.data).toHaveLength(1);
    expect(f.layout.annotations).toEqual([]);
    const text = { ...bare, columns: [{ id: 'strike', label: 'Strike', dtype: 'text' as const }, ...volColumns.slice(1, 3)], rows: bare.rows.map((r, i) => ({ ...r, values: { ...r.values, strike: ['25D put', 'ATM'][i] } })) };
    const t = figure(surface, text);
    expect(t.data[0]).toMatchObject({ x: [0, 1] });
    expect(t.layout.scene).toMatchObject({ xaxis: { tickvals: [0, 1], ticktext: ['25D put', 'ATM'] } });
});
it('refuses a surface it cannot mesh or that would split into too many plots', () => {
    const thin = { ...vol, rows: vol.rows.slice(0, 3) };
    expect(buildLinkedFigure(thin, surface, 'dark')).toMatchObject({ ok: false, refused: true, message: 'Surface needs at least two rows per plot.' });
    const many = { ...vol, rows: Array.from({ length: 14 }, (_, i) => volRow(`r${i}`, `P${i >> 1}`, i, 1, 2)) };
    expect(buildLinkedFigure(many, surface, 'dark')).toMatchObject({ ok: false, refused: true, message: 'Surface draws at most 6 plots — the rows hold 7 pair/date combinations.' });
});
it('draws a Surface with one measure ticked as a line per pair/date, not a surface', () => {
    const f = figure({ ...surface, measures: ['vol_3m'] }, vol);
    expect(f.data).toEqual([
        expect.objectContaining({ type: 'scatter', mode: 'lines+markers', xaxis: 'x', yaxis: 'y', x: [1.05, 1.1], y: [7.4, 7.0] }),
        expect.objectContaining({ type: 'scatter', xaxis: 'x2', yaxis: 'y2', x: [150, 155], y: [9.5, 9.1] }),
    ]);
    expect(f.layout.xaxis).toMatchObject({ anchor: 'y', title: { text: 'Strike' } });
    expect(f.layout.yaxis).toMatchObject({ title: { text: '3M' } });
    expect((f.layout.annotations as { text: string }[]).map(a => a.text)).toEqual(['EURUSD — 2026-11-17', 'USDJPY — 2026-11-17']);
    expect(f.layout.scene).toBeUndefined();
});
it('runs the surface measure axis in source column order, whatever order the measures were ticked in', () => {
    const f = figure({ ...surface, measures: ['vol_3m', 'vol_1m'] }, vol);
    expect(f.layout.scene).toMatchObject({ yaxis: { ticktext: ['1M', '3M'] } });
    expect(f.data[0]).toMatchObject({ z: [[7.1, null], [7.4, 7.0]] });
});
