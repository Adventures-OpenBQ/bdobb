// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ViewState } from '../../stores/tableExecutionStore';
import { readChartSource, readChartSourceProjection } from '../../lib/widgetData/chartRecipes/chartSourceContracts';
import type { OverlaySeriesPair } from '../../lib/widgetData/chartRecipes/dualAxisOverlay';
import { acquiredColumnOrigin } from '../../lib/widgetData/chartRecipes/financialEvidence';
import {
  overlayBindingOrigins, overlayPairIssue, overlaySourceIssue, parseOverlaySource, type OverlaySource,
} from '../../lib/widgetData/chartRecipes/overlayEvidence';
import { overlayAxisTicks, overlayOriginalValue } from '../../lib/widgetData/chartRecipes/overlayDisplay';
import { decodeDualAxisOverlayOptions } from '../../lib/widgetData/chartRecipes/settings';
import type { DualAxisOverlayOptions, RecipeContext } from '../../lib/widgetData/chartRecipes/types';
import { dualAxisOverlayMinPlotHeight, dualAxisOverlayMinPlotWidth } from '../../lib/widgetData/chartRecipes/viewport';
import type { DatasetColumn } from '../../lib/widgetData/types';
import { ChartRenderer } from './ChartRenderer';
import { recipeErrorText, sameRecipeRevision, sameRecipeSurface, useMeasuredRecipe,
  useMeasuredRecipeSurface, type MeasuredRecipeJob } from './useMeasuredRecipe';
import { createPortal } from 'react-dom';
import { OpenLinkedParameters } from './LinkedParametersPortal';

const pairs = {
  'price-eps': 'Adjusted closing price and reported diluted EPS',
  'cpi-ten-year': 'CPI and ten-year Treasury yield',
} as const;
const labels = {
  series: 'Series identifier', date: 'Observation date', value: 'Value',
  availableAt: 'Release availability', targetStart: 'Fiscal quarter start', targetEnd: 'Fiscal quarter end',
} as const;
const roles = Object.keys(overlayBindingOrigins) as (keyof typeof overlayBindingOrigins)[];
type Job = MeasuredRecipeJob<DualAxisOverlayOptions>;
type Pair = DualAxisOverlayOptions['recipe'];
type Fields = Partial<DualAxisOverlayOptions['fields']>;

export function overlayInputFields(columns: DatasetColumn[], options?: DualAxisOverlayOptions) {
  if (!options) return [];
  const fields = columns.map(column => ({ id: column.id, origin: acquiredColumnOrigin(column) }));
  const ids = new Set(fields.filter(field => field.origin === 'release_ref' || field.origin === 'session_timing').map(field => field.id));
  for (const role of roles) {
    const candidates = fields.filter(field => field.origin === overlayBindingOrigins[role]);
    for (const { id } of candidates) {
      // Pass all duplicate origins so the worker refuses ambiguous presentations.
      if (candidates.length > 1 || id === options.fields[role]) ids.add(id);
    }
  }
  return [...ids];
}

function useOverlaySource(job: Job | undefined) {
  const [read, setRead] = useState<{ job: Job; source?: OverlaySource; error?: string }>();
  useEffect(() => {
    if (!job) return;
    const controller = new AbortController();
    const { signal } = controller;
    void job.load(signal).then(({ provenance }) => {
      const source = readChartSourceProjection(provenance, 'overlay')
        ? readChartSource(provenance, 'overlay', parseOverlaySource) : undefined;
      if (!signal.aborted && job.current()) setRead({ job, source });
    }).catch(error => {
      if (!signal.aborted && job.current()) setRead({ job, error: recipeErrorText(error) });
    });
    return () => controller.abort();
  }, [job]);
  return read?.job === job ? read : undefined;
}

