// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import partition, { type TreemapRectangle } from 'plotly.js/src/traces/treemap/partition.js';
import { themedLayout } from '../../chartShapes';
import { escape } from '../figureHelpers';
import type { DatasetColumn, WidgetDataset } from '../types';
import { readChartSource, readChartSourceProjection, type ChartBuildResult } from './chartSourceContracts';
import { read } from './estimateEvidence';
import { acquiredColumnOrigin } from './financialEvidence';
import { sumMarketMapAreas } from './marketMapAreaSum';
import { marketMapAdapter, marketMapIdentityFields, parseMarketMapSource, type MarketMapSource } from './marketMapEvidence';
import { decodeMarketMapOptions, marketMapFieldOrigins } from './settings';
import type { MarketMapOptions, RecipeContext, RecipeRefusal, RecipeRequestOptions, RecipeResult } from './types';
import { marketMapMinPlotHeight, marketMapMinPlotWidth } from './viewport';

type MarketNode<K extends string> = { kind: K; id: string; parentId: string; label: string; value: number };
type MarketRoot = MarketNode<'market-root'>;
type MarketSector = MarketNode<'market-sector'> & { sector: string | null };
type MarketListing = MarketNode<'market-listing'> & { listing: string; sector: string | null; change: number | null };
type PlotNode = MarketRoot | MarketSector | MarketListing;
type AreaExclusions = MarketMapSource['excluded_areas'];
export type MarketMapHierarchy = {
  mode: MarketMapSource['mode']; universe: string; scope: 'complete' | 'delivered'; coverage: MarketMapSource['coverage'];
  acquisitionRef: string; retrievedAt: string; session: string; priorSession: string; priceBasis: MarketMapSource['price_basis'];
  denomination: string | null; capRetrievedAt: string | null; membershipAsOf: string | null;
  roundingBound: number | null; roundingDiscrepancy: number | null; filtered: boolean;
  rawCount: number; acquiredCount: number; omittedCount: number; exactRepeats: number;
  sourceExcludedAreas: AreaExclusions; presentationExcludedAreas: AreaExclusions; colorBound: number | null;
  root: MarketRoot; sectors: MarketSector[]; listings: MarketListing[];
};

const hazards: Record<keyof MarketMapSource['unsafe'], string> = {
  identity_conflict: 'conflicting qualified listings', session_conflict: 'conflicting price sessions or return bases',
  denomination_conflict: 'conflicting capitalization denominations', membership_conflict: 'conflicting index membership or coverage',
  duplicate_conflict: 'conflicting duplicate listings', excess_weight: 'excess index weight',
};

const sourceIssue = 'Relink a verified local market-map acquisition with a completed close-to-close price session and acquired capitalization or index weights.';
const bindingIssue = 'Choose five unique physical market-map fields and retain the acquired universe column.';
const refuse = (message: string): RecipeRefusal => ({ ok: false, refused: true, message });
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const countExclusions = ({ zero, negative, invalid }: AreaExclusions) => zero + negative + invalid;
const compareKeys = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function node<K extends PlotNode['kind']>(kind: K, key: string | null, parentId: string, label: string, value: number): MarketNode<K> {
  return { kind, id: JSON.stringify([kind, key]), parentId, label, value };
}

function name(scope: MarketMapHierarchy['scope'], mode: MarketMapHierarchy['mode']): string {
  if (mode === 'delivered-cap') return 'Delivered-sample market cap';
  return scope === 'complete' ? 'Complete index weights' : 'Delivered index components';
}

function physicalColumns(columns: readonly DatasetColumn[]) {
  const byOrigin = new Map<string, DatasetColumn[]>();
  const idCounts = new Map<string, number>();
  for (const column of columns) {
    idCounts.set(column.id, (idCounts.get(column.id) ?? 0) + 1);
    const origin = column.sourceFieldId ?? column.id;
    const matches = byOrigin.get(origin) ?? [];
    matches.push(column);
    byOrigin.set(origin, matches);
  }
  return {
    has: (origin: string) => byOrigin.has(origin),
    resolve: (origin: string) => {
      const matches = byOrigin.get(origin);
      const column = matches?.[0];
      if (matches?.length === 1 && column && idCounts.get(column.id) === 1 && acquiredColumnOrigin(column) === origin) return column.id;
    },
  };
}

