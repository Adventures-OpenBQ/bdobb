// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useState } from 'react';
import type { ChartResult } from '../../lib/tableExecution/types';
import type { ViewState } from '../../stores/tableExecutionStore';
import { bindingCandidates, bindingRoles } from '../../lib/widgetData/chartRecipes/bindings';
import { readChartSource, readChartSourceProjection } from '../../lib/widgetData/chartRecipes/chartSourceContracts';
import { read as readCell } from '../../lib/widgetData/chartRecipes/estimateEvidence';
import type { EstimateRevisionData } from '../../lib/widgetData/chartRecipes/estimateRevisions';
import { estimateChangeText } from '../../lib/widgetData/chartRecipes/estimateRevisionsDisplay';
import { estimateVintageSourceIssue, parseEstimateVintageSource, type EstimateVintageSource } from '../../lib/widgetData/chartRecipes/estimateVintageEvidence';
import { metricVintageKey } from '../../lib/widgetData/chartRecipes/metricEvidence';
import { linearAxisTicks } from '../../lib/widgetData/chartRecipes/overlayDisplay';
import { decodeEstimateRevisionsOptions } from '../../lib/widgetData/chartRecipes/settings';
import type { EstimateRevisionsOptions, EstimateRevisionsSurface, RecipeContext } from '../../lib/widgetData/chartRecipes/types';
import { estimateRevisionMinPlotHeight, estimateRevisionMinPlotWidth } from '../../lib/widgetData/chartRecipes/viewport';
import type { DatasetColumn } from '../../lib/widgetData/types';
import { ChartRenderer } from './ChartRenderer';
import { recipeErrorText, sameRecipeRevision, sameRecipeSurface, useMeasuredRecipe, useMeasuredRecipeSurface, type MeasuredRecipeJob } from './useMeasuredRecipe';

type Job = MeasuredRecipeJob<EstimateRevisionsOptions>;
type Metric = EstimateRevisionsOptions['metric'];
type Target = EstimateRevisionsOptions['target'];
type View = EstimateRevisionsOptions['view'];
type Fields = EstimateRevisionsOptions['fields'];
type Vintage = EstimateVintageSource['vintages'][number];

const metricLabels = { eps: 'Consensus EPS', revenue: 'Consensus revenue' } as const;
const targetLabel = (target: Target) => `${target.kind} ${target.start} to ${target.end}`;
const vintageLabel = (vintage: Vintage) => `${vintage.observed_at} · ${vintage.id} · batch ${vintage.batch}`;
const roles = bindingRoles('estimate-revisions', 'eps');

/** Keep presented companions so the worker can cross-check them with the acquired declarations. */
export function estimateRevisionInputFields(columns: DatasetColumn[]) {
  return columns.map(column => column.id);
}

function canOfferBump(source: EstimateVintageSource, data: ChartResult) {
  const { universe } = source;
  const { columns, rows, completeness, provenance } = data;
  if (universe.status !== 'complete' || completeness.kind !== 'complete'
    || Object.values(source.unsafe).some(Boolean) || provenance.inputMayContainAggregates) return false;

  const fields = ['issuer', 'vintage', 'value'].map(key => {
    const matches = bindingCandidates(roles.find(role => role.key === key)!, columns);
    return matches.length === 1 ? matches[0].id : undefined;
  });
  const [issuerField, vintageField, valueField] = fields;
  if (!issuerField || !vintageField || !valueField) return false;
  const baseline = source.vintages.find(v => v.batch === universe.baseline_batch)?.id;
  const current = source.vintages.find(v => v.batch === universe.current_batch)?.id;
  const baselineMembers = new Set<unknown>(), currentMembers = new Set<unknown>();
  for (const row of rows) {
    const issuer = readCell(row, issuerField), vintage = readCell(row, vintageField), value = readCell(row, valueField);
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (vintage === baseline && value > 0) baselineMembers.add(issuer);
    if (vintage === current) currentMembers.add(issuer);
  }
  // This controls the option's availability. The worker checks the exact draft
  // bindings, pins, source agreement, whole columns and final drawing dimensions.
  return universe.members.every(issuer => baselineMembers.has(issuer) && currentMembers.has(issuer));
}

