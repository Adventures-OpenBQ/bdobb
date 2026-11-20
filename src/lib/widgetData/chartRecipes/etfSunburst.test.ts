// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { context as request, live, local, rows, stamp } from '../../../test/fixtures/etfHierarchyEvidence';
import { datasetFromRows } from '../../localTableData';
import { parseTableSnapshot } from '../../tableRowValues';
import type { WidgetDataset } from '../types';
import { captureChartSources, chartPresentationProvenance, projectChartSources } from './chartSourceContracts';
import { buildEtfHierarchy, buildEtfSunburst } from './etfSunburst';
import { runRecipe } from './run';
import type { EtfSunburstOptions, RecipeContext } from './types';

const options: EtfSunburstOptions = {
  version: 1, kind: 'etf-sunburst', fund: 'VTI.US', depth: 2, snapshot: 'latest',
  fields: { holding: 'symbol', sector: 'sector', weight: 'weight' },
};
const context: RecipeContext = { theme: 'light', maxDecimals: 2, today: '2026-11-20', viewportWidth: 600, viewportHeight: 460 };
const holdings = [{ ...rows[0], weight: .20 }, { ...rows[1], weight: .15 }];

function acquire(results = holdings, receipt: Record<string, unknown> = local) {
  const snapshot = parseTableSnapshot({
    rows: results, completeness: receipt.coverage, chart_sources: { version: 1, receipts: [receipt] },
  }, 'local-file').snapshot;
  return datasetFromRows(results, 'etf', 1, 'localFile', undefined, [], snapshot);
}

function project(dataset: WidgetDataset, indices: number[]) {
  const visible = indices.map(index => dataset.rows[index]);
  return {
    ...dataset, rows: visible,
    provenance: projectChartSources(chartPresentationProvenance(dataset.provenance, true), dataset.columns, visible),
  };
}

function requireSuccess<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result as Extract<T, { ok: true }>;
}

it('known_result preserves 35% delivered weight and separately labels the delivered-root share', () => {
  const dataset = acquire();
  const { value: { root, sectors, holdings: leaves }, notes } = requireSuccess(buildEtfHierarchy(dataset, options));
  expect(root.value).toBeCloseTo(.35);
  expect(notes.join(' ')).toContain('Delivered holdings');
  expect(notes.join(' ')).toContain('35% of fund assets');
  expect(notes.join(' ')).not.toContain('100%');
  expect(sectors.map(({ value }) => value)).toEqual([.20, .15]);
  expect(leaves.map(({ parentId }) => parentId)).toEqual(sectors.map(({ id }) => id));
  const result = requireSuccess(runRecipe(dataset, options, context));
  expect(result.figure.layout.title).toMatchObject({ text: 'VTI.US · Delivered holdings<br>35% of fund assets' });
  expect(result.figure.data[0]).toMatchObject({
    type: 'sunburst', branchvalues: 'total', values: [.35, .20, .20, .15, .15],
    text: expect.arrayContaining([expect.stringMatching(/Original fund weight: 0\.2 .*Share of delivered holdings: 57\.14%/)]),
  });
  expect(result.etfHierarchy?.root).toEqual(root);
});

it('zero_missing_and_scope keeps zero observations in text and assigns missing sector explicitly', () => {
  const zero = [{ ...holdings[0], weight: 0 }, holdings[1]];
  const result = requireSuccess(buildEtfSunburst(acquire(zero), options, context));
  expect(result.etfHierarchy?.holdings).toContainEqual(expect.objectContaining({ value: 0, label: 'AAPL.US' }));
  expect(result.etfHierarchy?.sectors).toContainEqual(expect.objectContaining({ label: 'Sector unavailable', value: .15 }));
  expect(result.figure.data[0]).toMatchObject({ labels: expect.arrayContaining(['Sector unavailable']) });
  expect(result.figure.data[0]).not.toMatchObject({ labels: expect.arrayContaining(['AAPL.US', 'Technology']) });

  const allZero = requireSuccess(buildEtfSunburst(acquire(zero.map(row => ({ ...row, weight: 0 }))), options, context));
  expect(allZero.etfHierarchy?.holdings).toHaveLength(2);
  expect(allZero.figure.data).toEqual([]);
  expect(allZero.notes.join(' ')).toMatch(/zero/i);
});

