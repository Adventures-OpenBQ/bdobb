// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { datasetFromRows } from '../../localTableData';
import { etfAcquisitionProvenance, readEtfEvidence } from './etfEvidence';

const raw = (endpoint: string, parameters = { symbol: 'FUND_A.US' } as Record<string, string>, receipt?: Record<string, string>) =>
  datasetFromRows([{ symbol: /\/(sectors|countries)$/.test(endpoint) ? parameters.symbol : 'HOLDING.US', weight: .4 }], 'source', 1, 'backend', undefined, [], receipt && { receipt, completeness: 'paged' },
    { endpoint, parameters, retrievedAt: 3000 });
const receipt = { fund_symbol: 'FUND_A.US', etf_kind: 'holdings', weight_basis: 'fund-assets' };

it.each([
  ['/api/v1/eodhd/etf/holdings', 'holdings', 'fund-assets'],
  ['/eodhd/etf/sectors', 'sector', 'equity-exposure'],
  ['/etf/countries', 'region', 'equity-exposure'],
] as const)('certifies acquired route %s', (path, kind, basis) => {
  const data = raw(path, { symbol: 'FUND_A.US', provider: 'eodhd', token: 'PRIVATE' });
  const evidence = readEtfEvidence(data, kind);
  expect(evidence).toMatchObject({ ok: true, evidence: { version: 1, fund: 'FUND_A.US', kind, basis, holdingsCoverage: 'unknown', retrievedAt: 3000 } });
  expect(JSON.stringify(data.provenance)).not.toContain('PRIVATE');
  expect(data.completeness.kind).toBe('unknown');
});

it('requires one acquired fund and a bounded route or an explicit receipt', () => {
  const invalidFields: Record<string, string>[] = [{ as_of: '2026-02-30' }, { retrieved_at: '2026-01-05' },
    { holdings_coverage: 'entire' }, { etf_kind: 'sector' }, { weight_basis: 'percent' }];
  for (const data of [
    raw('/etf/holdings'), raw('/fake-eodhd/etf/holdings'), raw('/eodhd/etf/holdings/other'),
    raw('/eodhd/etf/holdings', {}), raw('/eodhd/etf/holdings', { symbol: 'A,B' }),
    raw('/eodhd/etf/holdings', { symbol: 'FUND_A.US', provider: 'other' }),
    raw('/eodhd/etf/holdings', { symbol: 'FUND_B.US' }, receipt),
    raw('/eodhd/etf/sectors', undefined, receipt),
    raw('/unknown', {}, { symbol: 'FUND_A.US', etf_kind: 'holdings', weight_basis: 'fund-assets' }),
    ...invalidFields.map(fields => raw('/unknown', {}, { ...receipt, ...fields })),
  ]) expect(readEtfEvidence(data, 'holdings').ok).toBe(false);
  expect(readEtfEvidence(raw('/unknown', {}, receipt), 'holdings').ok).toBe(true);
});

it('refuses aggregate, orphaned and malformed projected evidence', () => {
  const data = raw('/eodhd/etf/holdings');
  expect(readEtfEvidence(data, 'sector').ok).toBe(false);
  for (const provenance of [
    { ...data.provenance, inputMayContainAggregates: true }, { ...data.provenance, sourceWidgetId: 'substitute' },
    { ...data.provenance, lineage: [{ widgetId: 'unrelated', resultRevision: 1, outputRevision: 1 }] },
    { ...data.provenance, metadata: { etfEvidence: { version: 1 } } },
  ]) expect(readEtfEvidence({ ...data, provenance }, 'holdings').ok).toBe(false);
  const uncertified = { ...data, provenance: { sourceWidgetId: 'source', receipt, lineage: [{ widgetId: 'source', resultRevision: 1, outputRevision: 1 }] } };
  expect(etfAcquisitionProvenance(uncertified).metadata).toBeUndefined();
});

it('retains the snapshot retrieval and later HTTP acquisition as separate times', () => {
  const data = raw('/eodhd/etf/holdings', undefined, { ...receipt, retrieved_at: '1970-01-01T00:00:01Z' });
  const result = readEtfEvidence(data, 'holdings');
  expect(result).toMatchObject({ ok: true, evidence: { retrievedAt: 1000, acquiredAt: 3000 },
    notes: expect.arrayContaining([expect.stringMatching(/Holdings as-of date not supplied/),
      expect.stringMatching(/snapshot retrieved.*00:00:01/i), expect.stringMatching(/request completed.*00:00:03/i)]) });
});

