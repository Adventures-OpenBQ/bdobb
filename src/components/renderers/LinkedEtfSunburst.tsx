// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LocalWorkerExecutor } from '../../lib/tableExecution/types';
import type { ViewState } from '../../stores/tableExecutionStore';
import { readChartSource, readChartSourceProjection } from '../../lib/widgetData/chartRecipes/chartSourceContracts';
import { etfSnapshotKey, parseEtfHierarchySource } from '../../lib/widgetData/chartRecipes/etfHierarchyEvidence';
import type { EtfHierarchy } from '../../lib/widgetData/chartRecipes/etfSunburst';
import { acquiredColumnOrigin } from '../../lib/widgetData/chartRecipes/financialEvidence';
import { decodeRecipeOptions } from '../../lib/widgetData/chartRecipes/settings';
import type { EtfSunburstOptions, RecipeContext } from '../../lib/widgetData/chartRecipes/types';
import type { DatasetColumn } from '../../lib/widgetData/types';
import { ChartRenderer } from './ChartRenderer';
import {
  recipeErrorText, retainsStaleMeasuredRecipe, useMeasuredRecipe, useMeasuredRecipeJob,
  useMeasuredRecipeSurface, type MeasuredRecipeJob,
} from './useMeasuredRecipe';
import { createPortal } from 'react-dom';
import { OpenLinkedParameters } from './LinkedParametersPortal';

const plotWidth = 340;
const plotHeight = 280;
const sourceProblem = 'Acquire the fund holdings with verified fractional weights on a common fund-assets basis.';
const roles = {
  holding: ['symbol', 'Holding'],
  sector: ['sector', 'Sector'],
  weight: ['weight', 'Fund weight'],
} as const;
const acquiredOrigins = new Set(['symbol', 'sector', 'weight', 'fund_symbol', 'snapshot',
  'weight_basis', 'weight_unit', 'unit', 'basis', 'etf_kind', 'as_of', 'holdings_coverage']);
const recipeRoles = Object.keys(roles) as (keyof typeof roles)[];

function etfInputFields(columns: DatasetColumn[], options?: EtfSunburstOptions) {
  if (!options) return [];
  const acquiredFields = columns.filter(column => acquiredOrigins.has(acquiredColumnOrigin(column) ?? '')).map(column => column.id);
  const available = new Set(columns.map(column => column.id));
  return [...new Set([...acquiredFields, ...Object.values(options.fields).filter(id => available.has(id))])];
}

export function useEtfSunburstJob(sourceCurrent: boolean, view: ViewState, executor: LocalWorkerExecutor | undefined,
  sourceId: string | undefined, readCurrent: () => { view: ViewState; executor?: LocalWorkerExecutor; sourceCurrent: boolean }) {
  return useMeasuredRecipeJob(sourceCurrent, view, executor, sourceId, readCurrent, etfInputFields, 'ETF holdings');
}

type Job = MeasuredRecipeJob<EtfSunburstOptions>;

