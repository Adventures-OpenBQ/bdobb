// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import type { LocalWorkerExecutor, Revision } from '../../lib/tableExecution/types';
import type { DashboardCard } from '../../lib/types';
import { kpiInputFields, kpiSourceChoices, kpiUnitLabel } from '../../lib/widgetData/kpi/bindings';
import { formatKpiValue, KPI_GAUGE_MIN_DRAW_WIDTH } from '../../lib/widgetData/kpi/build';
import { decodeLinkedKpiOptions } from '../../lib/widgetData/kpi/settings';
import type { KpiResult, KpiSnapshot, LinkedKpiOptions } from '../../lib/widgetData/kpi/types';
import { createKpiWorker } from '../../lib/widgetData/kpi/workerClient';
import type { ViewState } from '../../stores/tableExecutionStore';
import { ChartRenderer, readDrawingSurface, type DrawingSurface } from './ChartRenderer';
import { LinkedKpiControls, decodeKpiDraft, kpiDraft } from './LinkedKpiControls';
import { MetricRenderer } from './MetricRenderer';
import { LinkedParametersPortal, OpenLinkedParameters } from './LinkedParametersPortal';

const KPI_GAUGE_DRAW_HEIGHT = 164;
const acquireMessage = 'Acquire a source with verified KPI observation evidence.';
type KpiWorker = ReturnType<typeof createKpiWorker>;

type Props = {
  sourceId: string;
  executor?: LocalWorkerExecutor;
  view: ViewState;
  persisted?: LinkedKpiOptions;
  viewer: boolean;
  parametersTarget: HTMLElement | null;
  onOpenParameters: () => void;
  sourceCurrent: boolean;
  readCurrent: () => { view: ViewState; executor?: LocalWorkerExecutor; card?: DashboardCard; sourceCurrent: boolean };
  onSettingsChange: (options: LinkedKpiOptions, guard: () => boolean) => Promise<boolean>;
};

function revisionIs(a: Revision | undefined, b: Revision | undefined) {
  return !!a && !!b && a.widgetId === b.widgetId && a.input === b.input && a.model === b.model && a.output === b.output;
}

function settingsKey(value: unknown) {
  if (value === undefined) return 'new';
  const decoded = decodeLinkedKpiOptions(value);
  return decoded.ok ? JSON.stringify(decoded.options) : 'invalid';
}

function message(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 400);
}

function validSurface(size: DrawingSurface | undefined): size is DrawingSurface {
  return !!size && Number.isFinite(size.width) && Number.isFinite(size.height)
    && size.width >= KPI_GAUGE_MIN_DRAW_WIDTH && size.height >= KPI_GAUGE_DRAW_HEIGHT;
}

function sameSurface(a: DrawingSurface | undefined, b: DrawingSurface | undefined) {
  return a?.width === b?.width && a?.height === b?.height;
}

function useKpiWorker() {
  const worker = useRef<KpiWorker>(null);
  useEffect(() => {
    const client = createKpiWorker();
    worker.current = client;
    return () => { worker.current = null; client.dispose(); };
  }, []);
  return worker;
}

async function evaluateKpi(worker: KpiWorker, job: NonNullable<SourceJob>, options: LinkedKpiOptions, signal: AbortSignal) {
  const data = await job.load(options.valueField, signal);
  return worker.run(data, options, signal);
}

type SourceJob = ReturnType<typeof useSourceJob>;

function useSourceJob({ sourceId, executor, view, sourceCurrent, readCurrent }: Props, key: string) {
  const { sourceRevision: revision, ready } = view;
  const usable = sourceCurrent && revision?.widgetId === sourceId;
  return useMemo(() => {
    if (!usable || !revision || !executor || !ready) return;
    function current() {
      const live = readCurrent();
      return live.sourceCurrent && live.card?.linkedSource?.sourceWidgetId === sourceId && settingsKey(live.card.linkedMetric) === key
        && live.executor === executor && live.view.ready === ready && revisionIs(live.view.sourceRevision, revision);
    }
    return {
      columns: ready.columns, current, revision, ready,
      async load(field: string | undefined, signal: AbortSignal) {
        const data = await executor.chartData(revision, kpiInputFields(ready.columns, field), signal);
        signal.throwIfAborted();
        if (!revisionIs(data.revision, revision) || data.resultRevision !== revision.model || data.outputRevision !== revision.output)
          throw new Error('The KPI source revision changed. Refresh the selected source.');
        return data;
      },
    };
  }, [sourceId, usable, ready, revision, executor, readCurrent, key]);
}

