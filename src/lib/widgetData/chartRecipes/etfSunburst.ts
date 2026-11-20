// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { pathAnnulus } from 'plotly.js/src/lib/angles.js';
import { themedLayout } from '../../chartShapes';
import { color, escape } from '../figureHelpers';
import type { DatasetColumn, WidgetDataset } from '../types';
import { readChartSource, readChartSourceProjection, type ChartBuildResult } from './chartSourceContracts';
import { read } from './estimateEvidence';
import { etfHierarchyAdapter, parseEtfHierarchySource, type EtfHierarchySource } from './etfHierarchyEvidence';
import { acquiredColumnOrigin } from './financialEvidence';
import { decodeRecipeOptions } from './settings';
import type { EtfSunburstOptions, RecipeContext, RecipeOptions, RecipeRefusal, RecipeResult } from './types';

type EtfNode<K extends string> = {
  id: string; kind: K; parentId: string; label: string; value: number; deliveredShare: number | null;
};
type Sector = EtfNode<'sector'> & { sector: string | null };
type Holding = EtfNode<'holding'> & { symbol: string; sector: string | null };
type Residual = EtfNode<'residual'> & { reference: string };
export type EtfHierarchy = {
  fund: string; snapshot: string; asOf: string | null; retrievedAt: string;
  scope: 'complete' | 'delivered'; coverage: EtfHierarchySource['coverage']; filtered: boolean;
  rawCount: number; acquiredCount: number; omittedCount: number; deliveredWeight: number;
  root: EtfNode<'fund'>; sectors: Sector[]; holdings: Holding[]; residual?: Residual;
};

const hazards: Record<keyof EtfHierarchySource['unsafe'], string> = {
  fund_conflict: 'conflicting fund identities', basis_conflict: 'conflicting weight bases',
  duplicate_conflict: 'conflicting holding identities', classification_conflict: 'conflicting sector classifications',
  negative_weight: 'negative weights', excess_weight: 'excess total weight',
};
const unavailableSector = 'Sector unavailable';
const refuse = (message: string): RecipeRefusal => ({ ok: false, refused: true, message });
const sourceIssue = 'Acquire the fund holdings with verified fractional weights on a common fund-assets basis.';
const bindingIssue = 'Present raw acquired holding, sector, fractional weight, fund and snapshot fields. Repair the chart bindings.';
const fraction = new Intl.NumberFormat('en-US', { style: 'percent', maximumSignificantDigits: 17 });
const scientificFraction = new Intl.NumberFormat('en-US', { style: 'percent', notation: 'scientific', maximumSignificantDigits: 17 });
const fundPercent = (value: number) => (value > 0 && value < 1e-6 ? scientificFraction : fraction).format(value);

function node<K extends string>(kind: K, key: string | null, parentId: string, label: string, value: number,
  deliveredTotal?: number): EtfNode<K> {
  return { id: JSON.stringify([kind, key]), kind, parentId, label, value,
    deliveredShare: deliveredTotal ? value / deliveredTotal : null };
}

function sum(values: readonly number[]): number {
  let total = 0;
  let correction = 0;
  for (const value of values) {
    const adjusted = value - correction;
    const next = total + adjusted;
    correction = (next - total) - adjusted;
    total = next;
  }
  return total;
}

function snapshotKey(value: string): string {
  if (value.length === 10) return value;
  const [second, fraction = ''] = value.replace(/(?:Z|\+00:00)$/, '').split('.');
  return `${second}.${fraction.padEnd(6, '0')}Z`;
}

function physicalColumn(columns: readonly DatasetColumn[], origin: string): DatasetColumn | undefined {
  const matches = columns.filter(column => acquiredColumnOrigin(column) === origin);
  if (matches.length === 1 && columns.filter(column => column.id === matches[0].id).length === 1) return matches[0];
}

function weightIssue(column: DatasetColumn): boolean {
  return (column.dtype !== undefined && column.dtype !== 'number') ||
    Object.entries(column.metadata ?? {}).some(([key, value]) => {
      switch (key.replaceAll('_', '').toLowerCase()) {
        case 'unit': case 'weightunit': return !['fraction', 'fractional', 'ratio'].some(unit => unit === value);
        case 'basis': case 'weightbasis': return value !== 'fund-assets' && value !== 'fund-assets-fraction';
        case 'etfkind': case 'exposurekind': return value !== 'holdings';
        default: return false;
      }
    });
}

function badWeightFormat(format: string | undefined): boolean {
  return format === 'percent' || format === 'dateToYear';
}

