// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

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
    ['weight_basis', 'fund-assets'], ['weight_unit', 'fraction'], ['unit', 'fraction'],
    ['basis', 'fund-assets'], ['etf_kind', 'holdings'], ['as_of', source.as_of], ['holdings_coverage', source.coverage],
  ].flatMap(([origin, value]) => columns.filter(column => acquiredColumnOrigin(column) === origin).map(({ id }) => ({ id, value })));
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
    if (badWeightFormat(row.cellFormats?.[weight.id]?.formatterFn) || declarations.some(({ id, value }) => read(row, id) !== value))
      return refuse(sourceIssue);
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

/** Check the actual partition operations and the SVG endpoint resolution at each available drill level. */
function geometryFailure(root: PlotNode, children: Map<string, PlotNode[]>, context: RecipeContext): PlotNode | undefined {
  const width = (context.viewportWidth ?? 360) - margin.l - margin.r;
  const height = (context.viewportHeight ?? 280) - margin.t - margin.b;
  // Reserve one pixel for Plotly's independent rounding of layout dimensions and margins.
  const radius = (Math.min(width, height) - 1) / 2;
  // Browser path coordinates use single precision. An endpoint displacement above
  // two coordinate steps is distinguishable even at the far edge of the plot.
  const step = Math.max(width + margin.l + margin.r, height + margin.t + margin.b) * 2 ** -22;
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(step)) return root;

  function rings(parent: PlotNode): number {
    return 1 + (children.get(parent.id) ?? []).reduce((height, child) => Math.max(height, rings(child)), 0);
  }

  function partition(parent: PlotNode, from: number, to: number, ring: number, ringWidth: number, full: boolean): PlotNode | undefined {
    const siblings = children.get(parent.id);
    if (!siblings?.length) return;
    const scale = (to - from) / parent.value;
    if (!Number.isFinite(scale)) return parent;
    for (const child of siblings) {
      const end = from + child.value * scale;
      const angle = end - from;
      const childIsFull = full && siblings.length === 1;
      // Plotly's pathAnnulus treats spans within 1e-14 radians of a turn as full circles.
      const plotlyFull = angle > fullTurn - 1e-14;
      if (plotlyFull && !childIsFull)
        return siblings.reduce((smallest, sibling) => sibling.value < smallest.value ? sibling : smallest);
      if (!Number.isFinite(angle) || angle <= 0 || plotlyFull !== childIsFull ||
        (!plotlyFull && 2 * ring * ringWidth * Math.sin(Math.min(angle, fullTurn - angle) / 2) <= step))
        return child;
      const failed = partition(child, from, end, ring + 1, ringWidth, childIsFull);
      if (failed) return failed;
      from = end;
    }
  }

  const views = [root, ...(children.get(root.id) ?? []).filter(child => children.has(child.id))];
  for (const view of views) {
    const failed = partition(view, 0, fullTurn, 1, radius / rings(view), true);
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
  if (failed) return refuse(`Plotly cannot draw the required sunburst geometry for ${failed.label.slice(0, 100)} at this size. `
    + `Original fund weight ${failed.value}. Enlarge the chart or select sector depth.`);
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
