// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ViewState } from '../../stores/tableExecutionStore';
import type { DatasetColumn } from '../../lib/widgetData/types';
import { marketMapBindingRoles } from '../../lib/widgetData/chartRecipes/bindings';
import { readChartSource, readChartSourceProjection } from '../../lib/widgetData/chartRecipes/chartSourceContracts';
import { acquiredColumnOrigin } from '../../lib/widgetData/chartRecipes/financialEvidence';
import type { MarketMapHierarchy } from '../../lib/widgetData/chartRecipes/marketMap';
import { marketMapIdentityFields, parseMarketMapSource, type MarketMapSource } from '../../lib/widgetData/chartRecipes/marketMapEvidence';
import { decodeMarketMapOptions, marketMapFieldOrigins } from '../../lib/widgetData/chartRecipes/settings';
import type { MarketMapOptions, RecipeContext } from '../../lib/widgetData/chartRecipes/types';
import { marketMapMinPlotHeight, marketMapMinPlotWidth } from '../../lib/widgetData/chartRecipes/viewport';
import { ChartRenderer } from './ChartRenderer';
import { recipeErrorText, retainsStaleMeasuredRecipe, useMeasuredRecipe, useMeasuredRecipeSurface, type MeasuredRecipeJob } from './useMeasuredRecipe';
import { createPortal } from 'react-dom';
import { OpenLinkedParameters } from './LinkedParametersPortal';

const sourceProblem = 'Relink a verified local market-map acquisition with a completed session and acquired capitalization or index weights.';
const inputOrigins = new Set<string>([...marketMapFieldOrigins, ...marketMapIdentityFields]);
type Job = MeasuredRecipeJob<MarketMapOptions>;

export function marketMapInputFields(columns: DatasetColumn[], options?: MarketMapOptions) {
  const boundIds = new Set(options && Object.values(options.fields));
  // Include conflicting aliases and calculated lookalikes in the projection so
  // the worker can refuse them. A stripped companion cannot repair acquisition.
  return [...new Set(columns.filter(column => boundIds.has(column.id) || inputOrigins.has(column.sourceFieldId ?? column.id))
    .map(column => column.id))];
}