export function buildMarketHierarchy(dataset: WidgetDataset, options: MarketMapOptions): ChartBuildResult<MarketMapHierarchy> {
  const { provenance, rows, columns, completeness } = dataset;
  const source = readChartSource(provenance, 'market-map', parseMarketMapSource);
  const projection = readChartSourceProjection(provenance, 'market-map');
  if (!source || !projection || (provenance.receipt !== undefined && !marketMapAdapter.legacyReceiptAgrees?.(source, provenance.receipt)))
    return refuse(sourceIssue);
  const unsafe = source.diagnostics.map(flag => hazards[flag]);
  if (unsafe.length) return refuse(`The market-map acquisition reports ${unsafe.join(', ')}. Repair the source.`);
  if (options.mode !== source.mode || options.universe !== source.universe)
    return refuse('Choose the market-map mode and universe certified by the acquired source.');
  if (options.session !== 'latest' && options.session !== source.session)
    return refuse('The pinned market-map session is unavailable. Choose the acquired session or follow latest.');
  if (provenance.inputMayContainAggregates || rows.some(row => row.groupPath !== undefined) ||
    columns.some(column => column.aggregation || column.measureId || column.splitPath?.length || column.analytical?.scope === 'aggregate'))
    return refuse('Present acquired listing rows before grouping, pivoting or aggregation.');

  const physical = physicalColumns(columns);
  if (marketMapFieldOrigins.some(origin => physical.resolve(origin) !== options.fields[origin]) || !physical.resolve('universe'))
    return refuse(bindingIssue);
  const companions = [];
  for (const origin of marketMapIdentityFields) {
    if (!physical.has(origin)) continue;
    const id = physical.resolve(origin);
    if (!id) return refuse('Present unambiguous physical market-map source columns.');
    companions.push({ id, origin, expected: source[origin] });
  }

  const omitted = new Set(projection.omitted);
  const remaining = new Set(source.listing_keys);
  const presentationExcludedAreas = { zero: 0, negative: 0, invalid: 0 };
  const groups = new Map<string | null, MarketListing[]>();
  const areas: number[] = [];
  let greatestChange = 0;
  let validChanges = 0;

  const root = node('market-root', source.universe, '', '', 0);
  for (const row of rows) {
    const listing = read(row, options.fields.listing);
    if (typeof listing !== 'string' || !remaining.delete(listing) || omitted.has(listing))
      return refuse('A presented listing is duplicated, unacquired or previously omitted. Restore the physical qualified listings.');
    const conflict = companions.find(({ id, expected }) => read(row, id) !== expected);
    if (conflict) return refuse(`The presented ${conflict.origin.replaceAll('_', ' ')} conflicts with the market-map acquisition. Repair the source.`);

    const sector = read(row, options.fields.sector);
    if (sector !== null && (typeof sector !== 'string' || !sector || sector.trim() !== sector))
      return refuse('Each listing needs its physical sector or an explicit unavailable sector.');
    const change = read(row, options.fields.change);
    if (change !== null && (!finite(change) || change < -1))
      return refuse('Each listing needs its original completed close-to-close fraction or an explicit unavailable return.');

    const area = read(row, options.fields.area);
    if (!finite(area) || area <= 0) {
      const reason = !finite(area) ? 'invalid' : area === 0 ? 'zero' : 'negative';
      presentationExcludedAreas[reason]++;
      continue;
    }
    const sectorId = JSON.stringify(['market-sector', sector]);
    const group = groups.get(sector) ?? [];
    group.push({ ...node('market-listing', listing, sectorId, listing, area), listing, sector, change });
    groups.set(sector, group);
    areas.push(area);
    if (change !== null) {
      validChanges++;
      greatestChange = Math.max(greatestChange, Math.abs(change));
    }
  }

  if (!areas.length) return refuse('No acquired listings with positive areas remain. Restore listings with valid areas in the source table.');
  root.value = sumMarketMapAreas(areas);
  if (!Number.isFinite(root.value)) return refuse('The sum of the visible listing areas is too large to represent. Use the original listing values in the source table.');
  const roundingBound = source.mode === 'index-weight' ? source.rounding_bound_fraction ?? 1e-12 : null;
  const allAreasPresent = !remaining.size && !countExclusions(presentationExcludedAreas);
  if (roundingBound !== null && root.value > 1 + roundingBound)
    return refuse('The visible index weight exceeds 100% beyond the applicable rounding bound. Repair the source.');
  if (roundingBound !== null && source.coverage === 'complete' && allAreasPresent && root.value < 1 - roundingBound)
    return refuse('The acquired complete index weight falls short of 100% beyond the applicable rounding bound. Repair the source.');

  const scope = source.coverage === 'complete' && allAreasPresent && !projection.filtered && completeness.kind === 'complete'
    && (completeness.acquiredRowCount === undefined || completeness.acquiredRowCount === source.delivered_count) ? 'complete' : 'delivered';
  root.label = name(scope, source.mode);
  const sectors: MarketSector[] = [];
  const listings: MarketListing[] = [];
  const orderedGroups = [...groups].sort(([a], [b]) => a === b ? 0 : a === null ? 1 : b === null ? -1 : compareKeys(a, b));
  for (const [sector, group] of orderedGroups) {
    const subtotal = sumMarketMapAreas(group.map(listing => listing.value));
    sectors.push({ ...node('market-sector', sector, root.id, sector ?? 'Sector unavailable', subtotal), sector });
    for (const listing of group.sort((a, b) => compareKeys(a.listing, b.listing))) listings.push(listing);
  }

  const reconcileToOne = (source.coverage === 'complete' && allAreasPresent) || root.value > 1;
  const value: MarketMapHierarchy = {
    mode: source.mode, universe: source.universe, scope, coverage: source.coverage, acquisitionRef: source.acquisition_ref,
    retrievedAt: source.retrieved_at, session: source.session, priorSession: source.prior_session, priceBasis: source.price_basis,
    denomination: source.denomination, capRetrievedAt: source.cap_retrieved_at, membershipAsOf: source.membership_as_of,
    roundingBound, roundingDiscrepancy: roundingBound !== null && reconcileToOne ? root.value - 1 : null,
    filtered: projection.filtered, rawCount: source.raw_count, acquiredCount: source.delivered_count, omittedCount: remaining.size,
    exactRepeats: source.exact_repeats, sourceExcludedAreas: source.excluded_areas, presentationExcludedAreas,
    colorBound: validChanges ? greatestChange || .01 : null, root, sectors, listings,
  };
  return { ok: true, value, notes: marketNotes(value) };
}