function useEstimateHistory(job: Job | undefined) {
  const [read, setRead] = useState<{ job: Job; source?: EstimateVintageSource; bump?: boolean; error?: string }>();
  useEffect(() => {
    if (!job) return;
    const controller = new AbortController();
    const { signal } = controller;
    void job.load(signal).then(data => {
      const { provenance } = data;
      const projection = readChartSourceProjection(provenance, 'estimate-vintages');
      const source = projection && readChartSource(provenance, 'estimate-vintages', parseEstimateVintageSource);
      const bump = !!source && canOfferBump(source, data);
      if (!signal.aborted && job.current()) setRead({ job, source, bump });
    }).catch(error => {
      if (!signal.aborted && job.current()) setRead({ job, error: recipeErrorText(error) });
    });
    return () => controller.abort();
  }, [job]);
  return read?.job === job ? read : undefined;
}

function estimateSurface(pinCount: number, hint?: EstimateRevisionsSurface) {
  return {
    minPlotWidth: Math.max(estimateRevisionMinPlotWidth(pinCount), hint?.width ?? 0),
    scrollHeight: Math.max(estimateRevisionMinPlotHeight, hint?.height ?? 0),
  };
}

export function EstimateRevisionsControls({ job, saved, context, disabled, onApply }: {
  job?: Job; saved?: EstimateRevisionsOptions; context: RecipeContext; disabled: boolean;
  onApply: (options: EstimateRevisionsOptions, guard: () => boolean) => void;
}) {
  const surface = useMeasuredRecipeSurface(context);
  const read = useEstimateHistory(job);
  const source = read?.source;
  const [selectedMetric, setMetric] = useState<Metric | ''>();
  const [selectedTarget, setTarget] = useState<Target | null>();
  const [selectedView, setView] = useState<View>();
  const [selectedVintages, setVintages] = useState<string[]>();
  const [editedFields, setFields] = useState<Partial<Fields>>({});
  const metric = selectedMetric ?? saved?.metric ?? source?.metric ?? '';
  const target = selectedTarget === undefined ? saved?.target ?? source?.target : selectedTarget;
  const view = selectedView ?? saved?.view ?? 'slope';
  const vintages = selectedVintages ?? saved?.vintages;
  const sourceTarget = source && targetLabel(source.target);
  const targetChoice = target ? targetLabel(target) : '';
  const compatible = !!source && metric === source.metric && targetChoice === sourceTarget;
  const availableVintages = useMemo(() => (compatible && source ? source.vintages : [])
    .map(vintage => ({ vintage, time: metricVintageKey(vintage.observed_at) }))
    .sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0).map(item => item.vintage), [compatible, source]);
  const missingVintages = vintages?.filter(id => !availableVintages.some(vintage => vintage.id === id)) ?? [];
  const savedFields = saved?.fields;
  const fields = useMemo(() => roles.map(role => {
    const key = role.key as keyof Fields;
    const candidates = compatible && job ? bindingCandidates(role, job.columns) : [];
    const fallback = savedFields?.[key] ?? (candidates.length === 1 ? candidates[0].id : '');
    return { key, label: role.label, candidates, selected: editedFields[key] ?? fallback };
  }), [compatible, editedFields, job, savedFields]);
  const decoded = useMemo(() => decodeEstimateRevisionsOptions({
    kind: 'estimate-revisions', version: 1, metric, view, target, vintages: vintages ?? [],
    fields: Object.fromEntries(fields.map(({ key, selected }) => [key, selected])),
  }), [fields, metric, target, view, vintages]);
  const changed = !saved || metric !== saved.metric || view !== saved.view || targetChoice !== targetLabel(saved.target)
    || vintages?.length !== saved.vintages.length || !vintages.every(id => saved.vintages.includes(id))
    || fields.some(({ key, selected }) => saved.fields[key] !== selected);
  const canCheck = compatible && changed && decoded.ok && (view !== 'bump' || read?.bump) && !missingVintages.length;
  const candidate = canCheck && decoded.ok ? decoded.options : undefined;
  const { checked, current, minimum } = useMeasuredRecipe(job, candidate, surface.measured, surface.matches);
  const canApply = checked?.ok === true;
  const checking = !!candidate && (!checked || !checked.ok && !!checked.estimateRevisionsSurface);
  const issue = read?.error ?? (read && (changed || !saved) && (!source ? estimateVintageSourceIssue
    : !compatible ? 'Choose the exact metric and fiscal target from the acquired history.'
      : missingVintages.length ? 'A pinned acquired vintage is unavailable. Clear unavailable pins and choose recorded vintages.'
        : view === 'bump' && !read.bump ? 'Bump requires a verified complete universe, positive baselines and comparable current estimates for every member.'
          : !decoded.ok ? decoded.message : checked && !checked.ok && !checking ? checked.message : undefined));
  const toggleVintage = (id: string, checked: boolean) => setVintages(checked
    ? [...(vintages ?? []), id]
    : (vintages ?? []).filter(vintage => vintage !== id));
  return <details className="estimate-revisions-settings" open={!saved}>
    <summary>Estimate revision settings</summary>
    <div className="estimate-revisions-draft-probe" aria-hidden="true" ref={surface.element}>
      <ChartRenderer data={null} {...estimateSurface(vintages?.length ?? 0, minimum)} onDrawingSurfaceChange={surface.observe}/>
    </div>
    <fieldset className="estimate-revisions-controls" aria-label="Estimate revision settings" disabled={disabled}>
      <label>Metric<select value={metric} onChange={event => setMetric(event.target.value as Metric | '')}>
        <option value="">Choose metric</option>
        {Object.entries(metricLabels).map(([id, label]) =>
          <option key={id} value={id} disabled={id !== source?.metric}>{label}{id !== source?.metric ? ' (unavailable)' : ''}</option>)}
      </select></label>
      <label>Fiscal target<select value={targetChoice} onChange={event => setTarget(event.target.value ? source?.target ?? null : null)}>
        <option value="">Choose exact fiscal target</option>
        {targetChoice && targetChoice !== sourceTarget && <option value={targetChoice} disabled>{targetChoice} (unavailable)</option>}
        {sourceTarget && <option value={sourceTarget}>{sourceTarget}</option>}
      </select></label>
      <label>Revision view<select value={view} onChange={event => setView(event.target.value as View)}>
        <option value="slope">Slope</option>
        <option value="path">Time path</option>
        <option value="bump" disabled={!read?.bump}>Bump{!read?.bump && ' (requires a verified complete universe)'}</option>
      </select></label>
      <p>{view === 'bump' ? 'Pin the declared baseline and current batches. Each ranked vintage requires comparable values for the whole universe.'
        : 'Filter or select one issuer in the source table. Pin two recorded vintages for a slope or at least three for a time path.'}</p>
      {(availableVintages.length > 0 || missingVintages.length > 0) && <fieldset className="estimate-revisions-pins">
        <legend>Pinned vintages (UTC observation times)</legend>
        {availableVintages.map(vintage => <label key={vintage.id}>
          <input type="checkbox" checked={vintages?.includes(vintage.id) ?? false}
            onChange={event => toggleVintage(vintage.id, event.target.checked)}/>{vintageLabel(vintage)}
        </label>)}
        {missingVintages.map(id => <label key={id}>
          <input type="checkbox" checked onChange={() => toggleVintage(id, false)}/>{id} (unavailable pin)
        </label>)}
      </fieldset>}
      {fields.map(({ key, label, candidates, selected }) => <label key={key}>{label}
        <select value={selected} onChange={event => setFields({ ...editedFields, [key]: event.target.value })}>
          <option value="">Choose field</option>
          {selected && !candidates.some(column => column.id === selected) && <option value={selected} disabled>{selected} (unavailable)</option>}
          {candidates.map(column => <option key={column.id} value={column.id}>{column.label}</option>)}
        </select></label>)}
      {issue && <p role={read?.error || checked && !checked.ok && !checked.refused ? 'alert' : 'status'}>{issue}</p>}
      {checking && <span className="sr-only" role="status">Checking estimate revision settings…</span>}
      <button type="button" disabled={!canApply} aria-busy={checking || undefined} onClick={() => {
        if (canApply && candidate) onApply(candidate, current);
      }}>Apply chart settings</button>
    </fieldset>
  </details>;
}

