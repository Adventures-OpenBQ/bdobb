// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { pivotValueKey } from '../pivotKeys';
import { LABEL_FIELD } from '../pivotTable';
import type { PlotlyFigure } from '../chartShapes';
import type { DatasetColumn, DatasetGroupMember, WidgetDataset, LinkedChartSettings } from './types';
import { buildWaterfall } from './waterfallFigure';
const COLORS = ['#4c9aff', '#ef8354', '#71c7a1', '#b08cde', '#e4c65a', '#65c6d4'];
export function color(id: string) { let hash = 0; for (const c of id)
    hash = (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0; return COLORS[hash % COLORS.length]; }
export function escape(value: unknown) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
export type LinkedFigureResult =
    | { ok: true; figure: PlotlyFigure; revision: string; notes: string[] }
    | { ok: false; message: string; refused?: true };
type DatasetRows = WidgetDataset['rows'];
// shortcut: a Surface splits on these two field ids only (the FX vol table's), make it a setting when another source needs a different split.
export const SURFACE_SPLIT = ['pair', 'date'];
const MAX_SURFACES = 6;
/** Legend names for Rows mode: the label, disambiguated by group path and then by row order when it repeats. */
function rowNames(rows: DatasetRows, labels: string[]): string[] {
    const count = new Map<string, number>();
    for (const label of labels)
        count.set(label, (count.get(label) ?? 0) + 1);
    const names = rows.map((row, index) => count.get(labels[index])! > 1 ? [labels[index], ...(row.groupPath ?? []).map(m => `${m.field}: ${m.label ?? m.value}`)].join(' — ') : labels[index]);
    const used = new Set<string>();
    return names.map(name => { let out = name, n = 1; // a real label may equal a generated suffix
        while (used.has(out)) out = `${name} (${++n})`;
        used.add(out); return out; });
}
/** A measure's series name: its split path labels, then its label. */
export function measureName(column: Pick<DatasetColumn, 'label' | 'splitPath'>): string {
    return [...(column.splitPath ?? []).map(member => String(member.label ?? member.value ?? '')), column.label].join(' — ');
}
/** Presentation only: the worker has already selected, ordered and aggregated these rows. */
export function buildLinkedFigure(dataset: WidgetDataset, settings: LinkedChartSettings, theme: 'light' | 'dark'): LinkedFigureResult {
    if (settings.type === 'surface' && isPivoted(dataset.columns))
        return pivotSurface(dataset, settings, theme);
    const columns = new Map(dataset.columns.map(c => [c.id, c]));
    if (!settings.category || !columns.has(settings.category))
        return { ok: false, message: 'Choose an available category field.' };
    if (!settings.measures.length)
        return { ok: false, message: 'Choose chart fields: select one or more numeric measures.' };
    const category = settings.category;
    const ids = dataset.rows.map(r => r.id);
    const labels = dataset.rows.map(r => String(r.values[category] ?? ''));
    const measures: { id: string; name: string; colorKey: string; column: DatasetColumn; aggregation?: string; values: (number | null)[]; text: string[] }[] = [];
    for (const id of settings.measures) {
        const column = columns.get(id);
        if (!column)
            return { ok: false, message: `Measure ${id} is unavailable. Repair chart fields.` };
        if (column.dtype && column.dtype !== 'number')
            return { ok: false, message: `Measure ${column.label} is not numeric.` };
        const values: (number | null)[] = [];
        for (const row of dataset.rows) {
            const raw = row.values[id];
            if (raw === null || raw === undefined) {
                values.push(null);
                continue;
            }
            const n = typeof raw === 'bigint' && column.aggregation === 'count' && raw >= 0n && raw <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(raw) : raw;
            if (typeof n !== 'number' || !Number.isFinite(n) || (column.aggregation === 'count' && !Number.isSafeInteger(n)))
                return { ok: false, message: `Measure ${column.label} contains non-numeric or unsafe values.` };
            values.push(n);
        }
        const split = column.splitPath ?? [];
        const name = measureName(column);
        const colorKey = split.length ? JSON.stringify(split.map(member => [member.categoryId ?? member.field, member.memberKey ?? pivotValueKey(member.value)])) : id;
        const text = dataset.rows.map((row, index) => [escape(labels[index]), ...(row.groupPath ?? []).map(m => `${escape(m.field)}: ${escape(m.label ?? m.value)}`), ...(column.splitPath ?? []).map(m => `${escape(m.field)}: ${escape(m.label ?? m.value)}`), `${escape(column.label)}${column.aggregation ? ` (${column.aggregation})` : ''}: ${values[index] ?? 'Missing'}`].join('<br>'));
        measures.push({ id, name, colorKey, column, aggregation: column.aggregation, values, text });
    }
    if (settings.type === 'surface') {
        // x = category, y = measure, z = value: one plot per pair/date present in the rows, on one shared colour scale.
        // The measure axis runs in the source's column order (expiries in term order), not the order the boxes were ticked.
        const position = new Map(dataset.columns.map((c, i) => [c.id, i]));
        measures.sort((a, b) => position.get(a.id)! - position.get(b.id)!);
        const split = SURFACE_SPLIT.filter(id => id !== category && columns.has(id));
        const groups = new Map<string, number[]>();
        dataset.rows.forEach((row, r) => { const key = split.map(id => String(row.values[id] ?? '')).join(' — '); groups.set(key, [...(groups.get(key) ?? []), r]); });
        if (groups.size > MAX_SURFACES)
            return { ok: false, refused: true, message: `Surface draws at most ${MAX_SURFACES} plots — the rows hold ${groups.size} ${split.join('/')} combinations.` };
        if ([...groups.values()].some(rows => rows.length < 2))
            return { ok: false, refused: true, message: 'Surface needs at least two rows per plot.' };
        const numeric = dataset.rows.every(row => typeof row.values[category] === 'number');
        const revision = JSON.stringify([settings.type, settings.category, settings.measures]);
        const axisLabel = escape(columns.get(category)!.label);
        // A line keeps the full hover; a surface cell names the category and the measure.
        const plots = [...groups].map(([title, rows]): Plot => ({ title, x: rows.map((r, i) => numeric ? dataset.rows[r].values[category] as number : i), xTicks: numeric ? undefined : rows.map(r => labels[r]),
            y: measures.map((_, i) => i), yTicks: measures.map(m => m.name), colorKeys: measures.map(m => m.colorKey), z: measures.map(m => rows.map(r => m.values[r])),
            text: measures.map(m => rows.map(r => measures.length === 1 ? m.text[r] : `${axisLabel}: ${escape(labels[r])}<br>${escape(m.name)}: ${m.values[r] ?? 'Missing'}`)) }));
        return surfaceFigure(plots, axisLabel, revision, theme);
    }
    const pie = settings.type === 'pie';
    if (pie && measures.length > 1)
        return { ok: false, refused: true, message: 'Pie shows one measure — choose one' };
    // Pie always uses the Rows layout with its one measure as the only position.
    const fromRows = pie || settings.seriesFrom === 'rows';
    const revision = JSON.stringify([settings.type, settings.category, settings.measures, settings.display, ...(fromRows ? ['rows'] : [])]);
    const background = theme === 'dark' ? '#1e242e' : '#ffffff';
    const frame = { paper_bgcolor: background, plot_bgcolor: background, font: { color: theme === 'dark' ? '#dfe4ec' : '#1a1f28' } };
    const legend = { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.3, yanchor: 'top' };
    const margin = { l: 48, r: 12, t: 12, b: 80 };
    if (settings.type === 'waterfall') {
        const walk = buildWaterfall(dataset.rows, labels, measures);
        if (!walk.ok)
            return walk;
        return { ok: true, revision, notes: walk.notes, figure: { data: walk.data, layout: { uirevision: revision, margin, waterfallmode: 'group', xaxis: walk.xaxis, showlegend: true, legend, ...frame } } };
    }
    // The series-by-position matrix: Columns mode has a series per measure over row positions; Rows mode transposes it.
    let positions: string[], ticks: string[], series: { name: string; colorKey: string; values: (number | null)[]; text: string[] }[];
    if (fromRows) {
        const names = rowNames(dataset.rows, labels);
        positions = measures.map(m => m.id);
        ticks = measures.map(m => m.name);
        series = dataset.rows.map((row, r) => {
            const values = measures.map(m => m.values[r]);
            const hoverHead = [escape(names[r]), ...(row.groupPath ?? []).map(m => `${escape(m.field)}: ${escape(m.label ?? m.value)}`)];
            return {
                name: names[r],
                colorKey: JSON.stringify([pivotValueKey(row.values[category]), ...(row.groupPath ?? []).map(m => [m.categoryId ?? m.field, m.memberKey ?? pivotValueKey(m.value)])]),
                values,
                text: measures.map((m, i) => [...hoverHead, `${escape(m.name)}${m.aggregation ? ` (${m.aggregation})` : ''}: ${values[i] ?? 'Missing'}`].join('<br>')),
            };
        });
    } else {
        positions = ids;
        ticks = labels;
        series = measures;
    }
    const notes: string[] = [];
    if (pie || (settings.display === 'percent' && settings.type !== 'line')) {
        // Cells in table-row order, then measure order, whichever way the series run.
        const cells = dataset.rows.flatMap((_, r) => measures.map((_, m) => fromRows ? [r, m] : [m, r]));
        const item = ([s, p]: number[]) => `${series[s].name} (${ticks[p]})`;
        const negative = cells.filter(([s, p]) => series[s].values[p]! < 0);
        if (negative.length)
            return { ok: false, refused: true, message: `Can't show shares of negative values: ${list(negative.map(item))}.` };
        const totals = positions.map((_, p) => series.reduce((sum, s) => sum + (s.values[p] ?? 0), 0));
        const zero = positions.flatMap((_, p) => totals[p] === 0 && series.some(s => s.values[p] !== null) ? [ticks[p]] : []);
        if (zero.length)
            return { ok: false, refused: true, message: `Can't show shares of a zero total: ${list(zero)}.` };
        const missing = cells.filter(([s, p]) => series[s].values[p] === null);
        if (missing.length)
            notes.push(`Missing: ${list(missing.map(item))}`);
        series = series.map(s => ({ ...s, text: s.text.map((t, p) => s.values[p] === null ? t : `${t}<br>Share: ${(s.values[p]! / totals[p] * 100).toFixed(1)}%`) }));
    }
    if (pie) {
        const present = series.filter(s => s.values[0] !== null);
        const trace = { type: 'pie', labels: present.map(s => s.name), values: present.map(s => s.values[0]), marker: { colors: present.map(s => color(s.colorKey)) }, text: present.map(s => s.text[0]), hovertemplate: '%{text}<extra></extra>', textinfo: 'percent', sort: false };
        return { ok: true, revision, notes, figure: { data: [trace], layout: { uirevision: revision, margin, showlegend: true, legend, ...frame } } };
    }
    const horizontal = settings.type === 'bar';
    const traces = series.map(({ name, colorKey, values, text }) => {
        const seriesColor = color(colorKey);
        return { type: settings.type === 'line' ? 'scatter' : 'bar', name, x: horizontal ? values : positions, y: horizontal ? positions : values, ...(settings.type === 'line' ? { mode: 'lines+markers', connectgaps: false, line: { color: seriesColor } } : { orientation: horizontal ? 'h' : 'v', textposition: 'none' }), marker: { color: seriesColor }, text, hovertemplate: '%{text}<extra></extra>' };
    });
    const percent = settings.display === 'percent' && settings.type !== 'line';
    const axis = { type: 'category', categoryorder: 'array', categoryarray: positions, tickmode: 'array', tickvals: positions, ticktext: ticks };
    return { ok: true, revision, notes, figure: { data: traces, layout: { uirevision: revision, margin, barmode: settings.display === 'stacked' || percent ? 'stack' : 'group', ...(percent ? { barnorm: 'percent', [horizontal ? 'xaxis' : 'yaxis']: { ticksuffix: '%' } } : {}), [horizontal ? 'yaxis' : 'xaxis']: axis, showlegend: true, legend, ...frame } } };
}
/** One plot of a Surface: x by row, y by column, z[column][row]. */
type Plot = { title: string; x: number[]; xTicks?: string[]; y: number[]; yTicks: string[]; colorKeys: string[]; z: (number | null)[][]; text: string[][] };
/** Plots side by side, titled, on one colour scale: a line each when every plot has one column, else 3-D scenes. */
function surfaceFigure(plots: Plot[], axisLabel: string, revision: string, theme: 'light' | 'dark'): LinkedFigureResult {
    const background = theme === 'dark' ? '#1e242e' : '#ffffff';
    const titles = plots.flatMap(({ title }, g) => title ? [{ text: escape(title), xref: 'paper', yref: 'paper', x: (g + 0.5) / plots.length, y: 1, xanchor: 'center', yanchor: 'bottom', showarrow: false }] : []);
    const font = { color: theme === 'dark' ? '#dfe4ec' : '#1a1f28' };
    // Positions, not names: this bundle's 3-D scene does not mesh a surface over a string axis, so text axes are ticked by position.
    const ticked = (vals: number[], text?: string[]) => text ? { tickmode: 'array', tickvals: vals, ticktext: text } : {};
    if (plots.every(p => p.z.length === 1)) {
        // One measure has no second axis to mesh over: each plot draws as a line across the category.
        const axes: Record<string, unknown> = {};
        const lines = plots.map((p, g) => {
            const n = g ? String(g + 1) : '', lineColor = color(p.colorKeys[0]);
            axes[`xaxis${n}`] = { domain: [g / plots.length + (g ? 0.04 : 0), (g + 1) / plots.length - (g < plots.length - 1 ? 0.04 : 0)], anchor: `y${n}`, title: { text: axisLabel }, ...ticked(p.x, p.xTicks) };
            axes[`yaxis${n}`] = { anchor: `x${n}`, title: { text: g ? '' : escape(p.yTicks[0]) } };
            return { type: 'scatter', mode: 'lines+markers', connectgaps: false, xaxis: `x${n}`, yaxis: `y${n}`, x: p.x, y: p.z[0], line: { color: lineColor }, marker: { color: lineColor }, text: p.text[0], hovertemplate: '%{text}<extra></extra>' };
        });
        return { ok: true, revision, notes: [], figure: { data: lines, layout: { uirevision: revision, margin: { l: 56, r: 12, t: 28, b: 48 }, showlegend: false, annotations: titles, paper_bgcolor: background, plot_bgcolor: background, font, ...axes } } };
    }
    const scenes: Record<string, unknown> = {};
    const data = plots.map((p, g) => {
        const scene = g ? `scene${g + 1}` : 'scene';
        scenes[scene] = { domain: { x: [g / plots.length, (g + 1) / plots.length] }, bgcolor: background, xaxis: { title: { text: axisLabel }, ...ticked(p.x, p.xTicks) }, yaxis: { title: { text: '' }, ...ticked(p.y, p.yTicks) }, zaxis: { title: { text: '' } } };
        return { type: 'surface', scene, name: p.title, coloraxis: 'coloraxis', x: p.x, y: p.y, z: p.z, text: p.text, hovertemplate: '%{text}<extra></extra>' };
    });
    return { ok: true, revision, notes: [], figure: { data, layout: { uirevision: revision, margin: { l: 0, r: 0, t: 28, b: 0 }, coloraxis: { colorscale: 'Viridis' }, annotations: titles, paper_bgcolor: background, font, ...scenes } } };
}
export function isPivoted(columns: readonly DatasetColumn[]): boolean { return columns.some(c => !!c.splitPath?.length); }
/** One entry per distinct report value (measureId) among split columns, in column order. */
export function reportValues(columns: readonly DatasetColumn[]): { id: string; label: string }[] {
    const seen = new Map<string, string>();
    for (const c of columns)
        if (c.splitPath?.length && c.measureId !== undefined && !seen.has(c.measureId)) seen.set(c.measureId, c.label);
    return [...seen].map(([id, label]) => ({ id, label }));
}
/** The split columns of one report value, in column order. */
export function expiryColumns(columns: readonly DatasetColumn[], height: string): DatasetColumn[] { return columns.filter(c => c.splitPath?.length && c.measureId === height); }
const memberText = (m: DatasetGroupMember) => m.label ?? String(m.value);
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const firstFinite = (vals: unknown[]) => vals.map(finite).find(v => v !== null) ?? null;
const splitKey = (c: DatasetColumn) => JSON.stringify(c.splitPath!.map(m => m.memberKey ?? pivotValueKey(m.value)));
/** A pivot report: one surface per outer row group, Strike rows by Height's split (expiry) columns; `measures` picks expiries, empty is all. */
function pivotSurface(dataset: WidgetDataset, settings: LinkedChartSettings, theme: 'light' | 'dark'): LinkedFigureResult {
    const values = reportValues(dataset.columns);
    const { height, spaceRowsBy, spaceColumnsBy, measures } = settings;
    if (!height)
        return { ok: false, message: 'Choose chart fields: select a value for Height.' };
    for (const id of [height, spaceRowsBy, spaceColumnsBy])
        if (id !== undefined && !values.some(v => v.id === id))
            return { ok: false, message: `Field ${id} is unavailable. Repair chart fields.` };
    const label = (id: string) => values.find(v => v.id === id)!.label;
    const heights = expiryColumns(dataset.columns, height).filter(c => !measures.length || measures.includes(c.id));
    const depth = Math.max(0, ...dataset.rows.map(r => r.groupPath?.length ?? 0));
    const leaf = dataset.rows.filter(r => (r.groupPath?.length ?? 0) === depth);
    if (leaf.some(r => heights.some(c => r.values[c.id] != null && finite(r.values[c.id]) === null)))
        return { ok: false, message: `Value ${label(height)} contains non-numeric or unsafe values.` };
    const groups = new Map<string, DatasetRows>();
    for (const row of leaf) {
        const key = (row.groupPath ?? []).slice(0, -1).map(memberText).join(' — ');
        groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    if (groups.size > MAX_SURFACES)
        return { ok: false, refused: true, message: `Surface draws at most ${MAX_SURFACES} plots — the rows hold ${groups.size} ${(leaf[0].groupPath ?? []).slice(0, -1).map(m => m.field).join('/')} combinations.` };
    const plots: Plot[] = [];
    for (const [title, group] of groups) {
        const rows = group.filter(r => heights.some(c => finite(r.values[c.id]) !== null));
        const cols = heights.filter(c => rows.some(r => finite(r.values[c.id]) !== null));
        if (rows.length < 2)
            return { ok: false, refused: true, message: 'Surface needs at least two rows per plot.' };
        const members = rows.map(r => r.groupPath?.[depth - 1]);
        const rowTicks = members.map(m => m ? memberText(m) : '');
        const colTicks = cols.map(c => c.splitPath!.map(memberText).join(' — '));
        let x = rows.map((_, i) => i), xTicks: string[] | undefined = rowTicks;
        if (spaceRowsBy) {
            const along = expiryColumns(dataset.columns, spaceRowsBy);
            const at = rows.map(r => firstFinite(along.map(c => r.values[c.id])));
            const empty = at.indexOf(null);
            if (empty >= 0)
                return { ok: false, refused: true, message: `Can't space rows by ${label(spaceRowsBy)}: ${rowTicks[empty]} has no value.` };
            x = at as number[];
        } else if (members.every(m => typeof m?.value === 'number')) {
            x = members.map(m => m!.value as number);
            xTicks = undefined;
        }
        let y = cols.map((_, i) => i);
        if (spaceColumnsBy) {
            const down = expiryColumns(dataset.columns, spaceColumnsBy);
            const at = cols.map(c => { const match = down.find(d => splitKey(d) === splitKey(c)); return match ? firstFinite(rows.map(r => r.values[match.id])) : null; });
            const empty = at.indexOf(null);
            if (empty >= 0)
                return { ok: false, refused: true, message: `Can't space columns by ${label(spaceColumnsBy)}: ${colTicks[empty]} has no value.` };
            y = at as number[];
        }
        plots.push({ title, x, xTicks, y, yTicks: colTicks, colorKeys: cols.map(c => JSON.stringify(c.splitPath!.map(m => [m.categoryId ?? m.field, m.memberKey ?? pivotValueKey(m.value)]))),
            z: cols.map(c => rows.map(r => finite(r.values[c.id]))),
            text: cols.map((c, e) => rows.map((r, k) => [escape(rowTicks[k]), escape(colTicks[e]), `${escape(c.label)}: ${finite(r.values[c.id]) ?? 'Missing'}`].join('<br>'))) });
    }
    const groupColumn = dataset.columns.find(c => c.id === LABEL_FIELD);
    const revision = JSON.stringify(['surface', 'pivot', height, spaceRowsBy ?? null, spaceColumnsBy ?? null, measures]);
    return surfaceFigure(plots, escape(groupColumn ? groupColumn.label.split(' › ').at(-1) : ''), revision, theme);
}
/** At most five items, then how many more. */
export function list(items: string[]): string {
    return items.length > 5 ? `${items.slice(0, 5).join(', ')}, and ${items.length - 5} more` : items.join(', ');
}
