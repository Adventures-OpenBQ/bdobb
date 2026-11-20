// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout, type PlotlyFigure } from '../../chartShapes';
import { color, escape } from '../figureHelpers';
import type { DatasetRow, WidgetDataset } from '../types';
import { doubleUnitExponent, roundedRatio, scaledInteger } from './binary64';
import { bubblePriceDates, savedBindingIssue } from './bindings';
import { read, text } from './estimateEvidence';
import { isoDate, qualifiedSymbol, readFinancialEvidence, type ScreenerFinancialEvidence } from './financialEvidence';
import { decodeRecipeOptions } from './settings';
import type { BubbleBindings, RecipeContext, RecipeOptions, RecipeRefusal, RecipeResult } from './types';

type Point = { x: number; y: number };
type Fit = { slope: number; intercept: number; rSquared: number; n: number };
type Withheld = { reason: string };
type Bounds = { min: number; max: number };
type Cohort = ScreenerFinancialEvidence['cohorts'][number];
type PresentedListing = { row: DatasetRow; symbol: string; date: string; exchange: string };
type Bubble = Point & { marketCap: number; listing: PresentedListing };

const numericFailure = { reason: 'The fitted coefficients or endpoints exceed finite numeric precision.' };
// Plotly cartesian autorange and range conversion use this floating-point limit.
const plotLimit = Number.MAX_VALUE * 1e-4;
const maxDiameter = 48;
const maxSquaredRadius = (maxDiameter / 2) ** 2;

const refuse = (message: string): RecipeRefusal => ({ ok: false, refused: true, message });
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function pointBounds(points: readonly Point[]): { x: Bounds; y: Bounds } {
  const x = { min: Infinity, max: -Infinity }, y = { min: Infinity, max: -Infinity };
  for (const point of points) {
    x.min = Math.min(x.min, point.x);
    x.max = Math.max(x.max, point.x);
    y.min = Math.min(y.min, point.y);
    y.max = Math.max(y.max, point.y);
  }
  return { x, y };
}

function fitLine(points: readonly Point[]): { fit: Fit; line: { x: number[]; y: number[] } } | Withheld {
  const n = points.length;
  if (n < 3) return { reason: 'At least 3 usable listings are required.' };
  const bounds = pointBounds(points);
  if (!Object.values(bounds).every(({ min, max }) => finite(min) && finite(max)))
    return { reason: 'The fit requires finite dividend yield and five-day price change values.' };
  if (bounds.x.min === bounds.x.max) return { reason: 'Dividend yield is constant across usable listings.' };
  if (bounds.y.min === bounds.y.max) return { reason: 'Five-day price change is constant across usable listings.' };

  // The linear pass uses a fixed binary scale and exact moments. Forming centered
  // sums afterward keeps tiny differences intact even beside large common levels.
  // Finite doubles and array lengths bound the integer widths.
  const view = new DataView(new ArrayBuffer(8));
  let sumX = 0n, sumY = 0n, sumXX = 0n, sumYY = 0n, sumXY = 0n;
  for (const point of points) {
    const x = scaledInteger(point.x, view), y = scaledInteger(point.y, view);
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumYY += y * y;
    sumXY += x * y;
  }
  const count = BigInt(n);
  const xx = count * sumXX - sumX * sumX;
  const yy = count * sumYY - sumY * sumY;
  const xy = count * sumXY - sumX * sumY;
  const slope = roundedRatio(xy, xx);
  const rSquared = roundedRatio(xy * xy, xx * yy);
  const predict = (x: number) =>
    roundedRatio(sumY * xx + (count * scaledInteger(x, view) - sumX) * xy, count * xx, doubleUnitExponent);
  const intercept = predict(0);
  const x = [bounds.x.min, bounds.x.max];
  const y = x.map(predict);
  if (![slope, intercept, rSquared, ...y].every(finite) || (xy !== 0n && (slope === 0 || rSquared === 0)))
    return numericFailure;
  return { fit: { slope, intercept, rSquared, n }, line: { x, y } };
}

export function fitUnweightedOls(points: readonly Point[]): Fit | Withheld {
  const result = fitLine(points);
  return 'reason' in result ? result : result.fit;
}