it('hidden_unsafe_fact refuses classified, conflicting or negative raw evidence after filtering', () => {
  for (const flag of ['classification_conflict', 'duplicate_conflict', 'negative_weight', 'excess_weight'] as const) {
    const receipt = { ...live, diagnostics: [flag], unsafe: { ...live.unsafe, [flag]: true } };
    const chartSources = captureChartSources(request, {
      results: holdings, extra: { results_metadata: { chart_sources: { version: 1, receipts: [receipt] } } },
    }, holdings);
    expect(chartSources).toBeDefined();
    const dataset = datasetFromRows(holdings, 'backend', 1, 'backend', undefined, [], undefined, { ...request, chartSources });
    expect(buildEtfHierarchy(project(dataset, [0]), options)).toMatchObject({ ok: false, message: expect.stringMatching(/acquisition reports/i) });
  }
});

it('numerical_limits refuses totals outside the acquired tolerance and preserves admitted rounding', () => {
  const complete = { ...local, coverage: 'complete' };
  const full = acquire([holdings[0], { ...holdings[1], weight: .80 }], complete);
  expect(requireSuccess(buildEtfHierarchy(full, options)).value.root.value).toBe(1);
  full.rows[1] = { ...full.rows[1], values: { ...full.rows[1].values, weight: .70 } };
  expect(buildEtfHierarchy(full, options)).toMatchObject({ ok: false, message: expect.stringMatching(/complete.*100%/i) });

  const partial = acquire();
  partial.rows[1] = { ...partial.rows[1], values: { ...partial.rows[1].values, weight: .81 } };
  expect(buildEtfHierarchy(partial, options)).toMatchObject({ ok: false, message: expect.stringMatching(/total.*exceeds/i) });

  const rounding = { ...local, rounding_bound_fraction: .0001, rounding_reference: 'issuer:precision' };
  const rounded = requireSuccess(buildEtfHierarchy(acquire([holdings[0], { ...holdings[1], weight: .80009 }], rounding), options));
  expect(rounded.value.root.value).toBe(1.00009);
  expect(rounded.notes.join(' ')).toMatch(/rounding.*0\.0001.*issuer:precision/i);
  const strict = acquire([holdings[0], { ...holdings[1], weight: .80 }], {
    ...rounding, coverage: 'complete', rounding_bound_fraction: 0,
  });
  strict.rows[1] = { ...strict.rows[1], values: { ...strict.rows[1].values, weight: .80000000000001 } };
  expect(buildEtfHierarchy(strict, options)).toMatchObject({ ok: false, message: expect.stringMatching(/total.*exceeds/i) });
});

