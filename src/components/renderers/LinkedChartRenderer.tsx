// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { ColumnSpec, DashboardCard } from '../../lib/types';
import type { LinkedChartSettings, WidgetDataset } from '../../lib/widgetData/types';
import { buildLinkedFigure, measureName, expiryColumns, isPivoted, reportValues, SURFACE_SPLIT } from '../../lib/widgetData/chartFigure';
import { bulletRequestIds } from '../../lib/widgetData/bulletFigure';
import { useSettingsStore } from '../../stores/settingsStore';
import { LABEL_FIELD } from '../../lib/pivotTable';
import { tableExecutionStore } from '../../stores/tableExecutionStore';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { ChartRenderer, type DrawingSurface } from './ChartRenderer';
import { DualAxisOverlayControls, LinkedDualAxisOverlay, overlayInputFields } from './LinkedDualAxisOverlay';
import { EstimateRevisionsControls, LinkedEstimateRevisions, estimateRevisionInputFields } from './LinkedEstimateRevisions';
import { LinkedMarketMap, MarketMapControls, marketMapInputFields } from './LinkedMarketMap';
import { useMeasuredRecipeJob } from './useMeasuredRecipe';
import { EtfSunburstControls, LinkedEtfSunburst, useEtfSunburstJob } from './LinkedEtfSunburst';
import type { PlotlyFigure } from '../../lib/chartShapes';
import type { ViewState } from '../../stores/tableExecutionStore';
import type { LocalWorkerExecutor, ChartResult, Revision } from '../../lib/tableExecution/types';
import type { DualAxisOverlayOptions, EstimateRevisionsOptions, EtfSunburstOptions, MarketMapOptions, NewsCalendarOptions, OwnershipSnapshotOptions, RecipeContext, RecipeOptions, RecipeResult, ReturnSummaryOptions } from '../../lib/widgetData/chartRecipes/types';
import { decodeLinkedChartRecipe, isRecipeType, requiredRecipeFields, withRecipeType } from '../../lib/widgetData/chartRecipes/settings';
import { bubblePriceDates, isIncomePeriodColumn, ownershipInputFields, savedBindingIssue } from '../../lib/widgetData/chartRecipes/bindings';
import { qualifiedSymbol, readFinancialEvidence } from '../../lib/widgetData/chartRecipes/financialEvidence';
import { admitDividendWindow, admitIncomeUnits, cohortIssue, screenerIssue } from '../../lib/widgetData/chartRecipes/financialAdmission';
import { incomeSankeyPeriodChoices } from '../../lib/widgetData/chartRecipes/incomeSankeyInput';
import { estimateRangeIdentityFields } from '../../lib/widgetData/chartRecipes/estimateEvidence';
import { acquiredWindow, documentedDailySnapshotMessage, hasDocumentedDailySnapshot, symbolList, observationSymbol } from '../../lib/widgetData/chartRecipes/priceEvidence';
import { newsCalendarPlotHeight, nextMultiplesWidth, ownershipPlotHeight, ownershipPlotWidth, recipePlotHeight, returnSummaryPlotHeight, returnSummaryPlotWidth } from '../../lib/widgetData/chartRecipes/viewport';
import type { OwnershipSnapshotDetails } from '../../lib/widgetData/chartRecipes/ownershipSnapshot';
import { ownershipMeasureText } from '../../lib/widgetData/chartRecipes/ownershipSnapshotDisplay';
import type { ReturnSummaryDetails } from '../../lib/widgetData/chartRecipes/returnSummary';
import { returnPercent, scaledReturnTicks } from '../../lib/widgetData/chartRecipes/returnSummaryDisplay';
import type { NewsCalendarDay } from '../../lib/widgetData/chartRecipes/newsCalendar';
import { createRecipeWorker } from '../../lib/widgetData/chartRecipes/workerClient';
import { todayLocal } from '../../lib/calendarView';
import { LinkedChartRecipeControls, OwnershipRecipeControls, recipeAvailability, recipeLabels, type SourceChoiceKind } from './LinkedChartRecipeControls';
import { LinkedParametersPortal, OpenLinkedParameters } from './LinkedParametersPortal';

function revisionKey({ widgetId, input, model, output }: Revision) {
    return JSON.stringify([widgetId, input, model, output]);
}

function recipeInputFields(options: RecipeOptions, ready: NonNullable<ViewState['ready']>) {
    let fields = requiredRecipeFields(options);
    if ((options.kind === 'dividend-steps' || options.kind === 'news-sentiment-calendar') && ready.topLevelCount === 0)
        fields = fields.filter(field => ready.columns.some(column => column.id === field));
    if (options.kind === 'ownership-snapshot') {
        // Let the recipe prioritize source or partition repair before checking unavailable bindings.
        fields = fields.filter(field => ready.columns.some(column => column.id === field));
        fields.push(...ownershipInputFields(ready.columns));
    }
    if (options.kind === 'estimate-range') fields.push(...estimateRangeIdentityFields(ready.columns));
    return [...new Set(fields)];
}

/**
 * A type change drops the settings the new type cannot use. Picking Surface with no fields chosen takes them from
 * the source widget's chartDataType hints (the first time or category column, every series column), where offered.
 */