function snapshotLabel(hierarchy: EtfHierarchy): string {
  const vintage = `Acquired vintage ${hierarchy.snapshot}`;
  if (hierarchy.asOf === null) return vintage;
  return `As of ${hierarchy.asOf}${hierarchy.asOf === hierarchy.snapshot ? '' : ` · ${vintage}`}`;
}

export function buildEtfHierarchy(dataset: WidgetDataset, options: EtfSunburstOptions): ChartBuildResult<EtfHierarchy> {
  const { provenance, columns, rows, completeness } = dataset;
  const source = readChartSource(provenance, 'etf-hierarchy', parseEtfHierarchySource);
  const projection = readChartSourceProjection(provenance, 'etf-hierarchy');
  if (!source || !projection || (provenance.receipt !== undefined && !etfHierarchyAdapter.legacyReceiptAgrees?.(source, provenance.receipt)))
    return refuse(sourceIssue);
  const unsafe = Object.entries(hazards).filter(([flag]) => source.unsafe[flag]).map(([, label]) => label);
  if (unsafe.length) return refuse(`The ETF acquisition reports ${unsafe.join(', ')}. Repair the source.`);
  if (options.fund !== source.fund) return refuse(`Choose the acquired fund ${source.fund} or relink its holdings source.`);
  if (options.snapshot !== 'latest' && snapshotKey(options.snapshot) !== snapshotKey(source.snapshot))
    return refuse('The pinned ETF snapshot is unavailable. Choose the acquired snapshot or follow latest.');
  if (provenance.inputMayContainAggregates || rows.some(row => row.groupPath !== undefined) ||
    columns.some(column => column.aggregation || column.measureId || column.splitPath?.length || column.analytical?.scope === 'aggregate'))
    return refuse('Present raw acquired holdings before grouping, pivoting or aggregation.');

  const fund = physicalColumn(columns, 'fund_symbol');
  const snapshot = physicalColumn(columns, 'snapshot');
  const weight = physicalColumn(columns, 'weight');
  if (!fund || !snapshot || !weight || weight.id !== options.fields.weight ||
    physicalColumn(columns, 'symbol')?.id !== options.fields.holding ||
    physicalColumn(columns, 'sector')?.id !== options.fields.sector) return refuse(bindingIssue);
  if (weightIssue(weight) || badWeightFormat(weight.format?.formatterFn)) return refuse(sourceIssue);

  const declarations = [
    ['weight_basis', 'fund-assets', true], ['weight_unit', 'fraction', true],
    ['unit', 'fraction', false], ['basis', 'fund-assets', false], ['etf_kind', 'holdings', false],
    ['as_of', source.as_of, source.as_of !== null && source.snapshot !== source.as_of],
    ['holdings_coverage', source.coverage, false],
  ].flatMap(([origin, expected, required]) => columns.filter(column => acquiredColumnOrigin(column) === origin)
    .map(({ id }) => ({ id, expected, required })));
  const remaining = new Set(source.holding_keys);
  const omitted = new Set(projection.omitted);
  const groups = new Map<string | null, { symbol: string; weight: number }[]>();
  const weights: number[] = [];
  for (const row of rows) {
    const symbol = read(row, options.fields.holding);
    const sector = read(row, options.fields.sector);
    const value = read(row, weight.id);
    if (read(row, fund.id) !== source.fund || read(row, snapshot.id) !== source.snapshot ||
      typeof symbol !== 'string' || !remaining.delete(symbol) || omitted.has(symbol))
      return refuse('The presented holdings conflict with the acquired fund, snapshot or holding identities. Repair the source.');
    if (sector !== null && (typeof sector !== 'string' || !sector.trim() || sector.trim() !== sector))
      return refuse('Each holding needs a raw sector label or an explicit unavailable sector. Repair the source.');
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      return refuse('Each delivered holding needs a finite, nonnegative original fund weight. Repair the source.');
    if (badWeightFormat(row.cellFormats?.[weight.id]?.formatterFn) || declarations.some(({ id, expected, required }) => {
      if (Object.hasOwn(row.cellErrors ?? {}, id)) return true;
      const actual = read(row, id);
      // The table fills fields absent from individual acquired rows with null.
      return (required || actual != null) && actual !== expected;
    })) return refuse(sourceIssue);
    const group = groups.get(sector) ?? [];
    group.push({ symbol, weight: value });
    groups.set(sector, group);
    weights.push(value);
  }
  if (!weights.length) return refuse('No acquired holdings remain in this presentation. Restore holdings in the source table.');
  const bound = source.rounding_bound_fraction ?? 1e-12;
  const deliveredWeight = sum(weights);
  if (!Number.isFinite(deliveredWeight) || deliveredWeight > 1 + bound)
    return refuse('The acquired holdings weight total exceeds 100% of fund assets beyond the applicable rounding allowance. Repair the source.');
  if (!remaining.size && source.coverage === 'complete' && deliveredWeight < 1 - bound)
    return refuse('A complete fund requires 100% of fund assets within the applicable rounding allowance. Repair the source.');
  const hasAll = !remaining.size && (completeness.acquiredRowCount === undefined || completeness.acquiredRowCount === source.delivered_count);
  const scope = hasAll && !projection.filtered && source.coverage === 'complete' && completeness.kind === 'complete'
    ? 'complete' : 'delivered';
  const missingMass = hasAll && source.missing_mass.status === 'verified' ? source.missing_mass : undefined;
  const rootValue = missingMass ? deliveredWeight + missingMass.fraction : deliveredWeight;
  if (missingMass && (rootValue < 1 - bound || rootValue > 1 + bound))
    return refuse('The holdings and verified unallocated weight no longer reconcile to the acquired fund assets. Repair the source.');
  const rootLabel = scope === 'complete' ? 'Complete fund holdings' : missingMass ? 'Fund assets incl. unallocated' : 'Delivered holdings';
  const root = node('fund', source.fund, '', rootLabel, rootValue);
  const sectors: Sector[] = [];
  const holdings: Holding[] = [];
  for (const [sector, group] of groups) {
    const parent = { ...node('sector', sector, root.id, sector ?? unavailableSector,
      sum(group.map(holding => holding.weight)), deliveredWeight), sector };
    sectors.push(parent);
    for (const { symbol, weight } of group) {
      holdings.push({ ...node('holding', symbol, parent.id, symbol, weight, deliveredWeight), symbol, sector });
    }
  }
  const residual = missingMass && { ...node('residual', null, root.id, 'Unallocated/not delivered', missingMass.fraction),
    reference: missingMass.reference };
  const hierarchy: EtfHierarchy = {
    fund: source.fund, snapshot: source.snapshot, asOf: source.as_of, retrievedAt: source.retrieved_at,
    scope, coverage: source.coverage, filtered: projection.filtered, rawCount: source.raw_count, acquiredCount: source.delivered_count,
    omittedCount: remaining.size, deliveredWeight, root, sectors, holdings, ...(residual ? { residual } : {}),
  };
  const notes = [`${scope === 'complete' ? 'Complete fund holdings' : 'Delivered holdings'} · ${source.fund} · ${snapshotLabel(hierarchy)}.`,
    `Visible holdings: ${holdings.length} of ${source.delivered_count} acquired · ${fundPercent(deliveredWeight)} of fund assets · Original total fraction ${deliveredWeight}.`];
  if (remaining.size) notes[1] += ` ${remaining.size} acquired holdings omitted, excluded weight unavailable.`;
  if (projection.filtered) notes.push('The source presentation has an active filter or selection.');
  if (scope === 'delivered') notes.push(`Acquired coverage: ${source.coverage}.`);
  if (source.diagnostics.includes('exact_duplicate'))
    notes.push(`The acquisition collapsed ${source.raw_count - source.normalized_count} exact duplicate holdings rows.`);
  if (residual) notes.push(`Unallocated/not delivered: ${fundPercent(residual.value)} of fund assets · Source ${residual.reference}.`);
  if (source.rounding_bound_fraction !== null || deliveredWeight > 1 || (scope === 'complete' && deliveredWeight !== 1)
    || (residual && rootValue !== 1)) {
    const authority = source.rounding_reference ? ` · Source ${source.rounding_reference}` : ' · Arithmetic tolerance';
    notes.push(`Total rounding allowance: ${bound} fund-assets fraction${authority}. Displayed totals retain the acquired weights.`);
  }
  if (holdings.some(({ value }) => value === 0)) notes.push('Holdings with zero weight are listed in the details.');
  return { ok: true, value: hierarchy, notes };
}