export function EtfSunburstControls({ probeTarget, saved, context, job, disabled, onApply }: {
  probeTarget: HTMLElement | null;
  saved?: EtfSunburstOptions;
  context: RecipeContext;
  job?: Job;
  disabled: boolean;
  onApply: (options: EtfSunburstOptions, guard: () => boolean) => void;
}) {
  const surface = useMeasuredRecipeSurface(context);
  const [fund, setFund] = useState(saved?.fund);
  const [snapshot, setSnapshot] = useState(saved?.snapshot ?? 'latest');
  const [depth, setDepth] = useState(saved?.depth ?? 2);
  const [edited, setEdited] = useState<Partial<EtfSunburstOptions['fields']>>(saved?.fields ?? {});
  const [read, setRead] = useState<{ job: Job; source?: ReturnType<typeof parseEtfHierarchySource>; error?: string }>();
  useEffect(() => {
    if (!job) return;
    const controller = new AbortController();
    const { signal } = controller;
    void job.load(signal).then(dataset => {
      const { provenance } = dataset;
      const source = readChartSourceProjection(provenance, 'etf-hierarchy')
        ? readChartSource(provenance, 'etf-hierarchy', parseEtfHierarchySource) : undefined;
      if (!signal.aborted && job.current()) setRead({ job, source });
    }).catch(error => { if (!signal.aborted && job.current()) setRead({ job, error: recipeErrorText(error) }); });
    return () => controller.abort();
  }, [job]);

  const currentRead = job && read?.job === job ? read : undefined;
  const source = currentRead?.source;
  const listing = fund ?? source?.fund ?? '';
  const acquiredSnapshot = source?.snapshot;
  const matchesPin = acquiredSnapshot !== undefined && etfSnapshotKey(acquiredSnapshot) === etfSnapshotKey(snapshot);
  const snapshotValue = matchesPin ? snapshot : acquiredSnapshot;
  const fields = useMemo(() => recipeRoles.map(role => {
    const [origin, label] = roles[role];
    const candidates = job?.columns.filter(column => acquiredColumnOrigin(column) === origin) ?? [];
    const selected = edited[role] ?? (candidates.length === 1 ? candidates[0].id : '');
    return { role, label, candidates, selected };
  }), [job, edited]);
  const decoded = useMemo(() => decodeRecipeOptions({
    kind: 'etf-sunburst', version: 1, fund: listing, snapshot, depth,
    fields: Object.fromEntries(fields.map(({ role, selected }) => [role, selected])),
  }, 'etf-sunburst'), [listing, snapshot, depth, fields]);
  const candidate = decoded.ok && decoded.options.kind === 'etf-sunburst' ? decoded.options : undefined;
  const changed = Boolean(candidate && (!saved || candidate.fund !== saved.fund || candidate.snapshot !== saved.snapshot
    || candidate.depth !== saved.depth || recipeRoles.some(role => candidate.fields[role] !== saved.fields[role])));
  const { checked, pendingRefusal } = useMeasuredRecipe(job, source && changed ? candidate : undefined, surface.measured, surface.matches);
  const diagnostic = checked ?? pendingRefusal;
  const checking = !!job && !!source && changed && !checked;
  const canApply = checked?.ok === true;
  const problem = !currentRead ? undefined : currentRead.error ?? (!source ? (saved ? undefined : sourceProblem)
    : !decoded.ok ? decoded.message : diagnostic && !diagnostic.ok ? diagnostic.message : undefined);
  const snapshotLabel = acquiredSnapshot === source?.as_of ? `As of ${acquiredSnapshot}` : `Acquired vintage ${acquiredSnapshot}`;
  return <>
    {probeTarget && createPortal(<div className="etf-sunburst-draft-probe" aria-hidden="true" ref={surface.element}>
      <ChartRenderer data={null} scrollHeight={plotHeight} minPlotWidth={plotWidth} onDrawingSurfaceChange={surface.observe}/>
    </div>, probeTarget)}
    <fieldset className="etf-sunburst-controls" disabled={disabled} aria-label="ETF sunburst settings">
      <label>Fund<select value={listing} onChange={event => setFund(event.target.value)}>
        {!listing && <option value="">Choose acquired holdings</option>}
        {listing && listing !== source?.fund && <option value={listing} disabled>{listing} (unavailable)</option>}
        {source && <option value={source.fund}>{source.fund}</option>}
      </select></label>
      <label>Snapshot<select value={snapshot} onChange={event => setSnapshot(event.target.value)}>
        <option value="latest">Latest acquired</option>
        {snapshot !== 'latest' && !matchesPin && <option value={snapshot} disabled>{snapshot} (unavailable)</option>}
        {snapshotValue && <option value={snapshotValue}>{snapshotLabel}</option>}
      </select></label>
      <label>Hierarchy depth<select value={depth} onChange={event => setDepth(event.target.value === '1' ? 1 : 2)}>
        <option value="1">Sectors</option><option value="2">Sectors and holdings</option>
      </select></label>
      {fields.map(({ role, label, candidates, selected }) => <label key={role}>{label}
        <select value={selected} onChange={event => setEdited({ ...edited, [role]: event.target.value })}>
          <option value="">Choose field</option>
          {selected && !candidates.some(column => column.id === selected) && <option value={selected} disabled>{selected} (unavailable)</option>}
          {candidates.map(column => <option value={column.id} key={column.id}>{column.label}</option>)}
        </select></label>)}
      {problem && <p role="status">{problem}</p>}
      {checking && <span className="sr-only" role="status">Checking ETF sunburst settings…</span>}
      <button type="button" disabled={!canApply} aria-busy={checking || undefined} onClick={() => {
        if (!canApply || !job || !candidate || !surface.measured) return;
        const { box } = surface.measured;
        onApply(candidate, () => job.current() && surface.matches(box));
      }}>Apply chart settings</button>
    </fieldset>
  </>;
}

type Node = EtfHierarchy['root'] | EtfHierarchy['sectors'][number] | EtfHierarchy['holdings'][number] | NonNullable<EtfHierarchy['residual']>;
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumSignificantDigits: 17 });
const scientificPercent = new Intl.NumberFormat('en-US', { style: 'percent', notation: 'scientific', maximumSignificantDigits: 17 });
const percentage = (value: number) => (value > 0 && value < 1e-6 ? scientificPercent : percent).format(value);

function originalWeight({ value, deliveredShare }: Node) {
  return `${value} fund-assets fraction · ${percentage(value)} of fund assets${deliveredShare === null
    ? '' : ` · ${percentage(deliveredShare)} of delivered holdings (${deliveredShare} share)`}`;
}