export function MarketMapControls({ probeTarget, saved, context, job, disabled, onApply }: {
  probeTarget: HTMLElement | null;
  saved?: MarketMapOptions; context: RecipeContext; job?: Job; disabled: boolean;
  onApply: (options: MarketMapOptions, guard: () => boolean) => void;
}) {
  const surface = useMeasuredRecipeSurface(context);
  const [mode, setMode] = useState<MarketMapOptions['mode']>(saved?.mode ?? 'delivered-cap');
  const [session, setSession] = useState(saved?.session ?? 'latest');
  const [edited, setEdited] = useState<Partial<MarketMapOptions['fields']>>(saved?.fields ?? {});
  const [loaded, setLoaded] = useState<{ job: Job; source?: MarketMapSource; error?: string }>();
  useEffect(() => {
    if (!job) return;
    const controller = new AbortController();
    const { signal } = controller;
    void job.load(signal).then(({ provenance }) => {
      const source = readChartSourceProjection(provenance, 'market-map')
        ? readChartSource(provenance, 'market-map', parseMarketMapSource) : undefined;
      if (!signal.aborted && job.current()) setLoaded({ job, source });
    }).catch(error => { if (!signal.aborted && job.current()) setLoaded({ job, error: recipeErrorText(error) }); });
    return () => controller.abort();
  }, [job]);

  const read = job && loaded?.job === job ? loaded : undefined;
  const source = read?.source;
  const indexAvailable = source?.mode === 'index-weight' && !source.diagnostics.length;
  const universe = mode === 'delivered-cap' ? 'delivered-sample' : source?.mode === 'index-weight' ? source.universe
    : saved?.mode === 'index-weight' ? saved.universe : '';
  const compatible = source?.mode === mode && source.universe === universe;
  const acquired = compatible ? source.session : undefined;
  const fields = useMemo(() => marketMapBindingRoles.map(role => {
    const originColumns = job?.columns.filter(column => (column.sourceFieldId ?? column.id) === role.key);
    const physical = originColumns?.length === 1 ? originColumns[0] : undefined;
    const candidates = physical && acquiredColumnOrigin(physical) === role.key ? [physical] : [];
    const selected = edited[role.key] ?? (candidates.length === 1 ? candidates[0].id : '');
    return { ...role, candidates, selected };
  }), [job, edited]);
  const decoded = useMemo(() => decodeMarketMapOptions({
    version: 1, kind: 'market-map', mode, universe, session,
    fields: Object.fromEntries(fields.map(({ key, selected }) => [key, selected])),
  }), [mode, universe, session, fields]);
  const candidate = decoded.ok ? decoded.options : undefined;
  const changed = candidate && (!saved || candidate.mode !== saved.mode || candidate.universe !== saved.universe
    || candidate.session !== saved.session || marketMapFieldOrigins.some(key => candidate.fields[key] !== saved.fields[key]));
  const canCheck = !!source && !!changed && !!candidate;
  const { checked, current } = useMeasuredRecipe(job, canCheck ? candidate : undefined, surface.measured, surface.matches);
  const checking = canCheck && !checked;
  const problem = read?.error ?? (read && !source && !saved ? sourceProblem
    : source && !decoded.ok ? decoded.message
      : checked && !checked.ok ? checked.message : undefined);

  return <>
    {probeTarget && createPortal(<div className="market-map-draft-probe" aria-hidden="true" ref={surface.element}>
      <ChartRenderer data={null} scrollHeight={marketMapMinPlotHeight} minPlotWidth={marketMapMinPlotWidth}
        onDrawingSurfaceChange={surface.observe}/>
    </div>, probeTarget)}
    <fieldset className="market-map-controls" aria-label="Market map settings" disabled={disabled}>
      <label>Area basis <select value={mode} onChange={event => {
        setMode(event.target.value === 'index-weight' ? 'index-weight' : 'delivered-cap');
      }}>
        <option value="delivered-cap">Delivered-sample capitalization</option>
        <option value="index-weight" disabled={!indexAvailable}>Named index weights</option>
      </select></label>
      <label>Universe <select value={universe} disabled>
        <option value={universe}>{mode === 'delivered-cap' ? 'Delivered sample' : universe || 'Acquired index unavailable'}</option>
      </select></label>
      <label>Completed session <select value={session} onChange={event => setSession(event.target.value)}>
        <option value="latest">Latest acquired</option>
        {session !== 'latest' && session !== acquired && <option value={session} disabled>{session} (unavailable)</option>}
        {acquired && <option value={acquired}>{acquired}</option>}
      </select></label>
      {fields.map(({ key, label, candidates, selected }) => <label key={key}>{label}
        <select value={selected} onChange={event => setEdited({ ...edited, [key]: event.target.value })}>
          <option value="">Choose field</option>
          {selected && !candidates.some(column => column.id === selected) && <option value={selected} disabled>{selected} (unavailable)</option>}
          {candidates.map(column => <option key={column.id} value={column.id}>{column.label}</option>)}
        </select>
      </label>)}
      {problem && <p role={checked && !checked.ok && !checked.refused ? 'alert' : 'status'}>{problem}</p>}
      {checking && <span className="sr-only" role="status">Checking market map settings…</span>}
      <button type="button" aria-busy={checking || undefined} disabled={checked?.ok !== true} onClick={() => {
        if (candidate && checked?.ok && current()) onApply(candidate, current);
      }}>Apply chart settings</button>
    </fieldset>
  </>;
}

const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumSignificantDigits: 17 });
const scientificPercent = new Intl.NumberFormat('en-US', { style: 'percent', notation: 'scientific', maximumSignificantDigits: 17 });
const fraction = (value: number) => {
  const format = value && (Math.abs(value) < .00001 || Math.abs(value) >= 1e6) ? scientificPercent : percent;
  return `${format.format(value)} · fraction ${value}`;
};

