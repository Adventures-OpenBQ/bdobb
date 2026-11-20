// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { DashboardCard } from '../../lib/types';
import type { LinkedChartSettings, WidgetDataset } from '../../lib/widgetData/types';
import { buildLinkedFigure } from '../../lib/widgetData/chartFigure';
import { bulletRequestIds } from '../../lib/widgetData/bulletFigure';
import { useSettingsStore } from '../../stores/settingsStore';
import { tableExecutionStore } from '../../stores/tableExecutionStore';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { ChartRenderer } from './ChartRenderer';
import type { PlotlyFigure } from '../../lib/chartShapes';
import type { ViewState } from '../../stores/tableExecutionStore';
import type { LocalWorkerExecutor, ChartResult, Revision } from '../../lib/tableExecution/types';
import type { NewsCalendarOptions, RecipeContext, RecipeOptions, RecipeResult } from '../../lib/widgetData/chartRecipes/types';
import { decodeLinkedChartRecipe, isRecipeType, requiredRecipeFields, withRecipeType } from '../../lib/widgetData/chartRecipes/settings';
import { bubblePriceDates, isIncomePeriodColumn, savedBindingIssue } from '../../lib/widgetData/chartRecipes/bindings';
import { readFinancialEvidence } from '../../lib/widgetData/chartRecipes/financialEvidence';
import { admitDividendWindow, admitIncomeUnits, cohortIssue, screenerIssue } from '../../lib/widgetData/chartRecipes/financialAdmission';
import { incomeSankeyPeriodChoices } from '../../lib/widgetData/chartRecipes/incomeSankeyInput';
import { estimateRangeIdentityFields } from '../../lib/widgetData/chartRecipes/estimateEvidence';
import { acquiredWindow, symbolList, observationSymbol } from '../../lib/widgetData/chartRecipes/priceEvidence';
import { newsCalendarPlotHeight, nextMultiplesWidth, recipePlotHeight } from '../../lib/widgetData/chartRecipes/viewport';
import type { NewsCalendarDay } from '../../lib/widgetData/chartRecipes/newsCalendar';
import { createRecipeWorker } from '../../lib/widgetData/chartRecipes/workerClient';
import { todayLocal } from '../../lib/calendarView';
import { LinkedChartRecipeControls, recipeAvailability, recipeLabels, type SourceChoiceKind } from './LinkedChartRecipeControls';

function revisionKey({ widgetId, input, model, output }: Revision) {
    return JSON.stringify([widgetId, input, model, output]);
}

function recipeInputFields(options: RecipeOptions, ready: NonNullable<ViewState['ready']>) {
    let fields = requiredRecipeFields(options);
    if ((options.kind === 'dividend-steps' || options.kind === 'news-sentiment-calendar') && ready.topLevelCount === 0)
        fields = fields.filter(field => ready.columns.some(column => column.id === field));
    if (options.kind === 'estimate-range') fields.push(...estimateRangeIdentityFields(ready.columns));
    return [...new Set(fields)];
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
    parentReportsSourceStatus?: boolean;
    store?: typeof tableExecutionStore;
    onSettingsChange: (settings: LinkedChartSettings) => Promise<boolean>;
};
export function LinkedChartRenderer(props: LinkedChartProps) {
    const type = props.card.linkedChart?.type;
    const source = type === 'bullet' || type === 'waterfall' ? props.card.linkedSource?.sourceWidgetId : undefined;
    return <LinkedChartView key={JSON.stringify([props.dashboardId, props.card.id, source])} {...props}/>;
}

