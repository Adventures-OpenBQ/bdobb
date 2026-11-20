// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {readFile,writeFile} from 'node:fs/promises';
const input=process.argv[2],output=process.argv[3];
if(!input||!output)throw Error('Usage: node report.mjs measurements.json report.md');
const r=JSON.parse(await readFile(input,'utf8'));
const median=a=>{const x=[...a].sort((a,b)=>a-b);return (x[Math.floor((x.length-1)/2)]+x[Math.floor(x.length/2)])/2;};
const p95=a=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*.95)-1];
const f=n=>n.toFixed(2);
const obs=(c,m)=>c.observations[m];
const med=(c,m,fn)=>median(obs(c,m).map(fn));
const span=(c,k,metric='inclusiveMs')=>med(c,'traced',x=>x.trace.summary[k]?.[metric]??0);
const lines=[`# applyModel internal profile — 2026-11-02`,'',`Source commit: ${r.artifact.sourceRevision}. ${r.platform.cpu}; ${r.platform.os}; Chromium ${r.browser}; Node ${r.platform.node}.`,'',
'## Findings','',
'1. Search triggers a complete second unfiltered preparation in `session/legacy.rs`, preserving the full identity hierarchy. The combined case does this with sorting still active. This is deliberate correctness work, not a paging/transport cost.',
'2. Sorting is the largest named computational stage in the combined case. It sorts leaf rows inside groups in addition to the group ordering. Host ordering round trips contribute, but do not explain the whole sort cost.',
'3. Source qualification, result building, and unclassified preparation (clones, facets, metadata, identity work) are also material. Arithmetic aggregation itself is a small part of this workload.',
'4. Encoding, response serialization/decoding and worker boundary overhead are small for this grouped result. Optimizing transport first is not supported by this run.','',
'## End-to-end apply, milliseconds','',
'20 measured trials per cell after 3 warmups. Fresh worker per trial; the initial grouped view is applied before the measured edit. Alternating TypeScript/stock/traced order. All four cases passed exact stock/traced/TypeScript parity for rows, columns, totals, metadata and full exports, excluding transport IDs.','',
'| Action | TypeScript median / p95 | Stock Rust median / p95 | Traced Rust median / p95 |','|---|---:|---:|---:|'];
for(const c of r.cases){lines.push(`| ${c.action} | ${['typescript','stock','traced'].map(m=>`${f(med(c,m,x=>x.applyMs))} / ${f(p95(obs(c,m).map(x=>x.applyMs)))}`).join(' | ')} |`);}
lines.push('','10,000 rows × 5 source columns; row group `region`; sum of revenue/cost/profit. Search is `1`; sort is descending profit. Baseline re-applies the unchanged definition. The same source data is used for all four actions. This experiment uses esbuild bundles of production modules, not the earlier Vite benchmark build; absolute timings should not be pooled across the two harnesses.','',
'## Internal attribution, traced Rust medians (milliseconds)','',
'| Span | Baseline | Search | Sort | Combined |','|---|---:|---:|---:|---:|');
for(const k of ['filter.search','group.partition','aggregate','sort','host.order','result.build','wire.serialize'])lines.push(`| ${k} inclusive | ${r.cases.map(c=>f(span(c,k))).join(' | ')} |`);
for(const k of ['sort','group.partition','legacy.prepare','execute'])lines.push(`| ${k} exclusive | ${r.cases.map(c=>f(span(c,k,'exclusiveMs'))).join(' | ')} |`);
lines.push('','Inclusive spans overlap: host.order is nested inside sort, and sort is nested inside partition/pivot. Do not add inclusive rows. Exclusive values exclude instrumented children; they still contain uninstrumented work and probe bookkeeping. Recursive inclusive preparation spans can exceed wall time; exclusive spans avoid this double counting. Medians of separate stages do not sum exactly to median total time.','',
'| Calls per apply | Baseline | Search | Sort | Combined |','|---|---:|---:|---:|---:|');
for(const k of ['legacy.prepare','filter.search','pivot','aggregate','sort','host.order'])lines.push(`| ${k} | ${r.cases.map(c=>f(span(c,k,'calls'))).join(' | ')} |`);
lines.push('','## Boundary costs, milliseconds','',
'| Measurement | Baseline | Search | Sort | Combined |','|---|---:|---:|---:|---:|');
for(const k of ['encodeMs','decodeMs','hostCallbackMs','boundaryOverheadMs'])lines.push(`| ${k} | ${r.cases.map(c=>f(med(c,'traced',x=>x.trace[k]))).join(' | ')} |`);
lines.push('','hostCallbackMs measures only the JavaScript callback body; host.order additionally includes Rust JSON construction/parsing and boundary conversion. boundaryOverheadMs is parent round trip minus worker duration; it includes structured clone, scheduling and trace payload delivery. One-way timings are intentionally omitted because cross-realm origins showed submillisecond skew.','',
'## Next optimization to evaluate','',
'First separate the required unfiltered identity-universe construction from full presentation calculation. Preserve identity, selection, group-path and chart-domain behavior; measure whether hierarchy state can be reused for a pinned input revision. In parallel as a separate candidate, profile the comparator cache: `CachedOrder::cached` formats both values into debug strings on each comparison, and numeric comparisons can cross to the host. This cache hypothesis is based on source inspection; this run does not time cache formatting separately. No optimization was implemented.','',
'## Verification and limitations','',
'- Benchmark-only Rust snapshot; shipped Rust sources and generated WASM were not modified. Build fingerprints are in the raw report.',
'- Strict source anchors reject drift; JavaScript tests and a deterministic Rust nested-span test pass. The profiling WASM compiled with pinned Rust 1.98.1 and wasm-bindgen 0.2.128.',
'- Instrumented timing changes are visible in the stock/traced comparison. Treat phase numbers as attribution estimates, not zero-overhead timings.',
'- Synthetic legacy pivot workload; no claim about the analytical formula engine, native server, WAN latency, rendering/paint, memory peaks, million-row scale, or physical iPad performance.',
'- No CPU-heavy review or build ran concurrently with collection. Other desktop activity was uncontrolled.',
'- Full report is exploratory evidence, not a production benchmark qualification.','');
await writeFile(output,lines.join('\n'));
console.log(output);