const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumSignificantDigits: 17 });
const scientificPercent = new Intl.NumberFormat('en-US', { style: 'percent', notation: 'scientific', maximumSignificantDigits: 17 });
const asPercent = (value: number) => (value && (Math.abs(value) < .00001 || Math.abs(value) >= 1e6)
  ? scientificPercent : percent).format(value);
const compactPercent = new Intl.NumberFormat('en-US', { style: 'percent', notation: 'scientific', maximumSignificantDigits: 5 });
const tickPercent = (value: number) => {
  const exact = asPercent(value);
  return exact.length > 14 ? compactPercent.format(value) : exact;
};
const areaLabel = (value: number, denomination: string | null) => denomination
  ? `${value} ${denomination}` : `${asPercent(value)} · fraction ${value}`;
const sessionLabel = (map: MarketMapHierarchy) => `Completed close-to-close return ${map.priorSession} to ${map.session}`;
const vintageLabel = (map: MarketMapHierarchy) => map.capRetrievedAt
  ? `Capitalization retrieved ${map.capRetrievedAt}`
  : `Membership and weights as of ${map.membershipAsOf}`;
const exclusionsLabel = ({ zero, negative, invalid }: AreaExclusions) => `${zero} zero, ${negative} negative, ${invalid} invalid`;

function marketNotes(map: MarketMapHierarchy): string[] {
  const coverage = map.mode === 'index-weight' ? ` · ${map.universe} · acquired coverage ${map.coverage}` : '';
  const notes = [
    `${map.root.label}${coverage} · ${areaLabel(map.root.value, map.denomination)}.`,
    `${vintageLabel(map)}. ${sessionLabel(map)} · ${map.priceBasis === 'split-adjusted-price' ? 'split-adjusted prices' : 'as-traded prices'}.`,
    `${map.listings.length} visible listings of ${map.acquiredCount} acquired · ${map.rawCount} raw records · ${map.omittedCount} omitted.`,
    `Source area exclusions: ${exclusionsLabel(map.sourceExcludedAreas)} · ${map.exactRepeats} exact repeats.`,
    `Presentation area exclusions: ${exclusionsLabel(map.presentationExcludedAreas)}.`,
    map.colorBound === null ? 'All listing returns are unavailable.'
      : `Return color is symmetric across the visible sample from ${asPercent(-map.colorBound)} to ${asPercent(map.colorBound)}. Gray-blue indicates an unavailable return.`,
    'The root and sector headers identify the hierarchy.',
  ];
  if (map.filtered) notes.push('An active source selection or filter limits this presentation.');
  if (map.roundingDiscrepancy !== null && map.roundingBound !== null)
    notes.push(`Original weight discrepancy from 100%: ${map.roundingDiscrepancy} fraction · applicable bound ${map.roundingBound}.`);
  return notes;
}