it('mixed_basis refuses a separate sector exposure acquisition and contradictory column or cell evidence', () => {
  const sectors = datasetFromRows([{ sector: 'Technology', weight: .2 }], 'sector', 1, 'localFile', undefined, [], {
    completeness: 'unknown', receipt: { fund_symbol: 'VTI.US', etf_kind: 'sector', basis: 'equity-exposure', unit: 'fraction' },
  });
  expect(buildEtfHierarchy(sectors, options)).toMatchObject({ ok: false, message: expect.stringMatching(/fund.assets/i) });
  const certified = acquire();
  const withWeight = (change: Partial<WidgetDataset['columns'][number]>) => ({
    ...certified, columns: certified.columns.map(column => column.id === 'weight' ? { ...column, ...change } : column),
  });
  for (const issue of [
    withWeight({ metadata: { weight_basis: 'equity-exposure' } }),
    withWeight({ format: { formatterFn: 'percent' } }),
    withWeight({ analytical: { kind: 'formula', definitionId: 'weight', name: 'weight' } }),
    { ...certified, provenance: { ...certified.provenance, inputMayContainAggregates: true } },
    { ...certified, rows: [{ ...certified.rows[0], cellErrors: { weight: { code: 'ERROR', message: 'broken' } } }, certified.rows[1]] },
    { ...certified, rows: [{ ...certified.rows[0], cellFormats: { weight: { formatterFn: 'percent' as const } } }, certified.rows[1]] },
    { ...certified, columns: certified.columns.filter(({ id }) => id !== 'snapshot') },
    { ...certified, rows: [certified.rows[0], certified.rows[0]] },
  ]) expect(buildEtfHierarchy(issue, options)).toMatchObject({ ok: false });
  const alias = {
    ...certified, columns: certified.columns.map(column => column.id === 'weight'
      ? { ...column, id: 'allocation', sourceFieldId: 'weight' } : column),
    rows: certified.rows.map(row => ({ ...row, values: { ...row.values, allocation: row.values.weight } })),
  };
  expect(requireSuccess(buildEtfHierarchy(alias, { ...options, fields: { ...options.fields, weight: 'allocation' } })).value.root.value)
    .toBe(.35);
});

it('accepts sparse optional declarations after strict source acquisition and still checks contradictory values', () => {
  const date = '2026-10-31';
  const source = { ...local, as_of: date, snapshot: date };
  const sparse = [
    { ...holdings[0], snapshot: date, as_of: date, basis: 'fund-assets', unit: 'fraction',
      etf_kind: 'holdings', holdings_coverage: 'partial' },
    { ...holdings[1], snapshot: date },
  ];
  const dataset = acquire(sparse, source);
  expect(dataset.provenance.metadata?.chartSources).toEqual({ 'etf-hierarchy': source });
  expect(dataset.rows[1].values).toMatchObject({ basis: null, unit: null, etf_kind: null, holdings_coverage: null, as_of: null });
  expect(requireSuccess(buildEtfHierarchy(dataset, options)).value.root.value).toBe(.35);

  const second = dataset.rows[1];
  for (const values of [{ basis: 'equity-exposure' }, { unit: 'percent-points' },
    { etf_kind: 'sector' }, { holdings_coverage: 'complete' }, { as_of: '2026-10-30' },
    { weight_basis: null }, { weight_unit: null }]) {
    const changed = { ...dataset, rows: [dataset.rows[0], { ...second, values: { ...second.values, ...values } }] };
    expect(buildEtfHierarchy(changed, options)).toMatchObject({ ok: false });
  }
  const error = { ...dataset, rows: [dataset.rows[0], { ...second, cellErrors: { basis: { code: 'ERROR', message: 'bad basis' } } }] };
  expect(buildEtfHierarchy(error, options)).toMatchObject({ ok: false });

  const withAsOf = acquire(holdings.map(row => ({ ...row, as_of: date })), { ...local, as_of: date });
  withAsOf.rows[1].values.as_of = null;
  expect(buildEtfHierarchy(withAsOf, options)).toMatchObject({ ok: false });
});

it('attributes a collapsed sector to its original fraction and offers only a relevant depth repair', () => {
  const small = 1e-10;
  const narrow = [{ ...holdings[0], weight: .35 - small }, { ...holdings[1], weight: small }];
  const separate = buildEtfSunburst(acquire(narrow), options, context);
  expect(separate).toMatchObject({ ok: false, message: expect.stringMatching(/geometry.*Sector unavailable.*1e-10/i) });
  if (!separate.ok) expect(separate.message).not.toMatch(/sector depth/i);
  const sameSector = acquire([narrow[0], { ...narrow[1], sector: narrow[0].sector }]);
  expect(buildEtfSunburst(sameSector, options, context)).toMatchObject({ ok: false,
    message: expect.stringMatching(/geometry.*AAYA\.F.*1e-10.*sector depth/i) });
  expect(buildEtfSunburst(sameSector, { ...options, depth: 1 }, context).ok).toBe(true);
});