function validatePresentation(
  dataset: WidgetDataset, fields: BubbleBindings, cohorts: ReadonlyMap<string, Cohort>,
): PresentedListing[] | RecipeRefusal {
  const counts = new Map<string, number>();
  const listings: PresentedListing[] = [];
  for (const row of dataset.rows) {
    const symbol = read(row, fields.symbol), exchange = read(row, fields.exchange), date = read(row, fields.date);
    if (!qualifiedSymbol(symbol) || typeof exchange !== 'string' || !exchange
      || !symbol.endsWith('.' + exchange.toUpperCase()))
      return refuse('Present each screener listing with its acquired qualified identity and exchange.');
    if (!isoDate(date))
      return refuse('Present each listing with a valid price-data date from the acquired screener page.');
    const cohort = cohorts.get(date);
    if (!cohort)
      return refuse('Present each listing with a valid price-data date from the acquired screener page.');
    const count = (counts.get(date) ?? 0) + 1;
    if (count > cohort.raw_count) return refuse('Presented price-date counts exceed the acquired cohort. Reload the source table.');
    counts.set(date, count);
    listings.push({ row, symbol, date, exchange });
  }
  return listings;
}

function plotRangeIsSafe({ min, max }: Bounds): boolean {
  return Math.abs(min) < plotLimit && Math.abs(max) < plotLimit
    && (min === max || finite(10_000 / (max - min)));
}

function percentAxis(title: string, { min, max }: Bounds) {
  // Plotly's default padding of ±1 cannot expand a large constant coordinate.
  const pad = Math.abs(min) * .05;
  const range = min === max && (min - 1 === min || max + 1 === max)
    ? [Math.max(-plotLimit, min - pad), Math.min(plotLimit, max + pad)] : undefined;
  return {
    type: 'linear', title: { text: title }, tickformat: '.2%', automargin: true,
    autorangeoptions: { clipmin: -plotLimit, clipmax: plotLimit },
    ...(range ? { range } : {}),
  };
}

function screenScope({ sort, limit, offset, filters, signals }: ScreenerFinancialEvidence['scope']): string[] {
  const page = `Acquired screener page with offset ${offset}, limit ${limit} and sort ${sort || 'unspecified'}. Universe coverage and random sampling are unverified.`;
  const applied = filters.map(([field, operator, value]) => `${field} ${operator} ${value}`);
  return [page, `Acquired filters ${applied.length ? applied.join(', ') : 'none'}.`, ...(signals ? [`Acquired signals ${signals}.`] : [])];
}

function observedDenomination(exchange: string, symbol: unknown): unknown {
  return exchange.toUpperCase() === 'US' && symbol === '$' ? 'USD' : symbol;
}