const unavailableReading = {
  missing: 'Consensus missing at this vintage',
  omitted: 'Consensus omitted from the source presentation',
  'cell-error': 'Consensus unavailable due to a source cell error',
};
const formatLinearTicks = (range: readonly [number, number]) => linearAxisTicks(range);

function EstimateObservations({ data }: { data: EstimateRevisionData }) {
  const [expanded, setExpanded] = useState(false);
  const { series, target, metric, vintages, columns } = data;
  return <details className="estimate-revisions-details" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>Estimate revision observations</summary>
    {expanded && <>
      <p>{metricLabels[metric]} for fiscal target {targetLabel(target)}. Each point reflects the consensus recorded in its batch, including any later restatement at its later observation time.</p>
      {vintages.map((vintage, index) => {
        const column = columns[index];
        return <section key={vintage.id} aria-label={vintageLabel(vintage)}>
          <h4>{vintageLabel(vintage)}</h4>
          {column?.status === 'unavailable' && <p>Entire rank column unavailable. Missing comparable observations for {column.unavailableMembers.join(', ')}.</p>}
          <ul aria-label={`Original estimates for ${vintage.id}`}>
            {series.map(({ issuer, unitLabel, observations }) => {
              const { value, state, change, rank } = observations[index];
              const comparison = change && estimateChangeText(change, unitLabel);
              return <li key={issuer.issuer}>
                {issuer.issuer} · {state === 'value' ? `Consensus ${value} ${unitLabel}` : unavailableReading[state]}
                {rank !== null && ` · Rank ${rank} of ${series.length}`}
                {comparison && ` · From ${change.fromVintage} · Absolute change ${comparison.signedAbsolute} · Percentage change ${comparison.signedPercent}`}
                {index > 0 && !comparison && ' · Change unavailable without both numeric estimates'}
              </li>;
            })}
          </ul>
        </section>;
      })}
    </>}
  </details>;
}