function withType(settings: LinkedChartSettings, type: LinkedChartSettings['type'], hints: ColumnSpec[] = [], offered: ReadonlySet<string> = new Set()): LinkedChartSettings {
    const next = { ...settings, type, display: settings.display === 'percent' && type !== 'column' && type !== 'bar' ? 'stacked' as const : settings.display };
    if (type === 'pie' || type === 'waterfall' || type === 'surface')
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
type LinkedChartProps = {
    dashboardId: string;
    card: DashboardCard;
    refreshKey: number;
    viewer?: boolean;
    parametersTarget: HTMLElement | null;
    hints?: ColumnSpec[];
    onOpenParameters: () => void;
    parentReportsSourceStatus?: boolean;
    store?: typeof tableExecutionStore;
    sourceAncestry?: string[];
    sourceAcquisitionKey?: string;
    readCurrentSource?: () => { view: ViewState; executor?: LocalWorkerExecutor; sourceCurrent: boolean; card?: DashboardCard };
    onSettingsChange: (settings: LinkedChartSettings, guard?: () => boolean) => Promise<boolean>;
};
export function LinkedChartRenderer(props: LinkedChartProps) {
    const type = props.card.linkedChart?.type;
    const source = type === 'bullet' || type === 'waterfall' ? props.card.linkedSource?.sourceWidgetId : undefined;
    return <LinkedChartView key={JSON.stringify([props.dashboardId, props.card.id, source])} {...props}/>;
}

function LinkedChartView({ dashboardId, card, refreshKey, viewer = false, hints = [], parametersTarget, onOpenParameters, parentReportsSourceStatus = false, store = tableExecutionStore, sourceAncestry, sourceAcquisitionKey, readCurrentSource, onSettingsChange }: LinkedChartProps) {
    const view = useSyncExternalStore(store.subscribe, () => store.readView(dashboardId, card.id));
    const theme = useResolvedTheme();
    const maxDecimals = useSettingsStore(s => s.settings.maxDecimalPlaces);
    const settings = card.linkedChart!;
    const source = card.linkedSource?.sourceWidgetId;
    const carried = settings.type === 'bullet' || settings.type === 'waterfall';
    const identity = JSON.stringify([dashboardId, card.id]);
    const recipe = useMemo(() => decodeLinkedChartRecipe(settings, settings.type), [settings]);
    const mapping = recipe ? JSON.stringify([settings.type, recipe]) : JSON.stringify(settings);
    const editScope = JSON.stringify([identity, source, mapping]);
    const [draft, setDraft] = useState<{ scope: string; kind: RecipeOptions['kind'] }>();
    const editing = !viewer && draft?.scope === editScope ? draft.kind : settings.type;
    const financial = isRecipeType(editing);
    const legacy = !recipe;
    const executor = source ? store.readExecutor(dashboardId, source) : undefined;
    const presented = view.sourceRevision?.widgetId === source ? view.ready?.columns ?? [] : [];
    const loadSymbols = useCallback(async (field: string | undefined, signal: AbortSignal) => {
        const revision = view.sourceRevision;
        if (!executor || !revision || revision.widgetId !== source || !view.ready || !['ready', 'empty'].includes(view.status))
            throw new Error('Wait for the selected source table to finish loading.');
        if (field && !view.ready.columns.some(c => c.id === field)) throw new Error('Repair the unavailable symbol field.');
        const data = await executor.chartData(revision, field ? [field] : [], signal);
        signal.throwIfAborted();
        if (revisionKey(data.revision) !== revisionKey(revision)) throw new Error('Source changed. Reload the symbol choices.');
        const evidence = data.provenance.metadata;
        if (typeof evidence?.priceDimensionIssue === 'string') throw new Error(evidence.priceDimensionIssue);
        if (evidence?.priceDimensionsChecked !== true) throw new Error('The source cannot verify its price symbol identity. Use a documented daily snapshot.');
        if (!field) {
            const declared = symbolList(data.provenance);
            return declared?.length === 1 ? declared : [];
        }
        const symbols = new Set<string>();
        for (const row of data.rows) {
            const symbol = !row.cellErrors?.[field] && observationSymbol(row.values[field]);
            if (symbol) symbols.add(symbol);
        }
        return [...symbols].sort();
    }, [executor, source, view.ready, view.sourceRevision, view.status]);
    const chartChoicesInput = useCallback(async (fields: (ready: NonNullable<ViewState['ready']>) => string[], signal: AbortSignal) => {
        const revision = view.sourceRevision;
        const ready = view.ready;
        if (!executor || !revision || revision.widgetId !== source || !ready || !['ready', 'empty'].includes(view.status)) {
            const pending = view.status === 'pending' || view.status === 'updating';
            throw new Error(pending ? 'Wait for the selected source table to finish loading.'
                : 'Fix the source or choose another table to load chart choices.');
        }
        const data = await executor.chartData(revision, fields(ready), signal);
        signal.throwIfAborted();
        if (revisionKey(data.revision) !== revisionKey(revision) || data.resultRevision !== revision.model || data.outputRevision !== revision.output)
            throw new Error('The selected source revision changed. Reload the chart choices.');
        return data;
    }, [executor, source, view.ready, view.sourceRevision, view.status]);
    const loadNewsInput = useCallback((signal: AbortSignal) => chartChoicesInput(() => [], signal), [chartChoicesInput]);
    const loadNewsDraft = useCallback((options: NewsCalendarOptions, signal: AbortSignal) =>
        chartChoicesInput(ready => recipeInputFields(options, ready), signal), [chartChoicesInput]);
    const loadReturnDraft = useCallback((options: ReturnSummaryOptions, signal: AbortSignal) =>
        chartChoicesInput(ready => recipeInputFields(options, ready), signal), [chartChoicesInput]);
    const loadOwnershipInput = useCallback((signal: AbortSignal) =>
        chartChoicesInput(() => [], signal), [chartChoicesInput]);
    const loadOwnershipDraft = useCallback((options: OwnershipSnapshotOptions, signal: AbortSignal) =>
        chartChoicesInput(ready => recipeInputFields(options, ready), signal), [chartChoicesInput]);
    const loadReturnListings = useCallback(async (field: string | undefined, signal: AbortSignal) => {
        const data = await chartChoicesInput(() => field ? [field] : [], signal);
        if (!hasDocumentedDailySnapshot(data.provenance)) throw new Error(documentedDailySnapshotMessage);
        const issue = data.provenance.metadata?.priceDimensionIssue;
        if (typeof issue === 'string') throw new Error(issue);
        const declared = symbolList(data.provenance);
        if (!field) return declared?.length === 1 ? declared.filter(qualifiedSymbol) : [];
        const values = data.rows.flatMap(row => {
            const value = row.cellErrors?.[field] ? undefined : observationSymbol(row.values[field]);
            return qualifiedSymbol(value) ? [value] : [];
        });
        return [...new Set(values)].sort();
    }, [chartChoicesInput]);
    const [draftWidth, setDraftWidth] = useState<number>();
    const newsDraftProbe = useRef<HTMLDivElement | null>(null);
    const readNewsDraftWidth = useCallback(() => {
        const width = newsDraftProbe.current?.clientWidth;
        return width || undefined;
    }, []);
    const observeNewsDraftWidth = useCallback((viewport: HTMLDivElement | null) => {
        if (!viewport) return;
        newsDraftProbe.current = viewport;
        const measure = () => setDraftWidth(readNewsDraftWidth());
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(viewport);
        return () => {
            observer.disconnect();
            newsDraftProbe.current = null;
            setDraftWidth(undefined);
        };
    }, [readNewsDraftWidth]);
    const today = todayLocal();
    const matchesNewsDraftWidth = () => draftWidth !== undefined && readNewsDraftWidth() === draftWidth;
    const newsDraftContext = useMemo<RecipeContext | undefined>(() => draftWidth === undefined
        ? undefined : { theme, maxDecimals, today, viewportWidth: Math.min(draftWidth, 10_000) }, [theme, maxDecimals, today, draftWidth]);
    const measuredDraftContext = useMemo<RecipeContext>(() => ({ theme, maxDecimals, today }), [theme, maxDecimals, today]);
    const etfForm = editing === 'etf-sunburst';
    const etfChart = settings.type === 'etf-sunburst';
    const overlayForm = editing === 'dual-axis-overlay';
    const overlayChart = settings.type === 'dual-axis-overlay';
    const revisionsForm = editing === 'estimate-revisions';
    const revisionsChart = settings.type === 'estimate-revisions';
    const acquiredScope = JSON.stringify([editScope, sourceAncestry, sourceAcquisitionKey]);
    const marketForm = editing === 'market-map';
    const marketChart = settings.type === 'market-map';
    const revisionsScope = JSON.stringify([identity, source, sourceAncestry, sourceAcquisitionKey]);
    const readFallbackSource = useCallback(() => {
        const current = store.readView(dashboardId, card.id);
        return { view: current, executor: source ? store.readExecutor(dashboardId, source) : undefined,
            sourceCurrent: current.status === 'ready' || current.status === 'empty', card };
    }, [store, dashboardId, card, source]);
    // Saving card chrome must not replace the active source-reading job.
    const readAcquiredSource = readCurrentSource ?? readFallbackSource;
    const etfJob = useEtfSunburstJob((etfChart || etfForm) && readAcquiredSource().sourceCurrent,
        view, executor, source, readAcquiredSource);
    const overlayJob = useMeasuredRecipeJob((overlayChart || overlayForm) && readAcquiredSource().sourceCurrent,
        view, executor, source, readAcquiredSource, overlayInputFields, 'prepared overlay');
    const revisionsJob = useMeasuredRecipeJob<EstimateRevisionsOptions>(
        (revisionsChart || revisionsForm) && readAcquiredSource().sourceCurrent, view, executor, source, readAcquiredSource,
        estimateRevisionInputFields, 'estimate history');
    const marketJob = useMeasuredRecipeJob<MarketMapOptions>(
        (marketChart || marketForm) && readAcquiredSource().sourceCurrent, view, executor, source, readAcquiredSource, marketMapInputFields, 'market-map');
    const loadSourceChoices = useCallback(async (kind: SourceChoiceKind, dateField: string | undefined, signal: AbortSignal) => {
        const data = await chartChoicesInput(ready => kind === 'income-sankey' ? ready.columns.filter(isIncomePeriodColumn).map(column => column.id)
            : kind === 'bubble-regression' && dateField && ready.columns.some(column => column.id === dateField) ? [dateField] : [], signal);
        const evidence = readFinancialEvidence(data.provenance);
        if (kind === 'income-sankey') {
            if (evidence?.kind !== 'income') return [];
            const units = admitIncomeUnits(evidence);
            if (!units.ok) throw new Error(units.message);
            return incomeSankeyPeriodChoices(data).map(period => ({
                value: period.columnId, issue: period.issue,
                label: [`${period.kind}${period.fiscalYear ? ' ' + period.fiscalYear : ''}`,
                    period.kind === 'FQ' ? period.fiscalPeriod : null, period.end].filter(Boolean).join(' · '),
            }));
        }
        if (kind === 'bubble-regression') {
            if (evidence?.kind !== 'screener') throw new Error('Acquire screening data with a validated screener receipt.');
            const issue = screenerIssue(evidence);
            if (issue) throw new Error(issue);
            const cohorts = new Map(evidence.cohorts.map(cohort => [cohort.price_date, cohort]));
            return dateField ? bubblePriceDates(data, dateField).map(value => {
                const cohort = cohorts.get(value);
                return { value, label: value, issue: cohort ? cohortIssue(cohort) : 'Choose a presented date from the acquired screener page.' };
            }) : [];
        }
        if (evidence?.kind !== 'dividends') return [];
        const admission = admitDividendWindow(evidence);
        return [{ value: evidence.qualified_symbol, label: evidence.qualified_symbol, verifiedEmpty: admission.ok && evidence.raw_count === 0
            && !data.rows.length && !data.provenance.inputMayContainAggregates, issue: admission.ok ? undefined : admission.message }];
    }, [chartChoicesInput]);
    const columnless = !viewer && !!view.ready && view.ready.topLevelCount === 0 && !presented.length;
    const [emptyProof, setEmptyProof] = useState<typeof loadSourceChoices>();
    useEffect(() => {
        if (!columnless) return;
        const controller = new AbortController();
        void loadSourceChoices('dividend-steps', undefined, controller.signal).then(choices => {
            if (!controller.signal.aborted && choices.some(choice => 'verifiedEmpty' in choice && choice.verifiedEmpty))
                setEmptyProof(() => loadSourceChoices);
        }).catch(() => { /* An unavailable source cannot certify an empty acquisition. */ });
        return () => controller.abort();
    }, [columnless, loadSourceChoices]);
    const verifiedEmpty = columnless && emptyProof === loadSourceChoices;
    const active = JSON.stringify(view.sourceRevision);
    const quarterScope = JSON.stringify([identity, source, active, settings.category]);
    const [completed, setCompleted] = useState<Completed>();
    const [quarterChoices, setQuarterChoices] = useState<{ scope: string; values: string[] }>();
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
        if (!legacy) {
            setCompleted(undefined); setError(undefined); setRefused(undefined); setNoMatches(false);
            return;
        }
        const controller = new AbortController();
        const revision = view.sourceRevision;
        const executor = source ? store.readExecutor(dashboardId, source) : undefined;
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
            request = [...new Set([settings.category, ...renderedSettings.measures, ...(settings.type === 'surface' ? SURFACE_SPLIT.filter(id => present.has(id)) : []), ...(settings.type === 'bullet' ? bulletRequestIds(renderedSettings.measures, view.ready.columns) : [])])];
        }
        void executor.chartData(revision, request, controller.signal).then(dataset => {
            if (controller.signal.aborted || version !== generation.current || JSON.stringify(dataset.revision) !== JSON.stringify(revision))
                return;
            if (settings.type === 'bullet' && settings.category) {
                const values = [...new Set(dataset.rows.map(row => String(row.values[settings.category!] ?? '')).filter(Boolean))];
                setQuarterChoices({ scope: quarterScope, values });
            }
            const result = buildLinkedFigure(dataset, renderedSettings, theme, maxDecimals);
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
    }, [store, dashboardId, card.id, source, mapping, active, view.ready, legacy]);
    const delivered = legacy && completed?.identity === identity ? completed : undefined;
    const built = useMemo(() => delivered ? buildLinkedFigure(delivered.dataset, delivered.renderedSettings, theme, maxDecimals) : undefined, [delivered, theme, maxDecimals]);
    const figure = useMemo<PlotlyFigure | undefined>(() => {
        if (!built?.ok) return undefined;
        return carried ? { ...built.figure, layout: { ...built.figure.layout, uirevision: JSON.stringify([source, built.revision]) } } : built.figure;
    }, [built, carried, source]);
    const notes = built?.ok ? built.notes : [];
    const lagging = delivered && (delivered.revision !== active || JSON.stringify(delivered.settings) !== mapping || view.status === 'updating' || view.stale || Boolean(error));
    async function commit(next: LinkedChartSettings, guard?: () => boolean) {
        if (viewer || saving) return;
        setSaving(true); try {
        const validated = decodeLinkedChartRecipe(next, next.type);
        if (validated && !validated.ok) throw new Error(validated.message);
        const sourceLabel = next.type === 'market-map' ? 'market-map' : next.type === 'estimate-revisions' ? 'estimate history' : next.type === 'dual-axis-overlay' ? 'prepared overlay' : next.type === 'etf-sunburst' ? 'ETF holdings' : 'chart';
        const sourceChanged = `The ${sourceLabel} source or drawing size changed. Review the settings and try again.`;
        if (guard && !guard()) throw new Error(sourceChanged);
        const committed = guard ? await onSettingsChange(next, guard) : await onSettingsChange(next);
        if (!committed) throw new Error(guard ? sourceChanged : 'Chart settings could not be saved.');
        setSaveError(undefined); setDraft(undefined);
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
    const quarters = quarterChoices?.scope === quarterScope ? quarterChoices.values : [];
    function applyAcquired(options: OwnershipSnapshotOptions | ReturnSummaryOptions | NewsCalendarOptions, matchesDrawing?: () => boolean) {
        const stillCurrent = () => {
            const current = readAcquiredSource();
            return matchesDrawing?.() === true && !!source && current.sourceCurrent
                && current.executor === executor && current.view.ready === view.ready
                && !!current.view.sourceRevision && !!view.sourceRevision
                && revisionKey(current.view.sourceRevision) === revisionKey(view.sourceRevision)
                && JSON.stringify(current.card?.linkedChart) === JSON.stringify(settings);
        };
        void commit({ ...withRecipeType(settings, options.kind), recipe: options }, stillCurrent);
    }
    function applyEtf(options: EtfSunburstOptions, current: () => boolean) {
        const canSave = () => current() && JSON.stringify(readAcquiredSource().card?.linkedChart) === JSON.stringify(settings);
        void commit({ ...withRecipeType(settings, options.kind), recipe: options }, canSave);
    }
    function applyClosedRecipe(options: DualAxisOverlayOptions | EstimateRevisionsOptions | MarketMapOptions, current: () => boolean) {
        const canSave = () => current() && JSON.stringify(readAcquiredSource().card?.linkedChart) === JSON.stringify(settings);
        void commit({ type: options.kind, measures: [], display: 'grouped', recipe: options }, canSave);
    }
    const ownershipForm = editing === 'ownership-snapshot';
    const ownershipChart = settings.type === 'ownership-snapshot';
    const returnForm = editing === 'return-summary';
    const returnChart = settings.type === 'return-summary';
    const basicAcquiredChart = ownershipChart || returnChart || settings.type === 'news-sentiment-calendar';
    const basicAcquiredForm = ownershipForm || returnForm || editing === 'news-sentiment-calendar';
    const awaitingSync = (basicAcquiredChart || basicAcquiredForm) && (view.status === 'ready' || view.status === 'empty')
        && !readAcquiredSource().sourceCurrent;
    // Draft probes measure this drawing body even while their settings are hidden.
    const [probeTarget, setProbeTarget] = useState<HTMLDivElement | null>(null);
    const openRepair = viewer ? undefined : onOpenParameters;
    const needsFieldRepair = legacy && (error || refused || noMatches
        || (!figure && !(carried && view.error) && view.status !== 'pending' && view.status !== 'updating'));
    return <div ref={setProbeTarget} data-delivered-revision={delivered?.revision} className={'linked-chart-renderer'
      + (editing === 'news-sentiment-calendar' ? ' linked-chart-renderer--news' : '')
      + (returnForm || returnChart ? ' linked-chart-renderer--return' : '')
      + (ownershipForm || ownershipChart ? ' linked-chart-renderer--ownership' : '')
      + (etfForm || etfChart ? ' linked-chart-renderer--etf' : '')
      + (overlayForm || overlayChart ? ' linked-chart-renderer--overlay' : '')
      + (revisionsForm || revisionsChart ? ' linked-chart-renderer--revisions' : '')
      + (marketForm || marketChart ? ' linked-chart-renderer--market' : '')}>
    {!viewer && editing === 'news-sentiment-calendar' && <div aria-hidden="true"
      className="chart-scroll-viewport--measured news-calendar-width-probe" ref={observeNewsDraftWidth}/>}
    {!viewer ? <LinkedParametersPortal target={parametersTarget}><div className="chart-controls">
      <label>Chart type<select aria-label="Chart type" disabled={saving} value={editing} onChange={e => {
        const type = e.target.value as LinkedChartSettings['type'];
        if (isRecipeType(type)) {
          if (!recipeAvailability(type, presented, verifiedEmpty)) setDraft({ scope: editScope, kind: type });
          return;
        }
        if (type === settings.type) { setDraft(undefined); return; }
        const next = withType(withRecipeType(settings, type), type, hints, new Set(fields.map(c => c.id)));
        void commit(type === 'bullet' && !next.category && fields.some(c => c.id === 'fiscal_period') ? { ...next, category: 'fiscal_period' } : next);
      }}><option value="column">Columns (vertical)</option><option value="bar">Bars (horizontal)</option><option value="line">Lines</option><option value="pie">Pie</option><option value="bullet">Bullet</option><option value="waterfall">Waterfall</option><option value="surface">Surface (3-D)</option>
      {Object.entries(recipeLabels).map(([kind, label]) => {
        const issue = recipeAvailability(kind as RecipeOptions['kind'], presented, verifiedEmpty);
        return <option key={kind} value={kind} disabled={!!issue}>{label}{issue ? ' — ' + issue : ''}</option>;
      })}</select></label>
      {basicAcquiredForm && awaitingSync ? null : marketForm ? <MarketMapControls probeTarget={probeTarget} key={acquiredScope} job={marketJob} context={measuredDraftContext}
        disabled={saving} saved={recipe?.ok && recipe.options.kind === 'market-map' ? recipe.options : undefined}
        onApply={applyClosedRecipe}/> : revisionsForm ? <EstimateRevisionsControls probeTarget={probeTarget} key={acquiredScope} job={revisionsJob} context={measuredDraftContext}
        disabled={saving} saved={recipe?.ok && recipe.options.kind === 'estimate-revisions' ? recipe.options : undefined}
        onApply={applyClosedRecipe}/> : overlayForm ? <DualAxisOverlayControls probeTarget={probeTarget} key={acquiredScope} job={overlayJob} context={measuredDraftContext}
        disabled={saving} saved={recipe?.ok && recipe.options.kind === 'dual-axis-overlay' ? recipe.options : undefined}
        onApply={applyClosedRecipe}/> : etfForm ? <EtfSunburstControls probeTarget={probeTarget} key={acquiredScope} job={etfJob} context={measuredDraftContext}
        disabled={saving} saved={recipe?.ok && recipe.options.kind === 'etf-sunburst' ? recipe.options : undefined}
        onApply={applyEtf}/> : ownershipForm ? <OwnershipRecipeControls probeTarget={probeTarget} key={acquiredScope} columns={presented}
        loadInput={loadOwnershipInput} loadDraft={loadOwnershipDraft} context={measuredDraftContext}
        disabled={saving} saved={recipe?.ok && recipe.options.kind === editing ? recipe.options : undefined}
        onApply={applyAcquired}/> : financial ? <LinkedChartRecipeControls probeTarget={probeTarget} key={JSON.stringify([editing === 'news-sentiment-calendar' || returnForm ? acquiredScope : editScope, editing])} kind={editing}
        columns={presented} verifiedEmpty={verifiedEmpty} loadSymbols={loadSymbols} loadSourceChoices={loadSourceChoices} loadNewsInput={loadNewsInput}
        loadNewsDraft={loadNewsDraft} newsDraftContext={newsDraftContext} matchesNewsDraftWidth={matchesNewsDraftWidth}
        loadReturnListings={loadReturnListings} loadReturnDraft={loadReturnDraft} returnDraftContext={measuredDraftContext}
        disabled={saving} saved={recipe?.ok && recipe.options.kind === editing ? recipe.options : undefined}
        onApply={(options, matchesDrawing) => options.kind === 'news-sentiment-calendar' || options.kind === 'return-summary'
          ? applyAcquired(options, matchesDrawing) : void commit({ ...withRecipeType(settings, options.kind), recipe: options })}/> : <>
      {pivoted ? <>{valueSelect('height', 'Height', 'Choose height')}{valueSelect('spaceRowsBy', 'Space rows by', 'Default')}{valueSelect('spaceColumnsBy', 'Space columns by', 'Default')}</> : <label>Category<select aria-label="Category" disabled={saving} value={settings.category ?? ''} onChange={e => void commit({ ...settings, category: e.target.value || undefined })}><option value="">Choose category</option>{settings.category && !fields.some(c => c.id === settings.category) ? <option value={settings.category}>{settings.category} (unavailable)</option> : null}{fields.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
      <MeasuresPicker disabled={saving} emptyMeansAll={pivoted} selected={settings.measures} onChange={measures => void commit({ ...settings, measures })} options={[...new Set([...(pivoted ? expiryColumns(fields, settings.height ?? '') : fields.filter(c => (!c.dtype || c.dtype === 'number') && (settings.type !== 'bullet' || c.id.endsWith('_actual')))).map(c => c.id), ...settings.measures])].map(id => { const field = fields.find(c => c.id === id); return field ? { id, label: pivoted && field.splitPath?.length ? field.splitPath.map(m => m.label ?? String(m.value)).join(' — ') : measureName(field) } : { id, label: `${id} (unavailable)`, unavailable: true }; })}/>
      {settings.type === 'bullet' ? <label>Quarter<select aria-label="Quarter" disabled={saving} value={settings.period ?? ''} onChange={e => { const { period: _drop, ...rest } = settings; void commit(e.target.value ? { ...rest, period: e.target.value } : rest); }}><option value="">Latest</option>{settings.period && !quarters.includes(settings.period) ? <option value={settings.period}>{settings.period} (unavailable)</option> : null}{quarters.map(q => <option key={q} value={q}>{q}</option>)}</select></label> : null}
      {settings.type === 'column' || settings.type === 'bar' ? <label>Display<select aria-label="Display" disabled={saving} value={settings.display} onChange={e => void commit({ ...settings, display: e.target.value as LinkedChartSettings['display'] })}><option value="grouped">Grouped</option><option value="stacked">Stacked</option><option value="percent">100% stacked</option></select></label> : null}
      {settings.type !== 'pie' && settings.type !== 'bullet' && settings.type !== 'waterfall' && settings.type !== 'surface' ? <label>Series from<select aria-label="Series from" disabled={saving} value={settings.seriesFrom ?? 'columns'} onChange={e => void commit({ ...settings, seriesFrom: e.target.value as 'columns' | 'rows' })}><option value="columns">Columns</option><option value="rows">Rows</option></select></label> : null}
      </>}
    </div></LinkedParametersPortal> : null}
    <div className="linked-chart-status">
    {saveError ? <p role="alert">{saveError}</p> : null}
    {!isRecipeType(settings.type) && recipe && !recipe.ok && <p role="status">{recipe.message}</p>}
    {legacy && error ? <p role="alert">{error}</p> : null}
    {lagging ? <p role="status">Updating chart — showing completed data (stale).</p> : null}
    {legacy && noMatches ? <p role="status">No selected series match the current filter.</p> : null}
    {legacy && refused ? <p role="status">{refused}</p> : null}
    {legacy && !figure && !error && !(carried && view.error) && !noMatches && !refused ? <p role="status">{carried && source && (view.sourceRevision?.widgetId !== source || view.status === 'pending' || view.status === 'updating') ? `Loading source ${source}…` : view.status === 'pending' ? 'Loading…' : 'Choose chart fields'}</p> : null}
    {(needsFieldRepair || (recipe && !recipe.ok)) &&
      <OpenLinkedParameters onOpen={openRepair}/>}
    {delivered ? <DatasetStatus dataset={delivered.dataset} notes={notes} source={carried ? source : undefined}/> : null}
    </div>
    {isRecipeType(settings.type) && (recipe?.ok
      ? (recipe.options.kind === 'market-map'
        ? <LinkedMarketMap key={acquiredScope} view={view} job={marketJob} options={recipe.options}
            context={measuredDraftContext} parentReportsSourceStatus={parentReportsSourceStatus} onOpenParameters={openRepair}/>
        : recipe.options.kind === 'etf-sunburst'
        ? <LinkedEtfSunburst key={acquiredScope} view={view} job={etfJob} options={recipe.options} sourceId={source}
            context={measuredDraftContext} parentReportsSourceStatus={parentReportsSourceStatus} onOpenParameters={openRepair}/>
        : recipe.options.kind === 'dual-axis-overlay'
          ? <LinkedDualAxisOverlay key={acquiredScope} view={view} job={overlayJob} options={recipe.options}
              context={measuredDraftContext} parentReportsSourceStatus={parentReportsSourceStatus} onOpenParameters={openRepair}/>
          : recipe.options.kind === 'estimate-revisions'
            ? <LinkedEstimateRevisions key={revisionsScope} view={view} job={revisionsJob} options={recipe.options}
                context={measuredDraftContext} parentReportsSourceStatus={parentReportsSourceStatus} onOpenParameters={openRepair}/>
            : basicAcquiredChart && awaitingSync ? <p role="status">Waiting for the source to synchronize.</p>
            : <FinancialChart key={basicAcquiredChart ? acquiredScope : editScope} parentReportsSourceStatus={parentReportsSourceStatus} onOpenParameters={openRepair} view={view} executor={executor} source={source} options={recipe.options} theme={theme} maxDecimals={maxDecimals}/>)
      : <p role="status">{recipe && !recipe.ok ? recipe.message : 'Choose recipe field bindings.'}{!recipe && <> <OpenLinkedParameters onOpen={openRepair}/></>}</p>)}
    {figure ? <div className="linked-chart-plot"><ChartRenderer data={figure} uirevision={String(figure.layout.uirevision)} /></div> : null}
  </div>;
}

function DatasetStatus({ dataset, notes, source, showCompleteness = true }: { dataset: WidgetDataset; notes: string[]; source?: string; showCompleteness?: boolean }) {
  const bounds = acquiredWindow(dataset.provenance);
  const { freshness, completeness } = dataset;
  return <div role="status">
    {source && <p>Source {source} · {dataset.rows.length} presented {dataset.rows.length === 1 ? 'row' : 'rows'} · {freshness.availability}{freshness.stale ? ' (stale)' : ''}
      {freshness.lastSuccessAt !== undefined && ' · Last success ' + new Date(freshness.lastSuccessAt).toLocaleString()}
      {bounds && ' · Acquisition ' + bounds.start + ' to ' + bounds.end}</p>}
    {showCompleteness && completeness.kind !== 'complete' && <p>{completeness.kind} data</p>}
    {[...completeness.warnings, ...(dataset.diagnostics ?? []).map(d => d.message), ...(freshness.diagnostics ?? []), ...notes].map((text, i) => <p key={i}>{text}</p>)}
    {freshness.error && <p>{freshness.error}</p>}
    {dataset.provenance.sample && <p>{dataset.provenance.sample}</p>}
  </div>;
}

type FinancialProps = {
  view: ViewState; source?: string; executor?: LocalWorkerExecutor; options: RecipeOptions;
  theme: 'dark' | 'light'; maxDecimals: number; parentReportsSourceStatus: boolean; onOpenParameters?: () => void;
};
function FinancialChart(props: FinancialProps) {
  const { source, view, executor, options } = props;
  if (!source || view.status === 'unavailable' || !executor || !view.sourceRevision || !view.ready || view.sourceRevision.widgetId !== source) {
    if (view.error) return props.parentReportsSourceStatus ? null : <p role="alert">{view.error}</p>;
    return <p role="status">{source ? `Loading source ${source}…` : 'Select an available source table.'}</p>;
  }
  const emptyAllowed = (options.kind === 'dividend-steps' || options.kind === 'news-sentiment-calendar') && view.ready.topLevelCount === 0;
  const issue = emptyAllowed ? undefined : savedBindingIssue(options, view.ready.columns);
  if (issue) return <><p role="alert">{issue}</p><OpenLinkedParameters onOpen={props.onOpenParameters}/></>;
  const completeness = view.ready.completeness.kind;
  switch (options.kind) {
    case 'drawdown': case 'yield-curve': case 'monthly-returns': case 'correlation':
    case 'return-distribution': case 'small-multiples':
      if (completeness !== 'complete' && completeness !== 'bounded')
        return <><p role="status">The source must be fully loaded. Acquisition is {completeness}.</p><OpenLinkedParameters onOpen={props.onOpenParameters}/></>;
  }
  return <WorkerChart {...props} source={source} executor={executor} ready={view.ready} revision={view.sourceRevision}/>;
}

/** Mounted for one saved question. Keep its last completed figure through a transient refresh failure. */
function WorkerChart({ view, source, executor, ready, revision, options, theme, maxDecimals, parentReportsSourceStatus, onOpenParameters }: FinancialProps & {
  source: string; executor: LocalWorkerExecutor; ready: NonNullable<ViewState['ready']>; revision: NonNullable<ViewState['sourceRevision']>;
}) {
  const worker = useRef<ReturnType<typeof createRecipeWorker> | undefined>(undefined);
  useEffect(() => {
    worker.current = createRecipeWorker();
    return () => { worker.current?.dispose(); worker.current = undefined; };
  }, [worker]);
  const [loaded, setLoaded] = useState<{ ready: typeof ready; data: ChartResult }>();
  const [completed, setCompleted] = useState<{ data: ChartResult; result: RecipeResult; context: string }>();
  const [readError, setReadError] = useState<string>();
  const [workerError, setWorkerError] = useState<string>();
  const today = todayLocal();
  const sankey = options.kind === 'income-sankey';
  const news = options.kind === 'news-sentiment-calendar';
  const [width, setWidth] = useState(sankey ? 390 : 900);
  const [newsWidth, setNewsWidth] = useState<number>();
  const returns = options.kind === 'return-summary';
  const ownership = options.kind === 'ownership-snapshot';
  const measured = returns || ownership;
  const [drawingSize, setDrawingSize] = useState<DrawingSurface>();
  const measureDrawing = useCallback(({ width, height }: DrawingSurface) => {
    setDrawingSize(previous => previous?.width === width && previous.height === height ? previous : { width, height });
  }, []);
  const measureSankey = useCallback((width: number) => setWidth(Math.min(width, 10_000)), []);
  const measureNews = useCallback((width: number) => setNewsWidth(Math.min(width, 10_000)), []);
  const panels = options.kind === 'small-multiples' ? options.symbols.length : 0;
  const observePlot = useCallback((element: HTMLDivElement | null) => {
    if (!element || panels < 2) return;
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box) setWidth(current => nextMultiplesWidth(current, box.width, panels));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [panels]);
  const viewportWidth = news ? newsWidth : measured ? drawingSize?.width : panels || sankey ? width : undefined;
  const viewportHeight = measured ? drawingSize?.height : undefined;
  const context = JSON.stringify([theme, maxDecimals, today, viewportWidth, viewportHeight]);
  const mapping = JSON.stringify(options);
  const active = revisionKey(revision);
  const available = view.status === 'ready' || view.status === 'empty';
  useEffect(() => {
    if (!available) return;
    const controller = new AbortController();
    setReadError(undefined);
    void executor.chartData(revision, recipeInputFields(options, ready), controller.signal).then(data => {
      if (controller.signal.aborted) return;
      if (revisionKey(data.revision) !== active || data.resultRevision !== revision.model || data.outputRevision !== revision.output)
        throw new Error('The selected source revision changed. Refresh the chart.');
      setLoaded({ ready, data });
    }).catch(error => { if (!controller.signal.aborted) setReadError(error instanceof Error ? error.message : String(error)); });
    return () => controller.abort();
    // The serialized options and revision describe the requested snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, executor, ready, active, mapping]);
  const current = available && loaded?.ready === ready && revisionKey(loaded.data.revision) === active ? loaded.data : undefined;
  useEffect(() => {
    if (!current || !worker.current || (news && viewportWidth === undefined) || (measured && !drawingSize)) return;
    const controller = new AbortController();
    setWorkerError(undefined);
    void worker.current.run(current, options, { theme, maxDecimals, today, viewportWidth, viewportHeight }, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      // Two linked tables can present different scopes of one root acquisition.
      if (result.ok) {
        const revision = JSON.stringify([source, result.revision]);
        const figure = { ...result.figure, layout: { ...result.figure.layout, uirevision: revision } };
        setCompleted({ data: current, result: { ...result, figure, revision }, context });
      } else setCompleted({ data: current, result, context });
    }).catch(error => { if (!controller.signal.aborted) setWorkerError(error instanceof Error ? error.message : String(error)); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worker, current, mapping, context, source]);
  const error = readError ?? workerError ?? (parentReportsSourceStatus ? undefined : view.error);
  const stale = completed?.result.ok && (!available || view.stale || completed.data !== current || completed.context !== context || error);
  const result = completed?.result.ok ? completed.result : undefined;
  const drawable = result?.figure.data.length ? result : undefined;
  const ownershipDetails = result?.ownershipSnapshot;
  // The ordered measure notes also appear in the expandable original values.
  const statusNotes = ownershipDetails?.view === 'bars' && result
    ? result.notes.slice(0, -ownershipDetails.measures.length) : result?.notes ?? [];
  const scaledAxis = result?.returnSummary?.scaledAxis;
  const formatYAxisTicks = useMemo(() => scaledAxis
    ? (range: readonly [number, number]) => scaledReturnTicks(range, scaledAxis)
    : undefined, [scaledAxis]);
  return <><div className="linked-chart-status">
    {error && <p role="alert">{error}</p>}
    {stale && (ownership || returns || news) && view.stale
      ? <p role="status">Showing completed data (stale).</p>
      : stale && !(parentReportsSourceStatus && view.stale) && <p role="status">Updating chart — showing completed data (stale).</p>}
    {!completed && !error && !view.error && <p role="status">Calculating chart…</p>}
    {completed && !completed.result.ok && <p role={completed.result.refused ? 'status' : 'alert'}>{completed.result.message}</p>}
    {(error || (completed && !completed.result.ok)) && <OpenLinkedParameters onOpen={onOpenParameters}/>}
    {completed?.result.ok && options.kind === 'small-multiples' && <>
      <p>{panels} {panels === 1 ? 'panel' : 'panels'} · {options.symbols.join(', ')}</p>
      {completed.data.completeness.acquiredRowCount !== undefined && completed.data.rows.length < completed.data.completeness.acquiredRowCount &&
        <p>Filtered source delivered {completed.data.rows.length} of {completed.data.completeness.acquiredRowCount} acquired rows.</p>}
    </>}
    {completed && <DatasetStatus dataset={completed.data} source={news || ownership ? undefined : source}
      showCompleteness={!news && !ownership} notes={statusNotes}/>}
  </div>
  {news && !!result?.daySummaries?.length && <NewsCalendarDetails days={result.daySummaries}/>}
  {result?.returnSummary && <ReturnListingDetails details={result.returnSummary}/>}
  {ownershipDetails && <OwnershipDetails details={ownershipDetails}/>}
  {(news || measured || drawable) && <div className={'linked-chart-plot'
    + (returns ? ' linked-chart-plot--return' : ownership ? ' linked-chart-plot--ownership' : '')} ref={observePlot}>
    <ChartRenderer data={drawable?.figure} uirevision={drawable?.revision}
      scrollHeight={news ? newsCalendarPlotHeight : returns ? returnSummaryPlotHeight : ownership ? ownershipPlotHeight : drawable && recipePlotHeight(options.kind, drawable.figure)}
      minPlotWidth={returns ? returnSummaryPlotWidth(options.symbols.length) : options.kind === 'ownership-snapshot' ? ownershipPlotWidth(options.view) : undefined}
      formatYAxisTicks={formatYAxisTicks}
      touchScroll={news || measured || sankey || panels ? 'overflow' : options.kind === 'etf-exposure'}
      inspectSankeyOnTouch={sankey} onPlotWidthChange={sankey ? measureSankey : undefined}
      onViewportWidthChange={news ? measureNews : undefined} onDrawingSurfaceChange={measured ? measureDrawing : undefined}/>
  </div>}</>;
}

function NewsCalendarDetails({ days }: { days: NewsCalendarDay[] }) {
  const [selection, setSelection] = useState<string>();
  const selectedIndex = days.findIndex(day => day.date === selection);
  const index = selectedIndex < 0 ? days.length - 1 : selectedIndex;
  const selected = days[index];
  if (!selected) return null;
  const { date, mean, delivered, scored, articles } = selected;
  return <details className="news-calendar-details">
    <summary>Calendar day details</summary>
    <div className="news-calendar-day-controls">
      <label>Calendar day <select value={date} onChange={event => setSelection(event.target.value)}>
        {days.map(day => <option key={day.date} value={day.date}>{day.date} UTC</option>)}
      </select></label>
      <button type="button" disabled={index === 0} onClick={() => setSelection(days[index - 1].date)}>Previous day</button>
      <button type="button" disabled={index === days.length - 1} onClick={() => setSelection(days[index + 1].date)}>Next day</button>
    </div>
    <p aria-live="polite">{delivered} delivered · {scored} scored · {mean !== null ? `Mean polarity ${mean}`
      : delivered ? 'No scored articles delivered' : 'No delivered articles in this view'}</p>
    {articles.length > 0 && <ul aria-label="Presented article values">
      {articles.map(({ timestamp, polarity }, index) =>
        <li key={index}>{timestamp} · {polarity === null ? 'Unscored' : `Polarity ${polarity}`}</li>)}
    </ul>}
  </details>;
}


function ReturnListingDetails({ details }: { details: ReturnSummaryDetails }) {
  const [selection, setSelection] = useState<string>();
  const listing = details.series.find(series => series.symbol === selection) ?? details.series[0];
  if (!listing) return null;
  const { symbol, samples, summary, outlierObservations, start, end, excludedOpportunities, gapCount, excludedNonfinite } = listing;
  const originalValue = (value: number) => `${returnPercent(value)} (${value})`;
  return <details className="return-summary-details">
    <summary>Return listing details</summary>
    <label>Return listing <select value={symbol} onChange={event => setSelection(event.target.value)}>
      {details.series.map(item => <option key={item.symbol} value={item.symbol}>{item.symbol}</option>)}
    </select></label>
    <p aria-live="polite">{samples.length} daily adjusted-price returns · {start} to {end} · {excludedOpportunities} excluded opportunities
      ({gapCount} known price gaps, {excludedNonfinite} nonfinite returns)</p>
    <dl>
      <dt>Q1 (R7)</dt><dd>{originalValue(summary.q1)}</dd>
      <dt>Median</dt><dd>{originalValue(summary.median)}</dd>
      <dt>Q3 (R7)</dt><dd>{originalValue(summary.q3)}</dd>
      <dt>Observed whiskers</dt><dd>{originalValue(summary.lowerWhisker)} to {originalValue(summary.upperWhisker)}</dd>
      <dt>IQR</dt><dd>{originalValue(summary.iqr)}</dd>
      <dt>Outliers</dt><dd>{outlierObservations.length}</dd>
    </dl>
    {outlierObservations.length > 0 && <ul aria-label="Outlier observations">
      {outlierObservations.map(({ date, value }) => <li key={date}>{date} · {originalValue(value)}</li>)}
    </ul>}
  </details>;
}

function OwnershipDetails({ details }: { details: OwnershipSnapshotDetails }) {
  return <details className="ownership-snapshot-details">
    <summary>Ownership snapshot details</summary>
    {details.view === 'bars' ? <ul aria-label="Original ownership measures">
      {details.measures.map(measure => <li key={measure.id}>{ownershipMeasureText(measure).join(' · ')}</li>)}
    </ul> : <ul aria-label="Original ownership buckets">
      {details.buckets.map(({ id, percent, cells }) => <li key={id}>{id} · {percent}% reported · {cells} of 100 cells</li>)}
    </ul>}
  </details>;
}