export function DualAxisOverlayControls({ probeTarget, job, saved, context, disabled, onApply }: {
  probeTarget: HTMLElement | null;
  job?: Job;
  saved?: DualAxisOverlayOptions;
  context: RecipeContext;
  disabled: boolean;
  onApply: (options: DualAxisOverlayOptions, guard: () => boolean) => void;
}) {
  const surface = useMeasuredRecipeSurface(context);
  const [selectedPair, setPair] = useState<Pair>();
  const [edited, setEdited] = useState<Fields>({});
  const read = useOverlaySource(job);
  const pair = selectedPair ?? saved?.recipe ?? read?.source?.recipe ?? 'price-eps';
  const compatible = read?.source?.recipe === pair;
  const savedFields = saved?.recipe === pair ? saved.fields : undefined;
  const fields = useMemo(() => roles.flatMap(role => {
    if (pair === 'cpi-ten-year' && (role === 'targetStart' || role === 'targetEnd') && !savedFields?.[role]) return [];
    const optional = pair === 'cpi-ten-year' && role !== 'series' && role !== 'date' && role !== 'value';
    const candidates = compatible ? job?.columns.filter(column =>
      acquiredColumnOrigin(column) === overlayBindingOrigins[role] && (role !== 'value' || !column.dtype || column.dtype === 'number')) ?? [] : [];
    const fallback = savedFields ? savedFields[role] ?? '' : candidates.length === 1 ? candidates[0].id : '';
    return [{ role, candidates, selected: edited[role] ?? fallback, optional }];
  }), [compatible, edited, job, pair, savedFields]);
  const decoded = useMemo(() => decodeDualAxisOverlayOptions({
    kind: 'dual-axis-overlay', version: 1, recipe: pair,
    fields: Object.fromEntries(fields.filter(field => field.selected || !field.optional)
      .map(({ role, selected }) => [role, selected])),
  }), [fields, pair]);
  const candidate = decoded.ok ? decoded.options : undefined;
  const changed = !saved || pair !== saved.recipe || fields.some(({ role, selected }) => (saved.fields[role] ?? '') !== selected);
  const { checked, current } = useMeasuredRecipe(job, compatible && changed ? candidate : undefined, surface.measured, surface.matches);
  const canApply = checked?.ok === true;
  const checking = !!job && compatible && changed && !!candidate && !checked;
  const issue = read?.error ?? (read && changed && (!read.source ? overlaySourceIssue : !compatible ? overlayPairIssue
    : !decoded.ok ? decoded.message : checked && !checked.ok ? checked.message : undefined));
  return <>
    {probeTarget && createPortal(<div className="dual-axis-overlay-draft-probe" aria-hidden="true" ref={surface.element}>
      <ChartRenderer data={null} scrollHeight={dualAxisOverlayMinPlotHeight} minPlotWidth={dualAxisOverlayMinPlotWidth}
        onDrawingSurfaceChange={surface.observe}/>
    </div>, probeTarget)}
    <fieldset className="dual-axis-overlay-controls" aria-label="Dual-axis overlay settings" disabled={disabled}>
      <label>Overlay recipe<select value={pair} onChange={event => {
        setPair(event.target.value as Pair);
        setEdited({});
      }}>
        {Object.entries(pairs).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {fields.map(({ role, candidates, selected, optional }) => <label key={role}>{labels[role]}
        <select value={selected} onChange={event => setEdited({ ...edited, [role]: event.target.value })}>
          <option value="">{optional ? 'No field' : 'Choose field'}</option>
          {selected && !candidates.some(column => column.id === selected) && <option value={selected} disabled>{selected} (unavailable)</option>}
          {candidates.map(column => <option key={column.id} value={column.id}>{column.label}</option>)}
        </select></label>)}
      {issue && <p role={checked && !checked.ok && !checked.refused ? 'alert' : 'status'}>{issue}</p>}
      {checking && <span className="sr-only" role="status">Checking overlay settings…</span>}
      <button type="button" disabled={!canApply} aria-busy={checking || undefined} onClick={() => {
        if (canApply && candidate) onApply(candidate, current);
      }}>Apply chart settings</button>
    </fieldset>
  </>;
}

function OverlayObservations({ pair }: { pair: OverlaySeriesPair }) {
  const [expanded, setExpanded] = useState(false);
  return <details className="dual-axis-overlay-details" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>Overlay observations</summary>
    {expanded && [pair.left, pair.right].map(series => <section key={series.fact.id} aria-label={series.title}>
      <h4>{series.title} ({series.unitLabel})</h4>
      <p>Input {series.inputReference} · Acquired {series.vintage}</p>
      <ul aria-label={series.title + ' original observations'}>
        {series.points.map(point => <li key={point.id}>
          {point.targetStart && point.targetEnd ? `Fiscal quarter ${point.targetStart} to ${point.targetEnd}`
            : series.fact.id === 'CUSR0000SA0' ? `Measurement month ${point.coordinate.slice(0, 7)}`
            : series.fact.id === 'adjusted_close' ? `Session date ${point.coordinate}` : point.coordinate}
          {' · '}{point.state === 'omitted' ? 'Omitted from the presentation' : point.value === null ? 'Explicit missing observation'
            : overlayOriginalValue(point.value, series.fact.unit, series.unitLabel)}
          {point.availableAt ? ` · Available ${point.availableAt}${point.availableAt.length === 10 ? ' (date only)' : ''}`
            : point.state !== 'omitted' && (series.fact.id === 'CUSR0000SA0' || series.fact.id === 'DGS10') ? ' · Release timing unavailable' : ''}
          {point.sessionTiming && ` · Reported session timing ${point.sessionTiming}`}
          {point.releaseReference && ` · Release reference ${point.releaseReference}`}
          {series.fact.id === 'reported_diluted_eps' && point.state !== 'omitted' &&
            (series.fact.restated ? ' · currently restated; not historical as-known' : ' · current acquisition; not historical as-known')}
        </li>)}
      </ul>
    </section>)}
  </details>;
}

export function LinkedDualAxisOverlay({ view, job, options, context, parentReportsSourceStatus, onOpenParameters }: {
  view: ViewState; job?: Job; options: DualAxisOverlayOptions; context: RecipeContext; parentReportsSourceStatus: boolean; onOpenParameters?: () => void;
}) {
  const surface = useMeasuredRecipeSurface(context);
  const { completed, checked, remeasuring } = useMeasuredRecipe(job, options, surface.measured, surface.matches);
  const pending = view.status === 'pending' || view.status === 'updating';
  const retained = completed?.result.ok && view.stale && (pending || view.status === 'blocked' || view.status === 'failed')
    && completed.request.job.ready === view.ready && sameRecipeRevision(view.sourceRevision, completed.request.job.revision);
  const result = retained || remeasuring ? completed?.result : checked;
  const drawing = (remeasuring ? completed?.request.measured : surface.measured)?.box;
  const output = result?.ok && result.overlay ? result : undefined;
  const pair = output?.overlay;
  const leftUnit = pair?.left.fact.unit, rightUnit = pair?.right.fact.unit;
  const formatLeft = useCallback((range: readonly [number, number]) => overlayAxisTicks(range, leftUnit!), [leftUnit]);
  const formatRight = useCallback((range: readonly [number, number]) => overlayAxisTicks(range, rightUnit!), [rightUnit]);
  const drawable = useMemo(() => {
    if (!output || !drawing) return;
    const box = drawing;
    if (retained && !sameRecipeSurface(box, completed?.request.measured.box)) return;
    return { ...output.figure, layout: {
      ...output.figure.layout, width: Math.round(box.width), height: Math.round(box.height), autosize: false,
    } };
  }, [output, drawing, retained, completed]);
  return <>
    <div className="linked-chart-status">
      {retained && <p role="status">Showing completed data (stale).</p>}
      {!result && !view.error && <p role="status">{job ? 'Calculating dual-axis overlay…' : 'Loading the linked overlay source…'}</p>}
      {view.error && !parentReportsSourceStatus && <p role="alert">{view.error}</p>}
      {result && !result.ok && <p role={result.refused ? 'status' : 'alert'}>{result.message}</p>}
      {result && !result.ok && <OpenLinkedParameters onOpen={onOpenParameters}/>}
      {output && <div role="status">{output.notes.map(note => <p key={note}>{note}</p>)}</div>}
    </div>
    {pair && <OverlayObservations pair={pair}/>}
    <div className="linked-chart-plot linked-chart-plot--overlay" ref={surface.element}>
      <ChartRenderer data={drawable} uirevision={output?.revision} scrollHeight={dualAxisOverlayMinPlotHeight}
        minPlotWidth={dualAxisOverlayMinPlotWidth} onDrawingSurfaceChange={surface.observe} touchScroll="overflow"
        formatYAxisTicks={formatLeft} formatSecondYAxisTicks={formatRight} preserveCartesianZoom/>
    </div>
  </>;
}