const margin = { l: 12, r: 12, t: 64, b: 12, autoexpand: false };
const fullTurn = 2 * Math.PI;
type PlotNode = EtfHierarchy['root'] | Sector | Holding | Residual;

type GeometryFailure = { node: PlotNode; reason: 'viewport' | 'partition' | 'path' | 'unverified' };

/** Check Plotly's partition and native path fill at the overview and each available drill level. */
function geometryFailure(root: PlotNode, children: Map<string, PlotNode[]>, context: RecipeContext): GeometryFailure | undefined {
  const width = Math.round(context.viewportWidth ?? 360) - margin.l - margin.r;
  const height = Math.round(context.viewportHeight ?? 280) - margin.t - margin.b;
  const radius = Math.min(width, height) / 2;
  if (!Number.isFinite(radius) || radius <= 0) return { node: root, reason: 'viewport' };
  const cx = margin.l + width / 2;
  const cy = margin.t + height / 2;

  function rings(parent: PlotNode): number {
    return 1 + (children.get(parent.id) ?? []).reduce((height, child) => Math.max(height, rings(child)), 0);
  }

  type Point = readonly [number, number];
  const pathPoint = (r: number, a: number): Point =>
    [Math.fround(r * Math.cos(a) + cx), Math.fround(cy - r * Math.sin(a))];

  let hitTest: OffscreenCanvasRenderingContext2D | null | undefined;
  function wedgeFailure(inner: number, outer: number, from: number, to: number): 'path' | 'unverified' | undefined {
    const midpoint = (from + to) / 2;
    const tangentX = -Math.sin(midpoint), tangentY = -Math.cos(midpoint);
    // A native hit can include the boundary of a degenerate path. Both arcs
    // must also have distinct endpoints advancing in the intended direction.
    const forward = ([x0, y0]: Point, [x1, y1]: Point) =>
      (x1 - x0) * tangentX + (y1 - y0) * tangentY > 0;
    if (!forward(pathPoint(inner, from), pathPoint(inner, to))
        || !forward(pathPoint(outer, from), pathPoint(outer, to))) return 'path';

    // Use Plotly's own SVG path commands. The native engine parses its arcs
    // and tests the fill in CSS coordinates with the identity transform.
    try {
      if (typeof Path2D === 'undefined' || typeof OffscreenCanvas === 'undefined') return 'unverified';
      if (hitTest === undefined) hitTest = new OffscreenCanvas(1, 1).getContext('2d');
      if (!hitTest) return 'unverified';
      const path = new Path2D(pathAnnulus(inner, outer, from, to, cx, cy));
      const r = (inner + outer) / 2;
      if (!hitTest.isPointInPath(path, cx + r * Math.cos(midpoint), cy - r * Math.sin(midpoint))) return 'path';
    } catch {
      return 'unverified';
    }
  }

  function partition(parent: PlotNode, from: number, to: number, ring: number, ringCount: number, full: boolean): GeometryFailure | undefined {
    const siblings = children.get(parent.id);
    if (!siblings?.length) return;
    const scale = (to - from) / parent.value;
    if (!Number.isFinite(scale)) return { node: parent, reason: 'partition' };
    const inner = ring / ringCount * radius;
    const outer = (ring + 1) / ringCount * radius;
    for (const child of siblings) {
      const end = from + child.value * scale;
      const angle = end - from;
      if (!Number.isFinite(angle) || angle <= 0) return { node: child, reason: 'partition' };
      const childIsFull = full && siblings.length === 1;
      // Plotly's pathAnnulus treats spans within 1e-14 radians of a turn as full circles.
      const plotlyFull = angle > fullTurn - 1e-14;
      const failure = plotlyFull !== childIsFull ? 'partition'
        : plotlyFull ? undefined : wedgeFailure(inner, outer, from, end);
      if (failure) {
        // A near-full branch with a collapsed gap is a failure to show its
        // narrow peers. Report the smallest weight in that partition.
        const node = failure !== 'unverified' && angle > Math.PI && !childIsFull
          ? siblings.reduce((smallest, sibling) => sibling.value < smallest.value ? sibling : smallest)
          : child;
        return { node, reason: failure };
      }
      const failed = partition(child, from, end, ring + 1, ringCount, childIsFull);
      if (failed) return failed;
      from = end;
    }
  }

  const views = [root, ...(children.get(root.id) ?? []).filter(child => children.has(child.id))];
  for (const view of views) {
    const failed = partition(view, 0, fullTurn, 1, rings(view), true);
    if (failed) return failed;
  }
}