const margin = { l: 12, r: 12, t: 78, b: 72, pad: 0, autoexpand: false };
const packing = 'slice-dice';
const header = 17;
const markerPad = { t: header, l: 0, r: 0, b: 0 };

class Tile implements TreemapRectangle {
  x0 = 0;
  x1 = 0;
  y0 = 0;
  y1 = 0;

  constructor(readonly item: PlotNode, readonly depth: number, readonly children?: Tile[]) {}

  get value() { return this.item.value; }

  eachBefore(visit: (node: Tile) => void) {
    visit(this);
    for (const child of this.children ?? []) child.eachBefore(visit);
  }
}

/** Run Plotly's installed partition with the same raw values, padding and views as its draw path. */
function geometryFailure(root: MarketRoot, branches: { sector: MarketSector; listings: MarketListing[] }[],
  width: number, height: number): PlotNode | undefined {
  const size: [number, number] = [width - margin.l - margin.r, height - margin.t - margin.b];
  const tile = ({ sector, listings }: typeof branches[number], depth: number) =>
    new Tile(sector, depth, listings.map(listing => new Tile(listing, depth + 1)));
  const rootView = new Tile(root, 0, branches.map(branch => tile(branch, 1)));
  for (const view of [rootView, ...branches.map(branch => tile(branch, 0))]) {
    partition(view, size, { packing, pad: { inner: 0, top: header, left: 0, right: 0, bottom: 0 } });
    let failure: PlotNode | undefined;
    view.eachBefore(rect => {
      // SVG coordinates land in the browser's single-precision path geometry after Plotly adds the plot origin.
      const left = Math.fround(rect.x0 + margin.l), right = Math.fround(rect.x1 + margin.l);
      const top = Math.fround(rect.y0 + margin.t), bottom = Math.fround(rect.y1 + margin.t);
      if (!failure && (![left, right, top, bottom].every(Number.isFinite) || !(right > left && bottom > top)))
        failure = rect.children?.[0]?.item ?? rect.item;
    });
    if (failure) return failure;
  }
}

const shortLabel = (label: string, limit = 24) => label.length > limit ? `${label.slice(0, limit - 1)}…` : label;

const nodeLabel = (item: PlotNode) => item.kind === 'market-root' ? item.label : shortLabel(item.label);

function hover(item: PlotNode, map: MarketMapHierarchy): string {
  const text = [nodeLabel(item), areaLabel(item.value, map.denomination)];
  if (item.kind === 'market-listing') {
    text.push(shortLabel(item.sector ?? 'Sector unavailable'));
    if (item.change === null) text.push('Return unavailable');
    else {
      const percent = asPercent(item.change);
      const fraction = `fraction ${item.change}`;
      const together = `${percent} · ${fraction}`;
      if (together.length <= 36) text.push(together);
      else text.push(percent, fraction);
    }
  }
  text.push(`Completed session ${map.session}`, vintageLabel(map));
  return text.map(escape).join('<br>');
}