function MarketMapDetails({ map, level }: { map: MarketMapHierarchy; level: string }) {
  const [expanded, setExpanded] = useState(false);
  const exactArea = (area: number) => map.denomination ? `${area} ${map.denomination}` : fraction(area);
  return <details className="market-map-details" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>Market map details</summary>
    {expanded && <>
      <p>{map.root.label} · {exactArea(map.root.value)}</p>
      <ul aria-label="Derived sector areas">
        {map.sectors.filter(node => !level || node.id === level).map(node =>
          <li key={node.id}>{node.label} · {exactArea(node.value)}</li>)}
      </ul>
      <table aria-label="Original listing values">
        <thead><tr><th scope="col">Listing</th><th scope="col">Sector</th>
          <th scope="col">{map.denomination ? 'Capitalization' : 'Index weight'}</th><th scope="col">Completed-session return</th></tr></thead>
        <tbody>{map.listings.filter(node => !level || node.parentId === level).map(node => <tr key={node.id}>
          <th scope="row">{node.listing}</th><td>{node.sector ?? 'Sector unavailable'}</td>
          <td>{exactArea(node.value)}</td><td>{node.change === null ? 'Return unavailable' : fraction(node.change)}</td>
        </tr>)}</tbody>
      </table>
    </>}
  </details>;
}

export function LinkedMarketMap({ view, job, options, context, parentReportsSourceStatus, onOpenParameters }: {
  view: ViewState; job?: Job; options: MarketMapOptions; context: RecipeContext; parentReportsSourceStatus: boolean; onOpenParameters?: () => void;
}) {
  const surface = useMeasuredRecipeSurface(context);
  const { completed, checked, remeasuring } = useMeasuredRecipe(job, options, surface.measured, surface.matches);
  const retained = retainsStaleMeasuredRecipe(completed, view, options, context);
  const keepDrawing = retained || remeasuring;
  const result = keepDrawing ? completed?.result : checked;
  const drawing = (keepDrawing ? completed?.request.measured : surface.measured)?.box;
  const output = result?.ok ? result : undefined;
  const map = output?.marketMap;
  const revision = output?.revision;
  const root = map?.root.id;
  const sectors = map?.sectors;
  const [drill, setDrill] = useState<{ revision: string; id: string }>();
  const level = drill && drill.revision === revision && (drill.id === root || sectors?.some(node => node.id === drill.id))
    ? drill.id : '';
  const selected = level === root ? '' : level;
  const navigate = useCallback((id: string) => {
    if (revision && (id === '' || id === root || sectors?.some(node => node.id === id))) setDrill({ revision, id });
  }, [revision, root, sectors]);
  const drawable = useMemo(() => {
    if (!output || !drawing) return;
    const box = drawing;
    const [trace] = output.figure.data as Record<string, unknown>[];
    return { data: [{ ...trace, level }], layout: {
      ...output.figure.layout, width: box.width, height: box.height, autosize: false,
    } };
  }, [output, drawing, level]);

  return <>
    <div className="linked-chart-status">
      {retained && <p role="status">Showing completed data (stale).</p>}
      {!result && !view.error && <p role="status">{job ? 'Calculating market map…' : 'Loading the linked market snapshot…'}</p>}
      {view.error && !parentReportsSourceStatus && <p role="alert">{view.error}</p>}
      {result && !result.ok && <p role={result.refused ? 'status' : 'alert'}>{result.message}</p>}
      {result && !result.ok && <OpenLinkedParameters onOpen={onOpenParameters}/>}
      {map && <div role="status">
        {output?.notes.map(note => <p key={note}>{note}</p>)}
        {map.mode === 'index-weight' && <p>Acquired weights attested valid for {map.session}.</p>}
      </div>}
    </div>
    {!!sectors?.length && <div className="market-map-navigation">
      <button type="button" onClick={() => navigate('')}>Home</button>
      <label>Sector view <select value={selected} onChange={event => navigate(event.target.value)}>
        <option value="">Universe overview</option>
        {sectors.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}
      </select></label>
    </div>}
    {map && <MarketMapDetails map={map} level={selected}/>}
    <div className="linked-chart-plot linked-chart-plot--market" ref={surface.element}>
      <ChartRenderer data={drawable} uirevision={revision} scrollHeight={marketMapMinPlotHeight} minPlotWidth={marketMapMinPlotWidth}
        touchScroll="overflow" onDrawingSurfaceChange={surface.observe} retainedSurface={retained ? drawing : undefined} onTreemapLevelChange={navigate}/>
    </div>
  </>;
}