it('refuses a holding when rounded endpoints move radially and miss the intended wedge', () => {
  const weights = [.08726681249999999, 3.899296105751436e-9, .26273318360070386];
  const leaves = [
    { ...holdings[0], weight: weights[0] },
    { ...holdings[1], sector: holdings[0].sector, weight: weights[1] },
    { ...holdings[0], symbol: 'OTHER.US', weight: weights[2] },
  ];
  const dataset = acquire(leaves, { ...local, raw_count: 3, normalized_count: 3, delivered_count: 3,
    holding_keys: leaves.map(({ symbol }) => symbol) });
  const built = requireSuccess(buildEtfHierarchy(dataset, options));
  expect(built.value.holdings[1]).toMatchObject({ symbol: 'AAYA.F', value: weights[1] });
  const result = buildEtfSunburst(dataset, options, context);
  expect(result).toMatchObject({ ok: false,
    message: expect.stringContaining('Original fund weight 3.899296105751436e-9. Select sector depth') });
  const sectors = requireSuccess(buildEtfSunburst(dataset, { ...options, depth: 1 }, context));
  expect(sectors.etfHierarchy?.holdings[1].value).toBe(weights[1]);
});

it('admits a narrow holding whose rounded midpoint still lies inside the wedge', () => {
  const weights = [.14747811893136722, 6.057835021435319e-9, .20252187501079774];
  const leaves = [
    { ...holdings[0], weight: weights[0] },
    { ...holdings[1], sector: holdings[0].sector, weight: weights[1] },
    { ...holdings[0], symbol: 'OTHER.US', weight: weights[2] },
  ];
  const dataset = acquire(leaves, { ...local, raw_count: 3, normalized_count: 3, delivered_count: 3,
    holding_keys: leaves.map(({ symbol }) => symbol) });
  const result = requireSuccess(runRecipe(dataset, options, context));
  expect(result.etfHierarchy?.holdings[1]).toMatchObject({ symbol: 'AAYA.F', value: weights[1] });
  expect(result.figure.data[0]).toMatchObject({ values: expect.arrayContaining([weights[1]]) });
});

it('stable_node_ids_disambiguate_equal_labels_and_keep_exact_small_values', () => {
  const tiny = .000001;
  const duplicateLabels = [{ ...holdings[0], sector: 'Sector unavailable' }, { ...holdings[1], weight: tiny },
    { ...holdings[1], symbol: 'OTHER.US', sector: 'VTI.US', weight: .1 },
    { ...holdings[1], symbol: 'THIRD.US', sector: 'AAPL.US', weight: .1 },
    { ...holdings[1], symbol: 'FOURTH.US', sector: '<b>IT & Data</b>', weight: .1 }];
  const receipt = { ...local, delivered_count: 5, normalized_count: 5, raw_count: 5, holding_keys: duplicateLabels.map(row => row.symbol) };
  const dataset = acquire(duplicateLabels, receipt);
  const deep = requireSuccess(buildEtfSunburst(dataset, options, context));
  const details = deep.etfHierarchy!;
  expect(details.sectors.filter(({ label }) => label === 'Sector unavailable')).toHaveLength(2);
  const nodes = [details.root, ...details.sectors, ...details.holdings];
  expect(new Set(nodes.map(({ id }) => id)).size).toBe(nodes.length);
  expect(details.holdings.find(({ label }) => label === 'AAYA.F')?.value).toBe(tiny);
  expect(deep.figure.data[0]).toMatchObject({
    values: expect.arrayContaining([tiny]),
    labels: expect.arrayContaining(['&lt;b&gt;IT &amp; Data&lt;/b&gt;']),
    text: expect.arrayContaining([expect.stringContaining('Original fund weight: 0.000001')]),
  });
  const shallow = requireSuccess(buildEtfSunburst(dataset, { ...options, depth: 1 }, context));
  expect(shallow.figure.data[0]).not.toMatchObject({ labels: expect.arrayContaining(['AAYA.F']) });
  expect(shallow.etfHierarchy?.holdings).toEqual(details.holdings);

  const unrenderable = acquire([holdings[0], { ...holdings[1], weight: Number.MIN_VALUE }]);
  expect(requireSuccess(buildEtfHierarchy(unrenderable, options)).value.holdings.map(({ value }) => value)).toContain(Number.MIN_VALUE);
  expect(buildEtfSunburst(unrenderable, options, context)).toMatchObject({ ok: false, message: expect.stringMatching(/geometry.*5e-324/i) });
});