export function buildMarketMap(dataset: WidgetDataset, options: RecipeRequestOptions, context: RecipeContext): RecipeResult {
  const decoded = decodeMarketMapOptions(options);
  if (!decoded.ok) return refuse(decoded.message);
  const selected = decoded.options;
  const built = buildMarketHierarchy(dataset, selected);
  if (!built.ok) return built;
  const { value: map, notes } = built;
  const width = context.viewportWidth ?? marketMapMinPlotWidth;
  const height = context.viewportHeight ?? marketMapMinPlotHeight;
  if (width < marketMapMinPlotWidth || height < marketMapMinPlotHeight)
    return refuse(`Give the market map a drawing area of at least ${marketMapMinPlotWidth} × ${marketMapMinPlotHeight} CSS pixels.`);

  const listingGroups = new Map<string, MarketListing[]>();
  for (const listing of map.listings) {
    const group = listingGroups.get(listing.parentId) ?? [];
    group.push(listing);
    listingGroups.set(listing.parentId, group);
  }
  const branches = map.sectors.map(sector => ({ sector, listings: listingGroups.get(sector.id) ?? [] }));
  // Plotly checks branch values with left-to-right addition before its
  // partition runs. Exact, representable totals can still overflow that sum.
  const plotlySumOverflows = (items: PlotNode[]) => !Number.isFinite(items.reduce((sum, item) => sum + item.value, 0));
  if (plotlySumOverflows(map.sectors) || branches.some(branch => plotlySumOverflows(branch.listings)))
    return refuse('Plotly cannot calculate the required market-map branch area sum. Use the original listing values in the source table.');
  const failed = geometryFailure(map.root, branches, width, height);
  if (failed)
    return refuse(`Plotly cannot draw the required market-map geometry for ${shortLabel(failed.label)} at this size. `
      + `Original area ${areaLabel(failed.value, map.denomination)}. Try a larger drawing area or inspect the original listing values in the source table.`);

  const revision = JSON.stringify([dataset.provenance.sourceWidgetId, selected.kind, selected.version, map.mode, map.universe,
    selected.session, map.session, map.priorSession, map.priceBasis, map.membershipAsOf, map.denomination, map.acquisitionRef,
    marketMapFieldOrigins.map(field => selected.fields[field]), map.scope,
    map.listings.map(({ id, parentId }) => [id, parentId])]);
  const items = [map.root, ...map.sectors, ...map.listings];
  const dark = context.theme === 'dark';
  const structure = dark ? '#48465d' : '#d8d0e4';
  const unavailable = dark ? '#54728d' : '#8aa4bb';
  const zero = dark ? '#b8ada0' : '#f0e6d9';
  const colorBound = map.colorBound;
  const hasScale = colorBound !== null;
  const missingReturn = map.listings.some(listing => listing.change === null);
  const subtitle = map.mode === 'delivered-cap' ? `${map.denomination} · Completed session ${map.session}` : shortLabel(map.universe, 20);
  return { ok: true, notes, revision, marketMap: map, figure: {
    data: [{
      type: 'treemap', uid: 'market-map', level: '', branchvalues: 'total', sort: false,
      ids: items.map(item => item.id), parents: items.map(item => item.parentId),
      labels: items.map(item => escape(nodeLabel(item))), values: items.map(item => item.value),
      hovertext: items.map(item => hover(item, map)), hoverinfo: 'text',
      textinfo: 'label', textposition: 'top left',
      textfont: { size: 11 }, hoverlabel: { font: { size: 11 }, align: 'left' },
      tiling: { packing, pad: 0 }, pathbar: { thickness: 20 }, root: { color: structure },
      marker: {
        pad: markerPad, cornerradius: 0, depthfade: false, line: { width: 0 },
        colors: items.map(item => item.kind !== 'market-listing' ? structure
          : item.change === null || colorBound === null ? unavailable : item.change / colorBound),
        showscale: hasScale,
        // A normalized color coordinate avoids overflow in Plotly's cmax - cmin.
        // The legend and details stay in the original return units; areas are never scaled.
        ...(hasScale ? {
          cauto: false, cmin: -1, cmax: 1, autocolorscale: false,
          colorscale: [[0, '#a52343'], [.5, zero], [1, '#00765f']],
          colorbar: {
            orientation: 'h', x: .5, xanchor: 'center', xref: 'container', y: 9 / height, yanchor: 'bottom', yref: 'container',
            len: .62, thickness: 9, outlinewidth: 0, xpad: 0, ypad: 0,
            tickmode: 'array', tickvals: [-1, 0, 1], ticktext: [tickPercent(-colorBound), '0%', tickPercent(colorBound)], tickfont: { size: 10 },
          },
        } : {}),
      },
    }],
    layout: {
      ...themedLayout(context.theme), margin, hovermode: 'closest', uirevision: revision,
      showlegend: false, title: { text: [map.root.label, subtitle].map(escape).join('<br>'), x: .5, xanchor: 'center', y: 1 - 20 / height, yref: 'container', yanchor: 'top', font: { size: 14 } },
      uniformtext: { mode: 'hide', minsize: 10 },
      annotations: [{
        text: hasScale ? `Completed-session return${missingReturn ? ' · Gray-blue: unavailable' : ''}` : 'Gray-blue · Returns unavailable',
        xref: 'paper', x: .5, yref: 'paper', y: 0, yshift: -16,
        showarrow: false, font: { size: 11 },
      }],
    },
  } };
}