function EtfDetails({ hierarchy, level }: { hierarchy: EtfHierarchy; level: string }) {
  const { root, sectors, holdings, residual } = hierarchy;
  const visibleHoldings = level ? holdings.filter(holding => holding.parentId === level) : holdings;
  const visibleSectors = level ? sectors.filter(sector => sector.id === level) : [...sectors, ...(residual ? [residual] : [])];
  return <details className="etf-sunburst-details">
    <summary>ETF holdings details</summary>
    <p>{root.label} · {originalWeight(root)}</p>
    <ul aria-label="Original sector weights">
      {visibleSectors.map(node => <li key={node.id}>{node.label} · {originalWeight(node)}
        {node.kind === 'residual' && ` · Source ${node.reference}`}</li>)}
    </ul>
    <ul aria-label="Original holding weights">
      {visibleHoldings.map(node => <li key={node.id}>{node.symbol} · {node.sector ?? 'Sector unavailable'} · {originalWeight(node)}</li>)}
    </ul>
  </details>;
}

export function LinkedEtfSunburst({ view, job, options, sourceId, context, parentReportsSourceStatus, onOpenParameters }: {
  view: ViewState; job?: Job; options: EtfSunburstOptions; sourceId?: string; context: RecipeContext; parentReportsSourceStatus: boolean; onOpenParameters?: () => void;
}) {
  const surface = useMeasuredRecipeSurface(context);
  const { completed, checked, remeasuring } = useMeasuredRecipe(job, options, surface.measured, surface.matches);
  const retained = retainsStaleMeasuredRecipe(completed, view, options, context);
  const keepDrawing = retained || remeasuring;
  const result = keepDrawing ? completed?.result : checked;
  const drawing = (keepDrawing ? completed?.request.measured : surface.measured)?.box;
  const output = result?.ok && result.etfHierarchy ? result : undefined;
  const hierarchy = output?.etfHierarchy;
  const [drill, setDrill] = useState<{ revision: string; id: string }>();
  const sectors = options.depth === 2 && hierarchy ? hierarchy.sectors.filter(node => node.value > 0) : [];
  const level = drill?.revision === output?.revision && sectors.some(sector => sector.id === drill?.id) ? drill!.id : '';
  const revision = output?.revision;
  const rootId = hierarchy?.root.id;
  const navigate = useCallback((id: string) => {
    if (revision) setDrill({ revision, id: id === rootId ? '' : id });
  }, [revision, rootId]);
  const drawable = useMemo(() => {
    if (!output?.figure.data.length || !drawing) return;
    const { width, height } = drawing;
    const [trace] = output.figure.data as Record<string, unknown>[];
    return { data: [{ ...trace, level }], layout: {
      ...output.figure.layout, width: Math.round(width), height: Math.round(height), autosize: false,
    } };
  }, [output, drawing, level]);

  return <>
    <div className="linked-chart-status">
      {retained && <p role="status">Showing completed data (stale).</p>}
      {!result && !view.error && <p role="status">{job ? 'Calculating ETF sunburst…'
        : sourceId ? `Loading source ${sourceId}…` : 'Select an available source table.'}</p>}
      {view.error && !parentReportsSourceStatus && <p role="alert">{view.error}</p>}
      {result && !result.ok && <p role={result.refused ? 'status' : 'alert'}>{result.message}</p>}
      {result && !result.ok && <OpenLinkedParameters onOpen={onOpenParameters}/>}
      {hierarchy && <div role="status">
        {hierarchy.asOf === null && <p>Report date unknown · Retrieved {hierarchy.retrievedAt}.</p>}
        {output?.notes.map(note => <p key={note}>{note}</p>)}
        {!hierarchy.root.value && <p>All visible holdings have zero weight.</p>}
      </div>}
    </div>
    {sectors.length > 0 && <div className="etf-sunburst-navigation">
      <button type="button" onClick={() => navigate('')}>Home</button>
      <label>Sector view <select value={level} onChange={event => navigate(event.target.value)}>
        <option value="">Fund overview</option>
        {sectors.map(sector => <option value={sector.id} key={sector.id}>{sector.label}</option>)}
      </select></label>
    </div>}
    {hierarchy && <EtfDetails hierarchy={hierarchy} level={level}/>}
    <div className="linked-chart-plot linked-chart-plot--etf" ref={surface.element}>
      <ChartRenderer data={drawable} uirevision={revision} scrollHeight={plotHeight} minPlotWidth={plotWidth}
        onDrawingSurfaceChange={surface.observe} retainedSurface={retained ? drawing : undefined} touchScroll="overflow" onSunburstLevelChange={navigate}/>
    </div>
  </>;
}
