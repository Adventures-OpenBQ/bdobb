// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { abbreviation, formatCell } from '../format';
import type { LinkedFigureResult } from './chartFigure';
import { estimateProjectionIssue, fiscalKey, instrument, read, sourceName, symbolFields, text } from './chartRecipes/estimateEvidence';
import { calendarDate } from './chartRecipes/priceEvidence';
import type { DatasetColumn, DatasetRow, LinkedChartSettings, WidgetDataset } from './types';

const SIBLINGS = ['low', 'avg', 'high', 'consensus'];
const metricOf = (id: string) => id.slice(0, -'_actual'.length);

/** The sibling ids the linked table presents for these `*_actual` metrics; a hidden column is never requested. */
export function bulletRequestIds(actualIds: string[], columns: readonly DatasetColumn[]): string[] {
    const presented = new Set(columns.map(c => c.id));
    const forRole = (name: string) => columns.filter(c => sourceName(c) === name).map(c => c.id);
    const wanted = [...actualIds.filter(id => id.endsWith('_actual')).flatMap(id => SIBLINGS.map(s => `${metricOf(id)}_${s}`)),
        ...forRole('period_ending'), ...forRole('fiscal_period'), ...forRole('band_note'), ...forRole('band_status'), ...symbolFields(columns).map(c => c.id)];
    return [...new Set(wanted)].filter(id => presented.has(id));
}

