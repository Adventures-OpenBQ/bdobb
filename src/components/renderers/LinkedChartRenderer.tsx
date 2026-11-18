// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { ColumnSpec, DashboardCard } from '../../lib/types';
import type { LinkedChartSettings, WidgetDataset } from '../../lib/widgetData/types';
import { buildLinkedFigure, expiryColumns, isPivoted, reportValues, SURFACE_SPLIT } from '../../lib/widgetData/chartFigure';
import { LABEL_FIELD } from '../../lib/pivotTable';
import { tableExecutionStore } from '../../stores/tableExecutionStore';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { ChartRenderer } from './ChartRenderer';
import type { PlotlyFigure } from '../../lib/chartShapes';
/**
 * A type change drops the settings the new type cannot use. Picking Surface with no fields chosen takes them from
 * the source widget's chartDataType hints (the first time or category column, every series column), where offered.
 */
function withType(settings: LinkedChartSettings, type: LinkedChartSettings['type'], hints: ColumnSpec[] = [], offered: ReadonlySet<string> = new Set()): LinkedChartSettings {
    const next = { ...settings, type, display: settings.display === 'percent' && type !== 'column' && type !== 'bar' ? 'stacked' as const : settings.display };
    if (type === 'pie' || type === 'surface')
        delete next.seriesFrom;
    if (type !== 'surface') {
        delete next.height;
        delete next.spaceRowsBy;
        delete next.spaceColumnsBy;
    }
    if (type === 'surface' && !next.category && !next.measures.length) {
        const typed = hints.filter(c => offered.has(c.field));
        const axis = typed.find(c => c.chartDataType === 'time') ?? typed.find(c => c.chartDataType === 'category');
        const series = typed.filter(c => c.chartDataType === 'series').map(c => c.field);
        if (axis && series.length) {
            next.category = axis.field;
            next.measures = series;
        }
    }
    return next;
}
/**
 * The measures as one button that opens a checklist: All, Clear, a tick per measure, Apply. The same popup the table's
 * parameters use, so a long list (nine expiries) takes one control, and several ticks redraw the chart once.
 */