function KpiDetails({ snapshot, notes }: { snapshot: KpiSnapshot; notes: string[] }) {
  const { observation, reference, unit, scope, range } = snapshot;
  return <details className="linked-kpi-details">
    <summary>KPI details</summary>
    <ul aria-label="KPI values and evidence">
      <li>Original value {formatKpiValue(snapshot.value, unit)}{unit.kind === 'fraction' ? ` (${snapshot.value} fraction)` : ''}</li>
      <li>Acquired units {kpiUnitLabel(unit)}</li>
      <li>Observation {observation.observation_id}</li>
      <li>Period {observation.period_kind ?? 'unknown'} · {observation.period_start && observation.period_end
        ? `${observation.period_start} to ${observation.period_end}` : 'Actual period dates unknown'}</li>
      <li>Adjustment basis {observation.adjustment_basis ?? 'unknown'} · Reporting basis {observation.reporting_basis ?? 'unknown'}</li>
      {observation.basis_reference ? <li>Basis reference {observation.basis_reference}</li> : null}
      <li>{scope.presentedRowCount} presented / {scope.acquiredRowCount} acquired rows · {scope.omittedObservationCount} omitted observations</li>
      {range ? <li>{range.label} · {formatKpiValue(range.min, unit)} to {formatKpiValue(range.max, unit)}</li> : null}
      {reference ? <li>{snapshot.referenceLabel} · {formatKpiValue(reference.value, unit)}
        {reference.kind === 'observation' ? <>
          {' · '}{reference.observation.observation_id} · As of {reference.observation.as_of ?? 'unknown'} · Vintage {reference.observation.vintage}
          {reference.observation.period_start && reference.observation.period_end
            ? ` · ${reference.observation.period_start} to ${reference.observation.period_end}` : ''}
          {' · Adjustment basis '}{reference.observation.adjustment_basis ?? 'unknown'}
          {' · Reporting basis '}{reference.observation.reporting_basis ?? 'unknown'}
        </> : null}
      </li> : null}
      {notes.filter(note => !snapshot.outOfRange || !note.startsWith('The original KPI value')).map(note => <li key={note}>{note}</li>)}
    </ul>
  </details>;
}

function KpiOutput({ result, observeSurface }: { result: Extract<KpiResult, { ok: true }>; observeSurface: (size: DrawingSurface) => void }) {
  const theme = useResolvedTheme();
  const { snapshot, gauge } = result;
  const { deltaAbsolute, deltaPercent, label, range, reference, referenceLabel, unit, value } = snapshot;
  const sign = (amount: number) => amount > 0 ? '+' : '';
  const absolute = deltaAbsolute === undefined ? undefined :
    sign(deltaAbsolute) + (unit.kind === 'fraction' ? `${deltaAbsolute} fraction` : formatKpiValue(deltaAbsolute, unit));
  const percent = deltaPercent === undefined ? '' : ` · ${sign(deltaPercent)}${deltaPercent}% change`;
  const delta = absolute === undefined ? undefined : `Δ ${absolute}${percent}`;
  const figure = useMemo(() => {
    if (!gauge) return;
    const color = theme === 'dark' ? '#f2f5fa' : '#182232';
    const paper = theme === 'dark' ? '#243142' : '#f1f5fa';
    const annotations = (gauge.layout.annotations as Record<string, unknown>[]).map(annotation =>
      annotation.hovertext ? { ...annotation, hoverlabel: { bgcolor: paper, bordercolor: color, font: { color, size: 12 } } } : annotation);
    return { ...gauge, layout: { ...gauge.layout, font: { ...gauge.layout.font as object, color }, annotations } };
  }, [gauge, theme]);
  return <>
    <MetricRenderer snapshot={{ label, value: formatKpiValue(value, unit), delta }}/>
    <p className="linked-kpi-provenance">Issuer {snapshot.issuer} · Listing {snapshot.listing} · Share class {snapshot.shareClass ?? 'unknown'}</p>
    <p className="linked-kpi-provenance">As of {snapshot.asOf ?? 'unknown'} · Vintage {snapshot.observation.vintage} · Retrieved {snapshot.retrievedAt}</p>
    {range ? <p className="linked-kpi-provenance">{range.label}</p> : null}
    {reference?.kind === 'user-target' ? <p className="linked-kpi-provenance">{referenceLabel} · {formatKpiValue(reference.value, unit)}</p> : null}
    {snapshot.outOfRange ? <p role="alert">The original KPI value is outside the user range.</p> : null}
    {figure ? <div className="linked-kpi-plot">
      <ChartRenderer data={figure} uirevision={result.revision} scrollHeight={KPI_GAUGE_DRAW_HEIGHT}
        minPlotWidth={KPI_GAUGE_MIN_DRAW_WIDTH} onDrawingSurfaceChange={observeSurface} touchScroll="overflow" inspectAnnotationsOnTouch/>
    </div> : null}
    <KpiDetails snapshot={snapshot} notes={result.notes}/>
  </>;
}