it('rejects row and weight-column metadata that dispute the acquired basis', () => {
  const data = datasetFromRows([{ holding: 'A', weight: .1, basis: 'equity-exposure' }], 'src', 1, 'localFile', undefined, [], { receipt, completeness: 'bounded' });
  expect(readEtfEvidence(data, 'holdings').ok).toBe(false);
  const metadata = datasetFromRows([{ holding: 'A', weight: .1 }], 'src', 1, 'localFile', undefined,
    [{ id: 'weight', label: 'Weight', metadata: { weight_basis: 'equity-exposure' } }], { receipt, completeness: 'bounded' });
  expect(readEtfEvidence(metadata, 'holdings').ok).toBe(false);
});

it('requires ETF fund, kind and basis in an explicit receipt even on a recognized route', () => {
  expect(readEtfEvidence(raw('/eodhd/etf/holdings', undefined, { symbol: 'HOLDING.US' }), 'holdings').ok).toBe(false);
});

it.each(['sector', 'region'] as const)('checks the provider fund symbol on %s exposure rows', kind => {
  const exposure = { fund_symbol: 'FUND_A.US', etf_kind: kind, weight_basis: 'equity-exposure' };
  const data = datasetFromRows([{ symbol: 'OTHER.US', weight: .123 }], 'source', 1, 'localFile', undefined, [], { receipt: exposure, completeness: 'paged' });
  expect(readEtfEvidence(data, kind)).toMatchObject({ ok: false, message: expect.stringMatching(/fund identity/i) });
});

it('requires a linked presentation to retain the producer revision that delivered it', () => {
  const data = raw('/eodhd/etf/holdings');
  const presentation = { scope: 'presented' as const, rowCount: 1, revision: { widgetId: 'source', input: 2, model: 3, output: 4 } };
  for (const lineage of [undefined, [{ widgetId: 'source', resultRevision: 2, outputRevision: 4 }]]) {
    expect(readEtfEvidence({ ...data, provenance: { ...data.provenance, presentation, lineage } }, 'holdings').ok).toBe(false);
  }
  const lineage = [{ widgetId: 'source', resultRevision: 3, outputRevision: 4 }];
  expect(readEtfEvidence({ ...data, provenance: { ...data.provenance, presentation, lineage } }, 'holdings').ok).toBe(true);
});

it('checks acquired parameter declarations without treating them as a receipt', () => {
  const source = datasetFromRows([{ symbol: 'HOLDING.US', weight: .5 }], 'source', 1, 'backend');
  const certify = (parameters: Record<string, string>, documented: boolean) => {
    const dataset = { ...source, provenance: { ...source.provenance, parameters, ...(documented ? { receipt } : {}) } };
    return readEtfEvidence({ ...dataset, provenance: etfAcquisitionProvenance(dataset) }, 'holdings');
  };
  expect(certify({ symbol: 'fund_a.us' }, true).ok).toBe(true);
  expect(certify({ symbol: 'FUND_A.US', ...receipt }, false).ok).toBe(false);
  const invalidDeclarations: Record<string, string>[] = [
    { symbol: 'FUND_A.US', Symbol: 'FUND_B.US' }, { symbol: 'FUND_A.US,FUND_B.US' },
    { fund_symbol: 'FUND_B.US' }, { etf_kind: 'region' }, { weight_basis: 'equity-exposure' }, { unit: 'percent' },
  ];
  for (const invalid of invalidDeclarations) expect(certify(invalid, true).ok).toBe(false);
});

it('recognizes an explicit fractional unit without changing any weight', () => {
  const source = datasetFromRows([{ symbol: 'HOLDING', weight: .5 }], 'source', 1, 'localFile', undefined,
    [{ id: 'weight', label: 'Weight', metadata: { unit: 'fraction' } }], { receipt: { ...receipt, unit: 'fraction' }, completeness: 'paged' });
  expect(readEtfEvidence(source, 'holdings').ok).toBe(true);
  expect(source.rows[0].values.weight).toBe(.5);
});