function MeasuresPicker({ options, selected, disabled, emptyMeansAll, onChange }: {
    options: { id: string; label: string; unavailable?: boolean }[];
    selected: string[];
    disabled: boolean;
    /** A pivoted Surface: an empty list draws every expiry the report offers, so All saves it and an empty list reads as all. */
    emptyMeansAll: boolean;
    onChange: (measures: string[]) => void;
}) {
    const trigger = useRef<HTMLButtonElement>(null);
    const popup = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<string[]>([]);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    useEffect(() => {
        if (!open)
            return;
        const outside = (e: PointerEvent) => { if (!popup.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node))
            setOpen(false); };
        const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            trigger.current?.focus();
        } };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', escape, true);
        return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
    }, [open]);
    const available = options.filter(o => !o.unavailable);
    const shown = emptyMeansAll && !selected.length ? available.map(o => o.id) : selected;
    const chosen = options.filter(o => shown.includes(o.id));
    const text = !chosen.length ? 'None' : chosen.length === available.length && chosen.every(o => !o.unavailable) ? `All (${chosen.length})` : chosen.length <= 3 ? chosen.map(o => o.label).join(', ') : `${chosen.length} of ${options.length}`;
    // Published in the listed order, so the series (and a surface's axis) follow the source's columns.
    const publish = (ids: string[]) => { setOpen(false); trigger.current?.focus(); onChange(options.filter(o => ids.includes(o.id)).map(o => o.id)); };
    return <span className="chart-measures">Measures<button ref={trigger} type="button" className="param-multi" aria-label={`Measures: ${text}`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} title={chosen.map(o => o.label).join(', ')} onClick={() => {
        const r = trigger.current!.getBoundingClientRect();
        setPosition({ left: Math.max(8, Math.min(r.left, window.innerWidth - 256)), top: Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 328)) });
        setDraft(shown);
        setOpen(!open);
    }}>{text}</button>
    {open ? createPortal(<div ref={popup} className="param-pop" role="dialog" aria-label="Measures" style={position}>
      <div className="row"><strong>Measures</strong><button type="button" aria-label="Close measures" onClick={() => { setOpen(false); trigger.current?.focus(); }}>×</button></div>
      <div className="row"><button type="button" onClick={() => publish(emptyMeansAll ? [] : available.map(o => o.id))}>All</button><button type="button" onClick={() => publish([])}>Clear</button></div>
      <div className="opts">{options.map(o => <label key={o.id}><input type="checkbox" checked={draft.includes(o.id)} onChange={e => setDraft(e.target.checked ? [...draft, o.id] : draft.filter(id => id !== o.id))}/>{o.label}</label>)}</div>
      <button type="button" onClick={() => publish(draft)}>Apply</button>
    </div>, document.body) : null}</span>;
}
type Completed = {
    identity: string;
    dataset: WidgetDataset;
    settings: LinkedChartSettings;
    renderedSettings: LinkedChartSettings;
    revision: string;
};
export function LinkedChartRenderer({ dashboardId, card, refreshKey, viewer = false, store = tableExecutionStore, hints, onSettingsChange }: {
    dashboardId: string;
    card: DashboardCard;
    refreshKey: number;
    viewer?: boolean;
    store?: typeof tableExecutionStore;
    /** The source widget's columnsDefs, for their chartDataType. */
    hints?: ColumnSpec[];
    onSettingsChange: (settings: LinkedChartSettings) => Promise<boolean>;
}) {
    const view = useSyncExternalStore(store.subscribe, () => store.readView(dashboardId, card.id));
    const theme = useResolvedTheme();
    const settings = card.linkedChart!;
    const source = card.linkedSource?.sourceWidgetId;
    const identity = JSON.stringify([dashboardId, card.id]);
    const mapping = JSON.stringify(settings);
    const active = JSON.stringify(view.sourceRevision);
    const [completed, setCompleted] = useState<Completed>();
    const [error, setError] = useState<string>();
    const [refused, setRefused] = useState<string>();
    const [noMatches, setNoMatches] = useState(false);
    const [saveError, setSaveError] = useState<string>();
    const [saving, setSaving] = useState(false);
    const refresh = useRef(refreshKey);
    const generation = useRef(0);
    useEffect(() => { if (refresh.current !== refreshKey) {
        refresh.current = refreshKey;
        store.refresh(dashboardId, card.id);
    } }, [refreshKey, dashboardId, card.id, store]);
    useEffect(() => {
        const version = ++generation.current;
        const controller = new AbortController();
        const revision = view.sourceRevision;
        const executor = source ? store.readExecutor(dashboardId, source) : undefined;
        if (!view.active) { setCompleted(undefined); setError(undefined); setRefused(undefined); setNoMatches(false); return; }
        if (!revision || revision.widgetId !== source || !executor || !view.ready || !['ready', 'empty'].includes(view.status))
            return;
        // A completed empty scope can drop generated columns; it is not a broken binding.
        if (view.status === 'empty') {
            setCompleted(undefined);
            setError(undefined);
            setRefused(undefined);
            setNoMatches(true);
            return;
        }
        const offered = view.ready.chartColumns ?? view.ready.columns;
        const available = new Map(offered.map(c => [c.id, c]));
        const present = new Set(view.ready.columns.map(c => c.id));
        setNoMatches(false);
        let request: string[], renderedSettings = settings;
        if (settings.type === 'surface' && isPivoted(offered)) {
            const ids = [settings.height, settings.spaceRowsBy, settings.spaceColumnsBy].filter((id): id is string => Boolean(id));
            const unavailable = ids.find(id => !offered.some(c => c.measureId === id));
            if (!settings.height || unavailable) {
                setRefused(undefined);
                setError(settings.height ? `Field ${unavailable} is unavailable. Repair chart fields.` : 'Choose chart fields: select a value for Height.');
                return;
            }
            setError(undefined);
            // Ticked expiries the source no longer offers are simply not drawn.
            const requested = offered.filter(c => c.measureId !== undefined && ids.includes(c.measureId) && present.has(c.id));
            if (!requested.some(c => c.measureId === settings.height)) {
                setCompleted(undefined);
                setRefused(undefined);
                setNoMatches(true);
                return;
            }
            request = [LABEL_FIELD, ...requested.map(c => c.id)];
        } else {
            const missing = [settings.category, ...settings.measures].filter((id): id is string => Boolean(id)).find(id => !available.has(id));
            if (missing) {
                setRefused(undefined);
                setError(`Field ${missing} is unavailable. Repair chart fields.`);
                return;
            }
            if (!settings.category || !settings.measures.length) {
                setRefused(undefined);
                setError('Choose chart fields: select a category and numeric measures.');
                return;
            }
            setError(undefined);
            renderedSettings = { ...settings, measures: settings.measures.filter(id => present.has(id)) };
            if (!renderedSettings.measures.length) {
                setCompleted(undefined);
                setRefused(undefined);
                setNoMatches(true);
                return;
            }
            request = [...new Set([settings.category, ...renderedSettings.measures, ...(settings.type === 'surface' ? SURFACE_SPLIT.filter(id => present.has(id)) : [])])];
        }
        void executor.chartData(revision, request, controller.signal).then(dataset => {
            if (controller.signal.aborted || version !== generation.current || JSON.stringify(dataset.revision) !== JSON.stringify(revision))
                return;
            const result = buildLinkedFigure(dataset, renderedSettings, theme);
            if (!result.ok && result.refused) {
                setCompleted(undefined);
                setError(undefined);
                setRefused(result.message);
                return;
            }
            setRefused(undefined);
            if (!result.ok) {
                setError(result.message);
                return;
            }
            setCompleted({ identity, dataset, settings: structuredClone(settings), renderedSettings, revision: JSON.stringify(revision) });
            setError(undefined);
        }).catch(e => { if (!controller.signal.aborted && version === generation.current) {
            setRefused(undefined);
            setError(`Could not load chart: ${e instanceof Error ? e.message : String(e)}`);
        } });
        return () => controller.abort();
        // Status-only failure transitions keep the completed schema, dataset and mapping together.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [store, dashboardId, card.id, source, mapping, active, view.ready]);
    const delivered = view.active && completed?.identity === identity ? completed : undefined;
    const built = useMemo(() => delivered ? buildLinkedFigure(delivered.dataset, delivered.renderedSettings, theme) : undefined, [delivered, theme]);
    const figure: PlotlyFigure | undefined = built?.ok ? built.figure : undefined;
    const notes = built?.ok ? built.notes : [];
    const lagging = delivered && (delivered.revision !== active || JSON.stringify(delivered.settings) !== mapping || view.status === 'updating' || view.stale || Boolean(error));
    async function commit(next: LinkedChartSettings) { setSaving(true); try {
        if (!await onSettingsChange(next))
            throw new Error('Chart settings could not be saved.');
        setSaveError(undefined);
    }
    catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
    }
    finally {
        setSaving(false);
    } }
    const columns = (delivered?.dataset.columns ?? view.ready?.columns ?? []);
    // Listed in the source's column order, so a measure keeps its place (expiries stay in term order) when it is unticked and ticked again.
    // A delivered column the source no longer offers stays next to the column it followed.
    const offered = view.ready?.chartColumns ?? view.ready?.columns ?? [];
    const byId = new Map([...columns, ...offered].map(c => [c.id, c]));
    const order = offered.map(c => c.id);
    columns.forEach((c, i) => { if (!order.includes(c.id)) order.splice(order.indexOf(columns[i - 1]?.id) + 1, 0, c.id); });
    const fields = order.map(id => byId.get(id)!);
    const pivoted = settings.type === 'surface' && isPivoted(offered);
    const values = reportValues(fields);
    // A report value: empty deletes the key. A new Height clears the ticked expiries, which belong to the old one (none ticked = all).
    const valueSelect = (key: 'height' | 'spaceRowsBy' | 'spaceColumnsBy', name: string, lead: string) => <label>{name}<select aria-label={name} disabled={saving} value={settings[key] ?? ''} onChange={e => { const next = { ...settings, [key]: e.target.value }; if (key === 'height') next.measures = []; if (!e.target.value)
        delete next[key]; void commit(next); }}><option value="">{lead}</option>{settings[key] && !values.some(v => v.id === settings[key]) ? <option value={settings[key]}>{settings[key]} (unavailable)</option> : null}{values.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>;
    return <div className="linked-chart-renderer" data-delivered-revision={delivered?.revision}>
    {!viewer ? <div className="chart-controls">
      <label>Chart type<select aria-label="Chart type" disabled={saving} value={settings.type} onChange={e => void commit(withType(settings, e.target.value as LinkedChartSettings['type'], hints, new Set(fields.map(c => c.id))))}><option value="column">Columns (vertical)</option><option value="bar">Bars (horizontal)</option><option value="line">Lines</option><option value="pie">Pie</option><option value="surface">Surface (3-D)</option></select></label>
      {pivoted ? <>{valueSelect('height', 'Height', 'Choose height')}{valueSelect('spaceRowsBy', 'Space rows by', 'Default')}{valueSelect('spaceColumnsBy', 'Space columns by', 'Default')}</> : <label>Category<select aria-label="Category" disabled={saving} value={settings.category ?? ''} onChange={e => void commit({ ...settings, category: e.target.value || undefined })}><option value="">Choose category</option>{settings.category && !fields.some(c => c.id === settings.category) ? <option value={settings.category}>{settings.category} (unavailable)</option> : null}{fields.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
      <MeasuresPicker disabled={saving} emptyMeansAll={pivoted} selected={settings.measures} onChange={measures => void commit({ ...settings, measures })} options={[...new Set([...(pivoted ? expiryColumns(fields, settings.height ?? '') : fields.filter(c => !c.dtype || c.dtype === 'number')).map(c => c.id), ...settings.measures])].map(id => { const field = fields.find(c => c.id === id); return field ? { id, label: pivoted && field.splitPath?.length ? field.splitPath.map(m => m.label ?? String(m.value)).join(' — ') : field.label } : { id, label: `${id} (unavailable)`, unavailable: true }; })}/>
      {settings.type === 'column' || settings.type === 'bar' ? <label>Display<select aria-label="Display" disabled={saving} value={settings.display} onChange={e => void commit({ ...settings, display: e.target.value as LinkedChartSettings['display'] })}><option value="grouped">Grouped</option><option value="stacked">Stacked</option><option value="percent">100% stacked</option></select></label> : null}
      {settings.type !== 'pie' && settings.type !== 'surface' ? <label>Series from<select aria-label="Series from" disabled={saving} value={settings.seriesFrom ?? 'columns'} onChange={e => void commit({ ...settings, seriesFrom: e.target.value as 'columns' | 'rows' })}><option value="columns">Columns</option><option value="rows">Rows</option></select></label> : null}
    </div> : null}
    <div className="linked-chart-status">
    {saveError ? <p role="alert">{saveError}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {lagging ? <p role="status">Updating chart — showing completed data (stale).</p> : null}
    {noMatches ? <p role="status">No selected series match the current filter.</p> : null}
    {refused ? <p role="status">{refused}</p> : null}
    {!figure && !error && !noMatches && !refused ? <p role="status">{view.status === 'pending' ? 'Loading…' : 'Choose chart fields'}</p> : null}
    {delivered ? <div role="status">{delivered.dataset.completeness.kind !== 'complete' ? <p>{delivered.dataset.completeness.kind} data</p> : null}{[...delivered.dataset.completeness.warnings, ...(delivered.dataset.diagnostics ?? []).map(d => d.message), ...(delivered.dataset.freshness.diagnostics ?? [])].map((warning, i) => <p key={i}>{warning}</p>)}{notes.map((note, i) => <p key={`n${i}`}>{note}</p>)}{delivered.dataset.provenance.sample ? <p>{delivered.dataset.provenance.sample}</p> : null}</div> : null}
    </div>
    {figure ? <div className="linked-chart-plot"><ChartRenderer data={figure} uirevision={String(figure.layout.uirevision)} /></div> : null}
  </div>;
}