export function buildBubbleRegression(dataset: WidgetDataset, options: RecipeOptions, context: RecipeContext): RecipeResult {
  if (options.kind !== 'bubble-regression') return refuse('Choose the bubble regression recipe.');
  const decoded = decodeRecipeOptions(options, 'bubble-regression');
  if (!decoded.ok) return refuse(decoded.message);
  const evidence = readFinancialEvidence(dataset.provenance);
  if (evidence?.kind !== 'screener') return refuse('Reload an opted-in screener source with verified acquisition evidence.');
  const { unsafe } = evidence;
  if (unsafe.unassignable_identity) return refuse('The acquired screener includes an unassignable listing identity. Repair the source.');
  if (unsafe.unassignable_date) return refuse('The acquired screener includes an unassignable price-data date. Repair the source.');
  if (unsafe.unit_conflict) return refuse('The acquired screener has conflicting field units. Repair the source.');
  const bindingIssue = savedBindingIssue(options, dataset.columns, dataset.rows);
  if (bindingIssue) return refuse(bindingIssue);
  if (dataset.provenance.inputMayContainAggregates || dataset.rows.some(row => row.groupPath?.length))
    return refuse('Use the original screener listings or a filtered row presentation with their acquired fields.');
  if (dataset.rows.length > evidence.delivered_count)
    return refuse('Presented listing count exceeds the acquired screener page. Reload the source table.');

  const { fields } = options;
  const cohorts = new Map(evidence.cohorts.map(cohort => [cohort.price_date, cohort]));
  const listings = validatePresentation(dataset, fields, cohorts);
  if (!Array.isArray(listings)) return listings;
  const dates = bubblePriceDates(dataset, fields.date);
  const date = options.priceDate === 'latest' ? dates[0] : options.priceDate;
  const cohort = date && cohorts.get(date);
  if (!date || !cohort || !dates.includes(date))
    return refuse('Choose a presented price-data date from the acquired screener page.');
  const [denomination] = cohort.denominations;
  if (cohort.denominations.length > 1) return refuse(`The acquired ${date} price-data cohort has mixed market-cap denominations. Use a single-denomination screen.`);
  if (cohort.unknown_denomination || !denomination)
    return refuse(`The acquired ${date} price-data cohort has an unknown market-cap denomination. Use a source with verified listing currencies.`);
  if (cohort.conflicting_duplicates)
    return refuse(`The acquired ${date} price-data cohort contains conflicting duplicate listings. Repair the source.`);

  const selected = listings.filter(listing => listing.date === date);
  const observations = new Map<string, { listing: PresentedListing; values: readonly [unknown, unknown, unknown] }>();
  // Validate the whole selected cohort before dropping any numeric observations.
  for (const listing of selected) {
    const { row, symbol, exchange } = listing;
    if (observedDenomination(exchange, read(row, fields.currency)) !== denomination)
      return refuse('A presented listing contradicts the acquired market-cap denomination. Repair the source.');
    const x = read(row, fields.dividendYield), y = read(row, fields.priceChange), marketCap = read(row, fields.marketCap);
    const values = [x ?? null, y ?? null, marketCap ?? null] as const;
    const first = observations.get(symbol);
    if (first && !first.values.every((value, index) => value === values[index] || Object.is(value, values[index])))
      return refuse(`The presented ${date} price-data cohort contains conflicting duplicate listings. Repair the source.`);
    if (!first) observations.set(symbol, { listing, values });
  }

  const duplicates = selected.length - observations.size;
  const points: Bubble[] = [];
  let invalidYield = 0, invalidChange = 0, invalidCap = 0, numericExcluded = 0, maxCap = 0;
  for (const { listing, values: [x, y, marketCap] } of observations.values()) {
    const yieldOk = finite(x), changeOk = finite(y), capOk = finite(marketCap) && marketCap > 0;
    if (!yieldOk) invalidYield++;
    if (!changeOk) invalidChange++;
    if (!capOk) invalidCap++;
    if (!yieldOk || !changeOk || !capOk) {
      numericExcluded++;
      continue;
    }
    maxCap = Math.max(maxCap, marketCap);
    points.push({ x, y, marketCap, listing });
  }

  const countNote = `${evidence.delivered_count} delivered rows, ${dataset.rows.length} presented, ${selected.length} selected-date, ${points.length} usable and ${duplicates + numericExcluded} excluded from the selected date.`;
  const invalidNote = `Numeric exclusions ${numericExcluded} rows. ${invalidYield} missing or invalid dividend yield, ${invalidChange} missing or invalid five-day price change, ${invalidCap} missing, invalid or nonpositive market cap. A row can have multiple reasons.`;
  if (!points.length) return refuse(`Present a usable listing for ${date}. ${countNote} ${invalidNote}`);
  const bounds = pointBounds(points);
  if (!Object.values(bounds).every(plotRangeIsSafe))
    return refuse(`The ${date} sample has a dividend yield or five-day change outside the supported plotting range. ${countNote}`);

  // Plotly SVG scatter uses sqrt((marker.size / 2) / sizeref) as the radius.
  // Compute the squared radius before doubling so a representable tiny area survives the division.
  const squaredRadiusPerCap = maxSquaredRadius / maxCap;
  const sizes = points.map(({ marketCap }) => {
    const squaredRadius = finite(squaredRadiusPerCap) ? marketCap * squaredRadiusPerCap : (marketCap / maxCap) * maxSquaredRadius;
    return 2 * Math.min(squaredRadius, maxSquaredRadius);
  });
  // With sizeref 1, the supplied circle uses sqrt(size / 2) for radius.
  // Its SVG path rounds that radius to hundredths of a pixel before drawing.
  if (sizes.some(size => Math.round(Math.sqrt(size / 2) * 100) === 0))
    return refuse(`The ${date} sample includes a positive market cap with area below marker rendering precision. ${countNote}`);

  const scope = screenScope(evidence.scope);
  const presentation = `Presentation filter ${dataset.provenance.metadata?.financialSourceFiltered === true ? 'active' : 'status unrecorded'}. ${cohort.raw_count} acquired raw rows for the selected date.`;
  const notes = [
    `Price-data date ${date}. Screen retrieved ${evidence.retrieved_at}. Yield and market cap are the values returned at retrieval and may have a different measurement date. Historical screen reconstruction is unavailable.`,
    ...scope,
    presentation,
    `Marker area represents reported market cap in ${denomination}.`,
    countNote,
  ];
  if (numericExcluded) notes.push(invalidNote);
  if (duplicates || cohort.exact_duplicate_count)
    notes.push(`${duplicates} exact duplicate rows collapsed from the presented sample. ${cohort.exact_duplicate_count} exact duplicate rows in the acquired cohort.`);

  const revision = JSON.stringify([dataset.provenance.sourceWidgetId, options.kind, options.version,
    fields.symbol, fields.date, fields.dividendYield, fields.priceChange, fields.marketCap, fields.exchange,
    fields.currency, fields.name, fields.sector, date, denomination, options.regression]);
  const data: PlotlyFigure['data'] = [{
    type: 'scatter', uid: 'bubble-regression-sample', mode: 'markers', name: `Market cap area (${denomination})`,
    x: points.map(point => point.x), y: points.map(point => point.y),
    marker: { symbol: 'circle', color: color('bubble-regression-sample'), opacity: .75, line: { width: 0 },
      size: sizes, sizemode: 'area', sizeref: 1, sizemin: 0 },
    text: points.map(({ listing, marketCap }) => {
      const labels = [listing.symbol, text(read(listing.row, fields.name)), text(read(listing.row, fields.sector))];
      return [...labels.filter(Boolean).map(escape), `Reported market cap ${marketCap} ${denomination}`, `Price-data date ${date}`].join('<br>');
    }),
    hovertemplate: '%{text}<br>Dividend yield %{x:.2%}<br>Five-day price change %{y:.2%}<extra></extra>',
  }];

  let yBounds = bounds.y;
  if (options.regression) {
    const result = fitLine(points);
    if ('reason' in result) notes.push(`Regression withheld. ${result.reason}`);
    else if (!result.line.y.every(value => Math.abs(value) < plotLimit))
      notes.push('Regression withheld. A fitted endpoint is outside the supported plotting range.');
    else {
      const { fit, line } = result;
      yBounds = { min: Math.min(bounds.y.min, ...line.y), max: Math.max(bounds.y.max, ...line.y) };
      const summary = `Unweighted OLS, N = ${fit.n}, R² = ${Number(fit.rSquared.toPrecision(6))}.`;
      const relationship = `Fitted change = (${Number(fit.slope.toPrecision(6))} × yield) + (${Number(fit.intercept.toPrecision(6))}) on fractional values.`;
      notes.push(summary);
      data.push({
        type: 'scatter', uid: 'bubble-regression-line', mode: 'lines', name: 'Unweighted OLS', ...line,
        line: { color: color('fitted-relationship'), width: 2 },
        text: [summary, relationship, `Price-data date ${date}.`, ...scope, presentation].map(escape).join('<br>'),
        hovertemplate: '%{text}<br>Dividend yield %{x:.2%}<br>Fitted five-day change %{y:.2%}<extra></extra>',
      });
    }
  } else notes.push('Regression is off.');

  return {
    ok: true, revision, notes,
    figure: {
      data,
      layout: {
        ...themedLayout(context.theme), uirevision: revision,
        title: { text: 'Dividend yield versus five-day price change' }, showlegend: true,
        legend: { orientation: 'h', itemclick: false, itemdoubleclick: false },
        margin: { l: 58, r: 18, t: 48, b: 56 },
        xaxis: percentAxis('Dividend yield', bounds.x),
        yaxis: percentAxis('Five-day price change', yBounds),
      },
    },
  };
}