it('follow_latest_revision_uses_the_resolved_observation_and_missing_pin_refuses', () => {
  const initial = acquire();
  const first = requireSuccess(runRecipe(initial, options, context));
  const refresh = { ...initial, resultRevision: 7, outputRevision: 11 };
  const resized = { ...context, viewportHeight: 360, viewportWidth: 520 };
  expect(requireSuccess(runRecipe(refresh, options, resized)).revision).toBe(first.revision);
  const nextStamp = '2026-11-20T04:16:45.000001Z';
  const newer = acquire(holdings.map(row => ({ ...row, snapshot: nextStamp })), { ...local, snapshot: nextStamp, retrieved_at: nextStamp });
  const next = requireSuccess(runRecipe(newer, options, context));
  expect(next.etfHierarchy?.snapshot).toBe(nextStamp);
  expect(next.revision).not.toBe(first.revision);
  const dated = { ...local, as_of: '2026-10-31' };
  const datedRows = holdings.map(row => ({ ...row, as_of: dated.as_of }));
  const datedResult = requireSuccess(runRecipe(acquire(datedRows, dated), options, context));
  expect(datedResult.revision).not.toBe(first.revision);
  expect(datedResult.notes.join(' ')).toContain('As of 2026-10-31');
  expect(runRecipe(newer, { ...options, snapshot: stamp }, context)).toMatchObject({ ok: false, message: expect.stringMatching(/pinned.*unavailable/i) });
  expect(requireSuccess(runRecipe(newer, { ...options, snapshot: nextStamp }, context)).revision).not.toBe(next.revision);
  expect(runRecipe(newer, { ...options, coverage: 'complete' } as EtfSunburstOptions, context)).toMatchObject({ ok: false, message: expect.stringMatching(/unsupported/i) });
});

it('verified missing mass is independently authorized and vanishes when holdings are omitted', () => {
  const source = { ...local, missing_mass: { status: 'verified', fraction: .65, reference: 'issuer:missing-measure' } };
  const dataset = acquire(holdings, source);
  const filled = requireSuccess(buildEtfHierarchy(dataset, options));
  expect(filled.value.deliveredWeight).toBe(.35);
  expect(filled.value.root.value).toBe(1);
  expect(filled.value.residual).toMatchObject({ value: .65, label: 'Unallocated/not delivered' });
  expect(filled.notes.join(' ')).toContain('issuer:missing-measure');
  const narrowed = requireSuccess(buildEtfHierarchy(project(dataset, [0]), options));
  expect(narrowed.value.root.value).toBe(.2);
  expect(narrowed.value.residual).toBeUndefined();
  expect(narrowed.notes.join(' ')).toMatch(/1 of 2.*weight unavailable/i);
  expect(narrowed.notes.join(' ')).not.toContain('65%');
  const complete = acquire([holdings[0], { ...holdings[1], weight: .8 }], { ...local, coverage: 'complete' });
  expect(requireSuccess(buildEtfHierarchy(project(complete, [0]), options)).value.scope).toBe('delivered');
  expect(requireSuccess(buildEtfHierarchy(project(complete, [0, 1]), options)).value.scope).toBe('delivered');
});
