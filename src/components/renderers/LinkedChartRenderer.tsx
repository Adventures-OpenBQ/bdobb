// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ColumnSpec, DashboardCard } from '../../lib/types';
import type { LinkedChartSettings, WidgetDataset } from '../../lib/widgetData/types';
import { buildLinkedFigure, SURFACE_SPLIT } from '../../lib/widgetData/chartFigure';
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
        const available = new Map((view.ready.chartColumns ?? view.ready.columns).map(c => [c.id, c]));
        setNoMatches(false);
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
        const present = new Set(view.ready.columns.map(c => c.id));
        const renderedSettings = { ...settings, measures: settings.measures.filter(id => present.has(id)) };
        if (!renderedSettings.measures.length) {
            setCompleted(undefined);
            setRefused(undefined);
            setNoMatches(true);
            return;
        }
        void executor.chartData(revision, [...new Set([settings.category, ...renderedSettings.measures, ...(settings.type === 'surface' ? SURFACE_SPLIT.filter(id => present.has(id)) : [])])], controller.signal).then(dataset => {
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
    const fields = [...new Map([...columns, ...(view.ready?.chartColumns ?? view.ready?.columns ?? [])].map(c => [c.id, c])).values()];
    return <div className="linked-chart-renderer" data-delivered-revision={delivered?.revision}>
    {!viewer ? <div className="chart-controls">
      <label>Chart type<select aria-label="Chart type" disabled={saving} value={settings.type} onChange={e => void commit(withType(settings, e.target.value as LinkedChartSettings['type'], hints, new Set(fields.map(c => c.id))))}><option value="column">Columns (vertical)</option><option value="bar">Bars (horizontal)</option><option value="line">Lines</option><option value="pie">Pie</option><option value="surface">Surface (3-D)</option></select></label>
      <label>Category<select aria-label="Category" disabled={saving} value={settings.category ?? ''} onChange={e => void commit({ ...settings, category: e.target.value || undefined })}><option value="">Choose category</option>{settings.category && !fields.some(c => c.id === settings.category) ? <option value={settings.category}>{settings.category} (unavailable)</option> : null}{fields.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <fieldset disabled={saving}><legend>Measures</legend>{[...new Set([...fields.filter(c => !c.dtype || c.dtype === 'number').map(c => c.id), ...settings.measures])].map(id => <label key={id}><input type="checkbox" checked={settings.measures.includes(id)} onChange={e => void commit({ ...settings, measures: e.target.checked ? [...settings.measures, id] : settings.measures.filter(m => m !== id) })}/>{fields.find(c => c.id === id)?.label ?? `${id} (unavailable)`}</label>)}</fieldset>
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
