// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { pivotValueKey } from '../pivotKeys';
import type { PlotlyFigure } from '../chartShapes';
import type { WidgetDataset, LinkedChartSettings } from './types';
const COLORS = ['#4c9aff', '#ef8354', '#71c7a1', '#b08cde', '#e4c65a', '#65c6d4'];
function color(id: string) { let hash = 0; for (const c of id)
    hash = (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0; return COLORS[hash % COLORS.length]; }
function escape(value: unknown) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
/** Presentation only: the worker has already selected, ordered and aggregated these rows. */
export function buildLinkedFigure(dataset: WidgetDataset, settings: LinkedChartSettings, theme: 'light' | 'dark'): {
    ok: true;
    figure: PlotlyFigure;
    revision: string;
} | {
    ok: false;
    message: string;
} {
    const columns = new Map(dataset.columns.map(c => [c.id, c]));
    if (!settings.category || !columns.has(settings.category))
        return { ok: false, message: 'Choose an available category field.' };
    if (!settings.measures.length)
        return { ok: false, message: 'Choose chart fields: select one or more numeric measures.' };
    const traces: unknown[] = [];
    const ids = dataset.rows.map(r => r.id);
    const labels = dataset.rows.map(r => String(r.values[settings.category!] ?? ''));
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
        const name = [...split.map(member => String(member.label ?? member.value ?? '')), column.label].join(' — ');
        const seriesColor = color(split.length ? JSON.stringify(split.map(member => [member.categoryId ?? member.field, member.memberKey ?? pivotValueKey(member.value)])) : id);
        const horizontal = settings.type === 'bar';
        const text = dataset.rows.map((row, index) => [escape(labels[index]), ...(row.groupPath ?? []).map(m => `${escape(m.field)}: ${escape(m.label ?? m.value)}`), ...(column.splitPath ?? []).map(m => `${escape(m.field)}: ${escape(m.label ?? m.value)}`), `${escape(column.label)}${column.aggregation ? ` (${column.aggregation})` : ''}: ${values[index] ?? 'Missing'}`].join('<br>'));
        traces.push({ type: settings.type === 'line' ? 'scatter' : 'bar', name, x: horizontal ? values : ids, y: horizontal ? ids : values, ...(settings.type === 'line' ? { mode: 'lines+markers', connectgaps: false, line: { color: seriesColor } } : { orientation: horizontal ? 'h' : 'v', textposition: 'none' }), marker: { color: seriesColor }, text, hovertemplate: '%{text}<extra></extra>' });
    }
    const revision = JSON.stringify([settings.type, settings.category, settings.measures, settings.display]);
    const axis = { type: 'category', categoryorder: 'array', categoryarray: ids, tickmode: 'array', tickvals: ids, ticktext: labels };
    const background = theme === 'dark' ? '#1e242e' : '#ffffff';
    return { ok: true, revision, figure: { data: traces, layout: { uirevision: revision, margin: { l: 48, r: 12, t: 12, b: 80 }, barmode: settings.display === 'stacked' ? 'stack' : 'group', [settings.type === 'bar' ? 'yaxis' : 'xaxis']: axis, showlegend: true, legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.3, yanchor: 'top' }, paper_bgcolor: background, plot_bgcolor: background, font: { color: theme === 'dark' ? '#dfe4ec' : '#1a1f28' } } } };
}