function number(row: DatasetRow | undefined, id: string): number | null {
    const v = row?.values[id];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** One Plotly bullet per chosen `*_actual` metric, for one quarter of the linked table. */
export function buildBulletFigure(dataset: WidgetDataset, settings: LinkedChartSettings, theme: 'light' | 'dark', maxDecimals: number): LinkedFigureResult {
    const columns = new Map(dataset.columns.map(c => [c.id, c]));
    const category = settings.category;
    if (category === undefined || !columns.has(category))
        return { ok: false, message: 'Choose an available category field.' };
    if (!settings.measures.length)
        return { ok: false, message: 'Choose chart fields: select one or more numeric measures.' };
    for (const id of settings.measures) {
        if (!columns.has(id))
            return { ok: false, message: `Measure ${id} is unavailable. Repair chart fields.` };
        if (!id.endsWith('_actual'))
            return { ok: false, refused: true, message: 'Bullet metrics must be *_actual columns.' };
    }
    if (dataset.rows.some(r => r.groupPath?.length))
        return { ok: false, refused: true, message: 'Bullet needs one row per quarter — ungroup the table.' };
    const forRole = (name: string) => dataset.columns.find(c => sourceName(c) === name)?.id;
    const guard = forRole('band_status');
    const identityIssue = estimateProjectionIssue(dataset) ?? instrument(dataset, Boolean(guard) || dataset.rows.length > 1).issue;
    if (identityIssue) return { ok: false, refused: true, message: identityIssue };
    const endField = forRole('period_ending');
    const ending = (r: DatasetRow) => calendarDate(read(r, endField));
    const fiscalField = forRole('fiscal_period');
    const seenQuarters = new Set<string>();
    const seenDates = new Set<string>();
    if (endField) for (const r of dataset.rows) {
        const date = ending(r);
        if (!date || seenDates.has(date)) return { ok: false, refused: true, message: 'Present one row per quarter with a unique, valid period end.' };
        seenDates.add(date);
        const key = fiscalKey(text(read(r, fiscalField)));
        if (key && seenQuarters.has(key)) return { ok: false, refused: true, message: 'Choose one period end per fiscal quarter.' };
        if (key) seenQuarters.add(key);
    }
    const latest = (rs: DatasetRow[]) => rs.reduce<DatasetRow | undefined>((best, r) => best && ending(best)! >= ending(r)! ? best : r, undefined);
    let row: DatasetRow | undefined;
    if (settings.period !== undefined) {
        const matches = dataset.rows.filter(r => String(read(r, category) ?? '') === settings.period);
        if (matches.length > 1) return { ok: false, refused: true, message: 'Choose a category that uniquely identifies each quarter.' };
        row = matches[0];
        if (!row)
            return { ok: false, refused: true, message: `Quarter ${settings.period} is not in the linked table.` };
    } else {
        row = endField ? latest(dataset.rows) : undefined;
        if (!row)
            return { ok: false, refused: true, message: 'Choose a quarter.' };
    }
    const chosenEnding = ending(row);
    const previous = chosenEnding === null ? undefined : latest(dataset.rows.filter(r => ending(r) !== null && ending(r)! < chosenEnding));

    const dark = theme === 'dark';
    const background = dark ? '#1e242e' : '#ffffff';
    const font = dark ? '#dfe4ec' : '#1a1f28';
    const notes: string[] = [];
    if (!previous)
        notes.push('No previous quarter in the linked table, so no reference line.');
    const status = read(row, guard);
    const showTrend = guard === undefined || status === 'ok';
    if (status === 'ok') notes.push('Provider estimate range check passed (ok).');
    if (!showTrend) notes.push(status === 'withheld' ? 'Estimate range withheld.' : status === 'no_estimate'
        ? 'No estimate range was supplied.' : 'Estimate range unavailable because the provider status is missing or unrecognized.');
    const bandNote = read(row, forRole('band_note'));
    if (typeof bandNote === 'string' && bandNote)
        notes.push(bandNote);
    const n = settings.measures.length;
    const traces: unknown[] = [], annotations: unknown[] = [];
    settings.measures.forEach((id, i) => {
        const column = columns.get(id)!;
        const m = metricOf(id);
        const [low, avg, high, consensus] = SIBLINGS.map(s => {
            const sibling = `${m}_${s}`;
            return (showTrend || s === 'consensus') && columns.has(sibling) ? number(row, sibling) : null;
        });
        const actual = number(row, id), prior = number(previous, id);
        if (actual === null)
            notes.push(`${column.label}: not reported`);
        // The provider sends no low/high for growth, so a missing range there is not a hidden column.
        if (!m.endsWith('_growth') && (!columns.has(`${m}_low`) || !columns.has(`${m}_high`)))
            notes.push(`Range columns for ${column.label} are not shown in the linked table`);
        const band = low !== null && high !== null;
        const values = [actual, low, avg, high, consensus, prior].filter((v): v is number => v !== null);
        const percent = column.format?.formatterFn === 'percent';
        const unit = percent ? { size: 1, suffix: ' %' } : abbreviation(Math.max(0, ...values.map(Math.abs)), maxDecimals);
        const lo = Math.min(...values, Infinity), hi = Math.max(...values, -Infinity);
        const pad = values.length ? (hi - lo) * 0.15 || Math.abs(hi) * 0.1 || 1 : 1;
        const range = values.length ? [(lo - pad) / unit.size, (hi + pad) / unit.size] : [0, 1];
        const half = (range[1] - range[0]) * 0.004;
        const tick = (v: number, color: string) => ({ range: [v / unit.size - half, v / unit.size + half], color });
        // The beat is against the analysts' average; without one (a withheld band), against History's consensus.
        const basis = avg ?? consensus;
        // Without a band the grey tick marks whatever the beat is measured against, so the number and the mark agree.
        const steps = band
            ? [{ range: [low / unit.size, high / unit.size], color: dark ? '#3a4a63' : '#c9d6ea' }, ...(avg !== null ? [tick(avg, background)] : [])]
            : basis !== null ? [tick(basis, '#8a94a6')] : [];
        const h = 1 / n;
        const y = [1 - (i + 1) * h + h * 0.2, 1 - i * h - h * 0.2];
        traces.push({
            type: 'indicator', mode: 'gauge', value: (actual ?? range[0] * unit.size) / unit.size,
            // Every bullet metric is an actual, so the suffix only costs title width.
            title: { text: column.label.replace(/ Actual$/, ''), font: { size: 12 } }, domain: { x: [0.24, 0.70], y },
            gauge: {
                shape: 'bullet', axis: { range, ticksuffix: unit.suffix, nticks: 4 }, steps,
                bar: { color: font, thickness: actual === null ? 0 : 0.3 },
                ...(prior !== null ? { threshold: { line: { color: '#d1495b', width: 2 }, thickness: 0.8, value: prior / unit.size } } : {}),
            },
        });
        let text = formatCell(actual, id, maxDecimals, undefined, column.format);
        if (actual !== null && basis !== null) {
            const diff = actual - basis;
            const magnitude = percent ? `${formatCell(Math.abs(diff), id, maxDecimals, undefined, { ...column.format, formatterFn: undefined })} pts` : formatCell(Math.abs(diff), id, maxDecimals, undefined, column.format);
            text += `<br><span style="color:${diff >= 0 ? '#2e8b57' : '#d1495b'}">${diff >= 0 ? '▲' : '▼'} ${magnitude}${avg === null ? '<br>vs consensus' : ''}</span>`;
        }
        annotations.push({ text, x: 0.72, y: (y[0] + y[1]) / 2, xref: 'paper', yref: 'paper', xanchor: 'left', yanchor: 'middle', align: 'left', showarrow: false });
    });
    const revision = JSON.stringify(['bullet', category, settings.measures, settings.period ?? null, maxDecimals]);
    return { ok: true, revision, notes, figure: { data: traces, layout: { uirevision: revision, margin: { l: 12, r: 12, t: 12, b: 12 }, annotations, showlegend: false, paper_bgcolor: background, plot_bgcolor: background, font: { color: font } } } };
}