function LinkedChartView({ dashboardId, card, refreshKey, viewer = false, parentReportsSourceStatus = false, store = tableExecutionStore, onSettingsChange }: LinkedChartProps) {
    const view = useSyncExternalStore(store.subscribe, () => store.readView(dashboardId, card.id));
    const theme = useResolvedTheme();
    const maxDecimals = useSettingsStore(s => s.settings.maxDecimalPlaces);
    const settings = card.linkedChart!;
    const source = card.linkedSource?.sourceWidgetId;
    const carried = settings.type === 'bullet' || settings.type === 'waterfall';
    const identity = JSON.stringify([dashboardId, card.id]);
    const recipe = decodeLinkedChartRecipe(settings, settings.type);
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
    const [draftWidth, setDraftWidth] = useState<number>();
    const observeNewsDraftWidth = useCallback((viewport: HTMLDivElement | null) => {
        if (!viewport) return;
        const measure = () => {
            if (viewport.clientWidth > 0) setDraftWidth(Math.min(viewport.clientWidth, 10_000));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(viewport);
        return () => observer.disconnect();
    }, []);
    const today = todayLocal();
    const newsDraftContext = useMemo<RecipeContext | undefined>(() => draftWidth === undefined
        ? undefined : { theme, maxDecimals, today, viewportWidth: draftWidth }, [theme, maxDecimals, today, draftWidth]);
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
        const available = new Map((view.ready.chartColumns ?? view.ready.columns).map(c => [c.id, c]));
        setNoMatches(false);
        const missing = [settings.category, ...settings.measures].filter((id): id is string => Boolean(id)).find(id => !available.has(id));
        if (missing) {
            setRefused(undefined);
            setError(`Field ${missing} is unavailable. Repair chart fields.`);
            return;
        }
        const category = settings.category;
        if (!category || !settings.measures.length) {
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
        const ids = [category, ...renderedSettings.measures, ...(settings.type === 'bullet' ? bulletRequestIds(renderedSettings.measures, view.ready.columns) : [])];
        void executor.chartData(revision, [...new Set(ids)], controller.signal).then(dataset => {
            if (controller.signal.aborted || version !== generation.current || JSON.stringify(dataset.revision) !== JSON.stringify(revision))
                return;
            if (settings.type === 'bullet') {
                const values = [...new Set(dataset.rows.map(row => String(row.values[category] ?? '')).filter(Boolean))];
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
    async function commit(next: LinkedChartSettings) {
        if (viewer || saving) return;
        setSaving(true); try {
        const validated = decodeLinkedChartRecipe(next, next.type);
        if (validated && !validated.ok) throw new Error(validated.message);
        if (!await onSettingsChange(next))
            throw new Error('Chart settings could not be saved.');
        setSaveError(undefined); setDraft(undefined);
    }
    catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
    }
    finally {
        setSaving(false);
    } }
    const columns = (delivered?.dataset.columns ?? view.ready?.columns ?? []);
    const fields = [...new Map([...columns, ...(view.ready?.chartColumns ?? view.ready?.columns ?? [])].map(c => [c.id, c])).values()];
    const quarters = quarterChoices?.scope === quarterScope ? quarterChoices.values : [];
    return <div className={editing === 'news-sentiment-calendar' ? 'linked-chart-renderer linked-chart-renderer--news' : 'linked-chart-renderer'}>
    {!viewer && editing === 'news-sentiment-calendar' && <div aria-hidden="true"
      className="chart-scroll-viewport--measured news-calendar-width-probe" ref={observeNewsDraftWidth}/>}
    {!viewer ? <div className="chart-controls">
      <label>Chart type<select aria-label="Chart type" disabled={saving} value={editing} onChange={e => {
        const type = e.target.value as LinkedChartSettings['type'];
        if (isRecipeType(type)) {
          if (!recipeAvailability(type, presented, verifiedEmpty)) setDraft({ scope: editScope, kind: type });
          return;
        }
        if (type === settings.type) { setDraft(undefined); return; }
        const next = withRecipeType(settings, type);
        void commit(type === 'bullet' && !next.category && fields.some(c => c.id === 'fiscal_period') ? { ...next, category: 'fiscal_period' } : next);
      }}><option value="column">Columns (vertical)</option><option value="bar">Bars (horizontal)</option><option value="line">Lines</option><option value="pie">Pie</option><option value="bullet">Bullet</option><option value="waterfall">Waterfall</option>
      {Object.entries(recipeLabels).map(([kind, label]) => {
        const issue = recipeAvailability(kind as RecipeOptions['kind'], presented, verifiedEmpty);
        return <option key={kind} value={kind} disabled={!!issue}>{label}{issue ? ' — ' + issue : ''}</option>;
      })}</select></label>
      {financial ? <LinkedChartRecipeControls key={JSON.stringify([editScope, editing])} kind={editing}
        columns={presented} verifiedEmpty={verifiedEmpty} loadSymbols={loadSymbols} loadSourceChoices={loadSourceChoices} loadNewsInput={loadNewsInput}
        loadNewsDraft={loadNewsDraft} newsDraftContext={newsDraftContext} disabled={saving} saved={recipe?.ok && recipe.options.kind === editing ? recipe.options : undefined}
        onApply={options => void commit({ ...withRecipeType(settings, options.kind), recipe: options })}/> : <>
      <label>Category<select aria-label="Category" disabled={saving} value={settings.category ?? ''} onChange={e => void commit({ ...settings, category: e.target.value || undefined })}><option value="">Choose category</option>{settings.category && !fields.some(c => c.id === settings.category) ? <option value={settings.category}>{settings.category} (unavailable)</option> : null}{fields.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <fieldset disabled={saving}><legend>Measures</legend>{[...new Set([...fields.filter(c => (!c.dtype || c.dtype === 'number') && (settings.type !== 'bullet' || c.id.endsWith('_actual'))).map(c => c.id), ...settings.measures])].map(id => <label key={id}><input type="checkbox" checked={settings.measures.includes(id)} onChange={e => void commit({ ...settings, measures: e.target.checked ? [...settings.measures, id] : settings.measures.filter(m => m !== id) })}/>{fields.find(c => c.id === id)?.label ?? `${id} (unavailable)`}</label>)}</fieldset>
      {settings.type === 'bullet' ? <label>Quarter<select aria-label="Quarter" disabled={saving} value={settings.period ?? ''} onChange={e => { const { period: _drop, ...rest } = settings; void commit(e.target.value ? { ...rest, period: e.target.value } : rest); }}><option value="">Latest</option>{settings.period && !quarters.includes(settings.period) ? <option value={settings.period}>{settings.period} (unavailable)</option> : null}{quarters.map(q => <option key={q} value={q}>{q}</option>)}</select></label> : null}
      {settings.type === 'column' || settings.type === 'bar' ? <label>Display<select aria-label="Display" disabled={saving} value={settings.display} onChange={e => void commit({ ...settings, display: e.target.value as LinkedChartSettings['display'] })}><option value="grouped">Grouped</option><option value="stacked">Stacked</option><option value="percent">100% stacked</option></select></label> : null}
      {settings.type !== 'pie' && settings.type !== 'bullet' && settings.type !== 'waterfall' ? <label>Series from<select aria-label="Series from" disabled={saving} value={settings.seriesFrom ?? 'columns'} onChange={e => void commit({ ...settings, seriesFrom: e.target.value as 'columns' | 'rows' })}><option value="columns">Columns</option><option value="rows">Rows</option></select></label> : null}
      </>}
    </div> : null}
    <div className="linked-chart-status">
    {saveError ? <p role="alert">{saveError}</p> : null}
    {!isRecipeType(settings.type) && recipe && !recipe.ok && <p role="status">{recipe.message}</p>}
    {legacy && error ? <p role="alert">{error}</p> : null}
    {lagging ? <p role="status">Updating chart — showing completed data (stale).</p> : null}
    {legacy && noMatches ? <p role="status">No selected series match the current filter.</p> : null}
    {legacy && refused ? <p role="status">{refused}</p> : null}
    {legacy && !figure && !error && !(carried && view.error) && !noMatches && !refused ? <p role="status">{carried && source && (view.sourceRevision?.widgetId !== source || view.status === 'pending' || view.status === 'updating') ? `Loading source ${source}…` : view.status === 'pending' ? 'Loading…' : 'Choose chart fields'}</p> : null}
    {delivered ? <DatasetStatus dataset={delivered.dataset} notes={notes} source={carried ? source : undefined}/> : null}
    </div>
    {isRecipeType(settings.type) && (recipe?.ok
      ? <FinancialChart key={editScope} parentReportsSourceStatus={parentReportsSourceStatus} view={view} executor={executor} source={source} options={recipe.options} theme={theme} maxDecimals={maxDecimals}/>
      : <p role="status">{recipe && !recipe.ok ? recipe.message : 'Choose recipe field bindings.'}</p>)}
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
  theme: 'dark' | 'light'; maxDecimals: number; parentReportsSourceStatus: boolean;
};
function FinancialChart(props: FinancialProps) {
  const { source, view, executor, options } = props;
  if (!source || view.status === 'unavailable' || !executor || !view.sourceRevision || !view.ready || view.sourceRevision.widgetId !== source) {
    if (view.error) return props.parentReportsSourceStatus ? null : <p role="alert">{view.error}</p>;
    return <p role="status">{source ? `Loading source ${source}…` : 'Select an available source table.'}</p>;
  }
  const emptyAllowed = (options.kind === 'dividend-steps' || options.kind === 'news-sentiment-calendar') && view.ready.topLevelCount === 0;
  const issue = emptyAllowed ? undefined : savedBindingIssue(options, view.ready.columns);
  if (issue) return <p role="alert">{issue}</p>;
  const completeness = view.ready.completeness.kind;
  switch (options.kind) {
    case 'drawdown': case 'yield-curve': case 'monthly-returns': case 'correlation':
    case 'return-distribution': case 'small-multiples':
      if (completeness !== 'complete' && completeness !== 'bounded')
        return <p role="status">The source must be fully loaded. Acquisition is {completeness}.</p>;
  }
  return <WorkerChart {...props} source={source} executor={executor} ready={view.ready} revision={view.sourceRevision}/>;
}

/** Mounted for one saved question. Keep its last completed figure through a transient refresh failure. */
function WorkerChart({ view, source, executor, ready, revision, options, theme, maxDecimals, parentReportsSourceStatus }: FinancialProps & {
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
  const viewportWidth = news ? newsWidth : panels || sankey ? width : undefined;
  const context = JSON.stringify([theme, maxDecimals, today, viewportWidth]);
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
    if (!current || !worker.current || (news && viewportWidth === undefined)) return;
    const controller = new AbortController();
    setWorkerError(undefined);
    void worker.current.run(current, options, { theme, maxDecimals, today, ...(viewportWidth === undefined ? {} : { viewportWidth }) }, controller.signal).then(result => {
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
  return <><div className="linked-chart-status">
    {error && <p role="alert">{error}</p>}
    {stale && !(parentReportsSourceStatus && view.stale) && <p role="status">Updating chart — showing completed data (stale).</p>}
    {!completed && !error && !view.error && <p role="status">Calculating chart…</p>}
    {completed && !completed.result.ok && <p role={completed.result.refused ? 'status' : 'alert'}>{completed.result.message}</p>}
    {completed?.result.ok && options.kind === 'small-multiples' && <>
      <p>{panels} {panels === 1 ? 'panel' : 'panels'} · {options.symbols.join(', ')}</p>
      {completed.data.completeness.acquiredRowCount !== undefined && completed.data.rows.length < completed.data.completeness.acquiredRowCount &&
        <p>Filtered source delivered {completed.data.rows.length} of {completed.data.completeness.acquiredRowCount} acquired rows.</p>}
    </>}
    {completed && <DatasetStatus dataset={completed.data} source={news ? undefined : source} showCompleteness={!news}
      notes={result?.notes ?? []}/>}
  </div>
  {news && !!result?.daySummaries?.length && <NewsCalendarDetails days={result.daySummaries}/>}
  {(news || drawable) && <div className="linked-chart-plot" ref={observePlot}>
    <ChartRenderer data={drawable?.figure} uirevision={drawable?.revision}
      scrollHeight={news ? newsCalendarPlotHeight : drawable && recipePlotHeight(options.kind, drawable.figure)}
      touchScroll={news || sankey || panels ? 'overflow' : options.kind === 'etf-exposure'}
      inspectSankeyOnTouch={sankey} onPlotWidthChange={sankey ? measureSankey : undefined}
      onViewportWidthChange={news ? measureNews : undefined}/>
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
