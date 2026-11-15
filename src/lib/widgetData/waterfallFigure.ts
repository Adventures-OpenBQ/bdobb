// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { statementTemplate } from '../statementModel/catalog';
import { statementOwnedIds } from '../statementModel/types';
import { color, escape, list } from './chartFigure';
import type { DatasetColumn, DatasetRow } from './types';

export type WalkRole = 'step' | 'cost' | 'subtotal' | 'calculated' | 'ebitda';
const SECTION_ROLES: Record<string, WalkRole> = { Income: 'step', Expenses: 'cost', Profit: 'subtotal' };
const LINE_ROLES: Record<string, WalkRole> = { net_income_from_discontinued_operations: 'step', discontinued_operations: 'step', calculated_gross_profit: 'calculated', ebitda: 'ebitda' };
const ITEM = /^statement\/([^/]+)\/([^/]+)\/category\/item$/;

/** The line's role on the walk, from its home template section (never the section it is shown in). */
export function walkRole(row: DatasetRow): { templateId: string; line: string; role: WalkRole } | undefined {
    for (const member of row.groupPath ?? []) {
        const match = ITEM.exec(member.categoryId ?? '');
        if (!match) continue;
        const [, templateId, version] = match;
        const template = statementTemplate(templateId as 'income', version);
        const prefix = `${statementOwnedIds({ id: templateId, version }).prefix}line/`;
        const id = String(member.value);
        const section = template?.sections.find(s => s.lineIds.includes(id));
        if (!section || !id.startsWith(prefix)) return undefined;
        const line = id.slice(prefix.length);
        const role = LINE_ROLES[line] ?? SECTION_ROLES[section.label];
        return role && { templateId, line, role };
    }
    return undefined;
}

type Measure = { id: string; name: string; colorKey: string; column: DatasetColumn; values: (number | null)[] };
const refuse = (message: string) => ({ ok: false as const, refused: true as const, message });
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}`;

/** One Plotly waterfall trace per period measure, walking the rows in table order from revenue to net income. */
export function buildWaterfall(rows: DatasetRow[], labels: string[], measures: Measure[]): { ok: true; data: object[]; xaxis: object; notes: string[] } | { ok: false; refused: true; message: string } {
    // shortcut: rows without a role (e.g. section header rows) are left off the walk; a table with none is refused.
    const roles = rows.map(walkRole);
    if (!roles.some(Boolean))
        return refuse('Waterfall needs an income statement table');
    if (roles.some(r => r?.role === 'ebitda'))
        return refuse("EBITDA isn't part of the walk — untick it");
    const years = measures.map(m => m.column.splitPath?.find(p => p.categoryId?.startsWith('statement/income/') && p.categoryId.endsWith('/category/period')));
    if (!years.length || years.some(y => !y))
        return refuse('Waterfall needs period columns');
    const names = years.map(y => String(y!.label ?? y!.value));
    const running = measures.map(() => 0);
    const keys: string[] = [], ticks: string[] = [], missing: string[] = [];
    const points = measures.map(() => ({ measure: [] as string[], y: [] as number[], text: [] as string[] }));
    const push = (key: string, tick: string, each: (m: number) => { measure: 'relative' | 'absolute'; y: number; text: string }) => {
        keys.push(key); ticks.push(tick);
        points.forEach((p, m) => { const point = each(m); p.measure.push(point.measure); p.y.push(point.y); p.text.push(point.text); });
    };
    rows.forEach((row, r) => {
        const role = roles[r];
        if (!role) return;
        const label = escape(labels[r]);
        if (role.role === 'subtotal' || role.role === 'calculated') {
            const gaps = measures.map((m, i) => { const v = m.values[r]; return v === null || Math.abs(v - running[i]) <= 1e-9 * Math.max(1, Math.abs(v)) ? 0 : v - running[i]; });
            if (gaps.some(g => g !== 0))
                push(`other:${r}`, 'Other', m => { running[m] += gaps[m]; return { measure: 'relative', y: gaps[m], text: ['Other', escape(names[m]), 'Not in the lines shown', `Step: ${signed(gaps[m])}`, `Running total: ${running[m]}`].join('<br>') }; });
            push(row.id, role.role === 'calculated' ? `${labels[r]} (calculated)` : labels[r], m => {
                const v = measures[m].values[r];
                if (v === null) { missing.push(`${labels[r]} (${names[m]})`); return { measure: 'relative', y: 0, text: [label, escape(names[m]), 'Value: Missing', `Running total: ${running[m]}`].join('<br>') }; }
                running[m] = v;
                return { measure: 'absolute', y: v, text: [label, escape(names[m]), `Value: ${v}`, `Running total: ${v}`].join('<br>') };
            });
            return;
        }
        push(row.id, labels[r], m => {
            const v = measures[m].values[r];
            if (v === null) missing.push(`${labels[r]} (${names[m]})`);
            const step = v === null ? 0 : role.role === 'cost' ? -v : v;
            running[m] += step;
            return { measure: 'relative', y: step, text: [label, escape(names[m]), `Value: ${v ?? 'Missing'}`, `Step: ${signed(step)}`, `Running total: ${running[m]}`].join('<br>') };
        });
    });
    const data = measures.map((m, i) => {
        const marker = { marker: { color: color(m.colorKey) } };
        return { type: 'waterfall', name: names[i], x: keys, ...points[i], increasing: marker, decreasing: marker, totals: marker, hovertemplate: '%{text}<extra></extra>', textposition: 'none' };
    });
    const notes = ['Expenses shown as decreases.', ...(missing.length ? [`Missing: ${list(missing)}`] : [])];
    return { ok: true, data, xaxis: { type: 'category', tickmode: 'array', tickvals: keys, ticktext: ticks }, notes };
}