type AppliedState = { key: string; job: NonNullable<SourceJob>; result: KpiResult };
type EditorProps = {
  job: SourceJob;
  settings?: LinkedKpiOptions;
  parametersTarget: HTMLElement | null;
  needsPreset: boolean;
  appliedProblem?: string;
  draftSurface?: DrawingSurface;
  surface: () => DrawingSurface | undefined;
  onSettingsChange: Props['onSettingsChange'];
};

function KpiEditor({ job, settings, parametersTarget, needsPreset, appliedProblem, draftSurface, surface, onSettingsChange }: EditorProps) {
  const worker = useKpiWorker();
  const [draft, setDraft] = useState(() => kpiDraft(settings));
  const [saving, setSaving] = useState(false);
  const [saveProblem, setSaveProblem] = useState<string>();
  const [source, setSource] = useState<{ job: SourceJob; choices: ReturnType<typeof kpiSourceChoices>; error?: string }>();
  const choices = job && source?.job === job ? source.choices : undefined;
  const decoded = useMemo(() => decodeKpiDraft(draft), [draft]);
  const candidate = decoded.ok ? decoded.options : undefined;
  const authoredKey = settingsKey(settings);
  const changed = candidate && settingsKey(candidate) !== authoredKey;
  // The worker validates geometry for the fixed minimum width. Current CSS
  // dimensions are fenced separately and never enter the question revision.
  const width = candidate?.view === 'gauge' ? draftSurface?.width : undefined;
  const height = candidate?.view === 'gauge' ? draftSurface?.height : undefined;
  const [check, setCheck] = useState<{ job: SourceJob; candidate: LinkedKpiOptions; width?: number; height?: number; result: KpiResult }>();
  const checked = check && check.job === job && check?.candidate === candidate && check.width === width && check.height === height
    ? check.result : undefined;
  const supported = candidate?.view !== 'gauge' || validSurface(draftSurface);

  useEffect(() => {
    if (!job) return;
    const controller = new AbortController();
    void job.load(undefined, controller.signal).then(input => {
      if (!controller.signal.aborted && job.current()) setSource({ job, choices: kpiSourceChoices(input) });
    }).catch(error => {
      if (!controller.signal.aborted && job.current()) setSource({ job, choices: undefined, error: message(error) });
    });
    return () => controller.abort();
  }, [job]);

  useEffect(() => {
    if (!worker.current || !job || !candidate || !changed || !choices || !supported) return;
    const controller = new AbortController();
    const finish = (result: KpiResult) => {
      if (!controller.signal.aborted && job.current()) setCheck({ job, candidate, width, height, result });
    };
    void evaluateKpi(worker.current, job, candidate, controller.signal).then(finish).catch(error =>
      finish({ ok: false, refused: true, message: `Could not validate the KPI draft. ${message(error)}` }));
    return () => controller.abort();
  }, [worker, job, candidate, changed, choices, supported, width, height]);

  const canApply = !!job && !!choices && !!changed && supported && checked?.ok === true;
  const sourceProblem = job && source?.job === job && !choices ? source.error ?? acquireMessage : undefined;
  let hint = sourceProblem;
  if (choices && draft.metric && !decoded.ok) hint = decoded.message;
  else if (changed && choices && !supported) hint = 'The KPI drawing surface is too small. Resize the card and try again.';
  else if (changed && choices && !checked) hint = 'Checking KPI settings…';
  else if (checked && !checked.ok) hint = checked.message;

  async function apply(event: FormEvent) {
    event.preventDefault();
    if (!canApply || !candidate || saving) return;
    const valid = () => job.current() && (candidate.view !== 'gauge' || sameSurface(draftSurface, surface()));
    setSaveProblem(undefined);
    if (!valid()) {
      setSaveProblem('The KPI source or drawing size changed. Review the settings and try again.');
      return;
    }
    setSaving(true);
    try {
      if (!await onSettingsChange(candidate, valid)) setSaveProblem('The KPI source or drawing size changed. Review the settings and try again.');
    } catch (error) { setSaveProblem(`Could not save the KPI settings. ${message(error)}`); }
    finally { setSaving(false); }
  }

  return <>
    <LinkedParametersPortal target={parametersTarget}>
      <LinkedKpiControls draft={draft} setDraft={setDraft} columns={job?.columns ?? []} choices={choices}
        canApply={canApply} saving={saving} message={hint === appliedProblem ? undefined : hint} onSubmit={event => void apply(event)}/>
    </LinkedParametersPortal>
    {needsPreset ? <p role="status">{sourceProblem ?? 'Choose a verified KPI preset in Parameters.'}</p> : null}
    {saveProblem ? <p role="alert">{saveProblem}</p> : null}
  </>;
}