export function LinkedEstimateRevisions({ view, job, options, context, parentReportsSourceStatus }: {
  view: ViewState; job?: Job; options: EstimateRevisionsOptions; context: RecipeContext; parentReportsSourceStatus: boolean;
}) {
  const surface = useMeasuredRecipeSurface(context);
  const { completed, checked, minimum } = useMeasuredRecipe(job, options, surface.measured, surface.matches);
  const retained = completed?.result.ok && completed.request.options === options && view.stale
    && (view.status === 'pending' || view.status === 'updating' || view.status === 'blocked' || view.status === 'failed')
    && completed.request.job.ready === view.ready && sameRecipeRevision(view.sourceRevision, completed.request.job.revision);
  const result = retained ? completed.result : checked;
  const output = result?.ok && result.estimateRevisions ? result : undefined;
  const hint = retained ? output?.estimateRevisionsSurface : minimum;
  const resizing = result && !result.ok && result.estimateRevisionsSurface;
  const drawable = useMemo(() => {
    if (!output || !surface.measured) return;
    const { box } = surface.measured;
    if (retained && !sameRecipeSurface(box, completed?.request.measured.box)) return;
    return { ...output.figure, layout: {
      ...output.figure.layout, width: Math.round(box.width), height: Math.round(box.height), autosize: false,
    } };
  }, [output, surface.measured, retained, completed]);
  return <>
    <div className="linked-chart-status">
      {retained && <p role="status">Showing completed data (stale).</p>}
      {(!result || resizing) && !view.error && <p role="status">{job ? 'Calculating estimate revisions…' : 'Loading the linked estimate history…'}</p>}
      {view.error && !parentReportsSourceStatus && <p role="alert">{view.error}</p>}
      {result && !result.ok && !resizing && <p role={result.refused ? 'status' : 'alert'}>{result.message}</p>}
      {output && <div role="status">{output.notes.map(note => <p key={note}>{note}</p>)}</div>}
    </div>
    {output?.estimateRevisions && <EstimateObservations data={output.estimateRevisions}/>}
    <div className="linked-chart-plot linked-chart-plot--revisions" ref={surface.element}>
      <ChartRenderer data={drawable} uirevision={output?.revision} {...estimateSurface(options.vintages.length, hint)}
        onDrawingSurfaceChange={surface.observe} touchScroll="overflow" preserveCartesianZoom
        formatYAxisTicks={options.view === 'bump' ? undefined : formatLinearTicks}/>
    </div>
  </>;
}