function hover(node: PlotNode, hierarchy: EtfHierarchy, shareFormat: Intl.NumberFormat): string {
  const share = [];
  if (node.deliveredShare !== null) {
    const rounded = shareFormat.format(node.deliveredShare);
    const text = (rounded === '0%' && node.deliveredShare > 0) || (rounded === '100%' && node.deliveredShare < 1)
      ? fundPercent(node.deliveredShare) : rounded;
    share.push(`Share of delivered holdings: ${text}`);
  }
  return [node.label, `Fund: ${hierarchy.fund}`, snapshotLabel(hierarchy),
    `Original fund weight: ${node.value} (${fundPercent(node.value)} of fund assets)`, ...share,
    ...(node.kind === 'residual' ? [`Source: ${node.reference}`] : []),
    ...(node.kind === 'fund' && hierarchy.residual ? [`Visible holdings: ${fundPercent(hierarchy.deliveredWeight)} of fund assets`] : []),
  ].map(escape).join('<br>');
}

export function buildEtfSunburst(dataset: WidgetDataset, options: RecipeOptions, context: RecipeContext): RecipeResult {
  const decoded = decodeRecipeOptions(options, 'etf-sunburst');
  if (!decoded.ok || options.kind !== 'etf-sunburst') return refuse(decoded.ok ? 'Choose the ETF sunburst recipe.' : decoded.message);
  const built = buildEtfHierarchy(dataset, options);
  if (!built.ok) return built;
  const { value, notes } = built;
  const { root, sectors, holdings, residual } = value;
  const revision = JSON.stringify([dataset.provenance.sourceWidgetId, options.kind, options.version, options.fund, options.depth,
    options.snapshot === 'latest' ? 'latest' : snapshotKey(options.snapshot), snapshotKey(value.snapshot), value.asOf,
    options.fields.holding, options.fields.sector, options.fields.weight]);

  const children = new Map<string, PlotNode[]>();
  for (const item of [...sectors, ...(options.depth === 2 ? holdings : []), ...(residual ? [residual] : [])]) {
    if (item.value === 0) continue;
    const siblings = children.get(item.parentId) ?? [];
    siblings.push(item);
    children.set(item.parentId, siblings);
  }
  const failed = root.value > 0 && geometryFailure(root, children, context);
  if (failed) {
    const canDrawSectors = options.depth === 2
      && !geometryFailure(root, new Map([[root.id, children.get(root.id) ?? []]]), context);
    const repair = canDrawSectors ? 'Select sector depth to show sectors with exact holding weights in the details.'
      : (failed.reason === 'partition' || failed.reason === 'unverified') ? 'Use the exact weights in the source table.'
        : 'Try a larger drawing area or use the exact weights in the source table.';
    const problem = failed.reason === 'unverified' ? 'This browser cannot verify' : 'Plotly cannot draw';
    return refuse(`${problem} the required sunburst geometry for ${failed.node.label.slice(0, 100)} at this size. `
      + `Original fund weight ${failed.node.value}. ${repair}`);
  }
  const flatten = (item: PlotNode): PlotNode[] => [item, ...(children.get(item.id) ?? []).flatMap(flatten)];
  const plotNodes = root.value ? flatten(root) : [];
  const dark = context.theme === 'dark';
  const shareFormat = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: context.maxDecimals });
  const neutral = dark ? '#6b778a' : '#c2cbd8';
  const colors = new Map<string, string>([[root.id, neutral]]);
  for (const siblings of children.values()) {
    let previous: string | undefined;
    for (const item of siblings) {
      const desired = item.kind === 'residual' ? neutral : color(item.id);
      const fill = desired === previous ? (dark ? '#a6b7d0' : '#788da9') : desired;
      colors.set(item.id, fill);
      previous = fill;
    }
  }
  const data = plotNodes.length ? [{
    type: 'sunburst', uid: 'etf-sunburst', branchvalues: 'total', sort: false, rotation: 0,
    ids: plotNodes.map(({ id }) => id), parents: plotNodes.map(({ parentId }) => parentId),
    labels: plotNodes.map(({ label }) => escape(label)), values: plotNodes.map(({ value }) => value),
    textinfo: 'label', text: plotNodes.map(node => hover(node, value, shareFormat)), hovertemplate: '%{text}<extra></extra>',
    leaf: { opacity: 1 }, marker: { line: { width: 0 }, colors: plotNodes.map(node => colors.get(node.id)) },
  }] : [];
  const heading = value.scope === 'complete' ? 'Complete fund holdings' : 'Delivered holdings';
  const title = [`${value.fund} · ${heading}`, `${fundPercent(value.deliveredWeight)} of fund assets`].map(escape).join('<br>');
  return { ok: true, notes, revision, etfHierarchy: value, figure: { data, layout: {
    ...themedLayout(context.theme), margin,
    title: { text: title, font: { size: 15 } },
    uirevision: revision, showlegend: false, hovermode: 'closest',
    ...(data.length ? {} : {
      xaxis: { visible: false }, yaxis: { visible: false },
      annotations: [{ text: 'All visible holdings have zero weight.', xref: 'paper', yref: 'paper', x: .5, y: .5, showarrow: false }],
    }),
  } } };
}