export function LinkedKpiRenderer(props: Props) {
  const { sourceId, persisted, view, viewer, parametersTarget, onOpenParameters, onSettingsChange } = props;
  const decoded = useMemo(() => persisted === undefined ? undefined : decodeLinkedKpiOptions(persisted), [persisted]);
  const settings = decoded?.ok ? decoded.options : undefined;
  const key = settingsKey(persisted);
  const job = useSourceJob(props, key);
  const worker = useKpiWorker();
  const [applied, setApplied] = useState<AppliedState>();
  const [draftSurface, setDraftSurface] = useState<DrawingSurface>();
  const probe = useRef<HTMLDivElement>(null);
  const readSurface = useCallback(() => {
    const surface = probe.current?.querySelector('.chart-plot');
    if (surface) return readDrawingSurface(surface);
  }, []);
  const observeSurface = useCallback((size: DrawingSurface) => {
    setDraftSurface(previous => sameSurface(previous, size) ? previous : size);
  }, []);

  useEffect(() => {
    if (!worker.current || !job || !settings) return;
    const controller = new AbortController();
    const finish = (result: KpiResult) => {
      if (!controller.signal.aborted && job.current()) setApplied({ key, job, result });
    };
    void evaluateKpi(worker.current, job, settings, controller.signal).then(finish).catch(error =>
      finish({ ok: false, refused: true, message: `Could not calculate the linked KPI. ${message(error)}` }));
    return () => controller.abort();
  }, [worker, job, key, settings]);

  const pending = view.status === 'pending' || view.status === 'updating';
  const retainCompleted = applied?.key === key && applied.result.ok && view.stale
    && (pending || view.status === 'blocked' || view.status === 'failed')
    && applied.job.ready === view.ready && revisionIs(applied.job.revision, view.sourceRevision);
  const result = applied?.key === key && (applied.job === job || retainCompleted) ? applied.result : undefined;
  const problem = decoded && !decoded.ok ? decoded.message : result && !result.ok ? result.message : undefined;
  const needsPreset = !decoded && !pending && !view.error;
  return <section className="linked-kpi-renderer" aria-label="Linked KPI">
    {!viewer ? <>
      <div className="linked-kpi-surface-probe" ref={probe} aria-hidden="true">
        <ChartRenderer data={null} scrollHeight={KPI_GAUGE_DRAW_HEIGHT}
          minPlotWidth={KPI_GAUGE_MIN_DRAW_WIDTH} onDrawingSurfaceChange={observeSurface}/>
      </div>
      <KpiEditor key={key} job={job} settings={settings} parametersTarget={parametersTarget} needsPreset={needsPreset}
        appliedProblem={problem} draftSurface={draftSurface}
        surface={readSurface} onSettingsChange={onSettingsChange}/>
    </> : null}
    {problem ? <p role="alert">{problem}</p> : null}
    {retainCompleted ? <p role="status">Showing completed data (stale).</p> : null}
    {pending && !result?.ok ? <p role="status">Loading source {sourceId}…</p> : null}
    {job && settings && !result && !problem ? <p role="status">Calculating linked KPI…</p> : null}
    {viewer && needsPreset ? <p>Choose a verified KPI preset in edit mode.</p> : null}
    {!viewer && (needsPreset || problem) && <OpenLinkedParameters onOpen={onOpenParameters}/>}
    {result?.ok ? <KpiOutput result={result} observeSurface={observeSurface}/> : null}
  </section>;
}
