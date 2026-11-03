import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const mappingVersion = 'sec-statements/1.0.0';
const decimal = /^-?\d+(?:\.\d+)?$/;

/** Verify only local committed payloads; root is the sec-statements fixture directory. */
export async function verifyFixtures(root) {
  root = await realpath(root);
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.format, 1, 'Unknown manifest format');
  assert.equal(manifest.mappingVersion, mappingVersion, 'Unknown mapping version');
  assert.equal(manifest.numericPolicy.id, 'decimal-source-binary64/1', 'Unknown numeric policy');
  assert.deepEqual(manifest.files.map(f => f.path).sort(), ['expected.json', 'reference.json', 'trace.json']);
  const payloads = {};
  for (const entry of manifest.files) {
    const path = await realpath(resolve(root, entry.path));
    assert.ok(path.startsWith(root + sep), 'Payload escapes fixture root');
    const bytes = await readFile(path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `Checksum: ${entry.path}`);
    payloads[entry.path] = JSON.parse(bytes);
  }
  const reference = payloads['reference.json'];
  const expected = payloads['expected.json'];
  const trace = payloads['trace.json'];
  assert.equal(reference.mappingVersion, mappingVersion, 'Unknown mapping version');
  assert.equal(reference.mappings.length, 6);
  assert.deepEqual(manifest.companies.map(c => c.symbol).sort(), ['AMD', 'AMZN', 'GOOG', 'META', 'NVDA', 'TSLA']);
  let rows = 0, expectedCells = 0;
  const identities = new Set();
  for (const company of manifest.companies) {
    assert.match(company.source.url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//);
    assert.match(company.source.sha256, /^[a-f0-9]{64}$/);
    const data = reference.companies[company.symbol];
    const traces = trace[company.symbol];
    assert.equal(traces.length, data.dataset.rows.length);
    const periods = new Set();
    for (const row of data.dataset.rows) {
      assert.ok(!identities.has(row.id), 'Duplicate fact identity'); identities.add(row.id);
      const v = row.values;
      assert.equal(v.company, company.company);
      assert.equal(v.source_accession, company.accession);
      periods.add(JSON.stringify({ year: v.year, start: v.report_start, end: v.report_end }));
      const t = traces.find(t => t.row_id === row.id);
      assert.ok(t, 'Missing source trace');
      const value = t.value_decimal ?? t.decimal;
      assert.match(value, decimal);
      assert.equal(v.source_decimal, `decimal:${value}`);
      assert.equal(v.value, Number(value));
      assert.ok(Number.isFinite(v.value));
      if (Number.isInteger(v.value)) assert.ok(Number.isSafeInteger(v.value), 'Unsafe integer');
      // Numeric lexical equivalence allows source trailing zeroes, never rounding.
      assert.equal(normalize(String(v.value)), normalize(value), 'Decimal conversion loses precision');
      assert.equal(v.concept, `us-gaap:${t.concept}`);
      assert.equal(v.unit, t.unit);
      assert.equal(v.source_fact_start, t.fact_start ?? t.start ?? null);
      assert.equal(v.source_fact_end, t.fact_end ?? t.end);
      const contexts = t.original_xbrl_context_ids ?? t.context_ids;
      assert.ok(contexts.length && contexts.every(c => typeof c === 'string' && c.length));
      assert.equal(expected[company.symbol][v.year][v.item], value, 'Reported fact differs from expected cell');
      rows++;
    }
    assert.deepEqual([...periods].sort(), company.reportPeriods.map(p => JSON.stringify(p)).sort());
    for (const [year, cells] of Object.entries(expected[company.symbol])) {
      assert.ok(company.reportPeriods.some(p => String(p.year) === year));
      for (const value of Object.values(cells)) { assert.match(value, decimal); expectedCells++; }
    }
  }
  for (const mapping of reference.mappings) {
    const company = manifest.companies.find(c => c.symbol === mapping.symbol);
    assert.equal(mapping.accession, company.accession);
    assert.ok(reference.companies[mapping.symbol].dataset.rows.some(r => r.values.item.endsWith('/' + mapping.line) && r.values.concept === 'us-gaap:' + mapping.mapped_concept));
  }
  assert.equal(rows, 98); assert.equal(expectedCells, 110);
  assert.deepEqual(manifest.counts, { rows, expectedCells });
  const all = JSON.stringify({ manifest, payloads });
  assert.ok(!/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(all), 'Contact email in corpus');
  assert.ok(!/(?:\/Users\/|\/Volumes\/|\/home\/|[A-Z]:\\)/.test(all), 'Absolute developer path in corpus');
  return { files: manifest.files.length, rows, expectedCells };
}
function normalize(value) {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}
