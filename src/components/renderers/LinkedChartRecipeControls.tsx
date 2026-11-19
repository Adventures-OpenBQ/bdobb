// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from 'react';
import { bindingRoles, bindingCandidates } from '../../lib/widgetData/chartRecipes/bindings';
import { decodeRecipeOptions } from '../../lib/widgetData/chartRecipes/settings';
import type { RecipeOptions } from '../../lib/widgetData/chartRecipes/types';
import type { DatasetColumn } from '../../lib/widgetData/types';

type Kind = RecipeOptions['kind'];
type Metric = 'eps' | 'revenue';
type LoadSymbols = (field: string | undefined, signal: AbortSignal) => Promise<string[]>;

export const recipeLabels: Record<Kind, string> = {
  drawdown: 'Drawdown', 'yield-curve': 'Yield curve', 'estimate-range': 'Estimate range',
  'monthly-returns': 'Monthly returns', correlation: 'Correlation',
  'return-distribution': 'Return distribution', 'small-multiples': 'Small multiples',
  'etf-pareto': 'ETF holdings Pareto', 'etf-exposure': 'ETF exposure',
};

function missingRoles(kind: Kind, columns: DatasetColumn[], metric: Metric) {
  return bindingRoles(kind, metric).filter(r => !r.optional && !bindingCandidates(r, columns).length).map(r => r.label.toLowerCase());
}
export function recipeAvailability(kind: Kind, columns: DatasetColumn[]): string | null {
  const missing = missingRoles(kind, columns, 'eps');
  if (!missing.length || (kind === 'estimate-range' && !missingRoles(kind, columns, 'revenue').length)) return null;
  return 'Present raw fields for ' + missing.join(', ') + '.';
}
function defaults(kind: Kind, metric: Metric, columns: DatasetColumn[]): Record<string, string> {
  return Object.fromEntries(bindingRoles(kind, metric).flatMap(role => {
    const available = bindingCandidates(role, columns);
    const named = available.find(c => role.names.includes((c.sourceFieldId ?? c.id).toLowerCase()));
    const column = named ?? (role.date && available.length === 1 ? available[0] : undefined);
    return column ? [[role.key, column.id]] : [];
  }));
}

export function LinkedChartRecipeControls({ kind, saved, columns, loadSymbols, disabled, onApply }: {
  kind: Kind; saved?: RecipeOptions; columns: DatasetColumn[]; loadSymbols: LoadSymbols;
  disabled: boolean; onApply: (options: RecipeOptions) => void;
}) {
  const [metric, setMetric] = useState<Metric>(() => saved?.kind === 'estimate-range' ? saved.metric
    : kind === 'estimate-range' && !missingRoles(kind, columns, 'revenue').length && missingRoles(kind, columns, 'eps').length ? 'revenue' : 'eps');
  const [fields, setFields] = useState<Record<string, string>>(() => saved ? { ...saved.fields } : defaults(kind, metric, columns));
  const [symbols, setSymbols] = useState<string[]>(() => saved && 'symbols' in saved ? saved.symbols : saved && 'symbol' in saved ? [saved.symbol] : []);
  const [lookback, setLookback] = useState(String(saved?.kind === 'correlation' ? saved.lookback : 252));
  const [overlap, setOverlap] = useState(String(saved?.kind === 'correlation' ? saved.minOverlap : 60));
  const [bins, setBins] = useState(String(saved?.kind === 'return-distribution' ? saved.bins : 30));
  const [mode, setMode] = useState<'sector' | 'region'>(() => {
    if (saved?.kind === 'etf-exposure') return saved.mode;
    const category = columns.find(c => c.id === fields.category);
    return /^(country|region)$/i.test(category?.sourceFieldId ?? category?.id ?? '') ? 'region' : 'sector';
  });
  const singleSymbol = kind === 'monthly-returns' || kind === 'return-distribution';
  const multipleSymbols = kind === 'drawdown' || kind === 'correlation' || kind === 'small-multiples';
  const needsSymbols = singleSymbol || multipleSymbols;
  const roleList = bindingRoles(kind, metric);
  const fieldIssue = roleList.find(role => (
    !fields[role.key] ? !role.optional : !bindingCandidates(role, columns).some(c => c.id === fields[role.key])
  ));
  const fieldsReady = !fieldIssue;
  const symbolField = fields.symbol;
  const [choices, setChoices] = useState<{ load: LoadSymbols; field?: string; values: string[]; error?: string }>();
  useEffect(() => {
    if (!needsSymbols || !fieldsReady) return;
    const controller = new AbortController();
    void loadSymbols(symbolField, controller.signal).then(values => {
      if (!controller.signal.aborted) setChoices({ load: loadSymbols, field: symbolField, values });
    }).catch(error => {
      if (!controller.signal.aborted) setChoices({ load: loadSymbols, field: symbolField, values: [], error: String(error instanceof Error ? error.message : error) });
    });
    return () => controller.abort();
  }, [needsSymbols, fieldsReady, loadSymbols, symbolField]);
  const current = choices?.load === loadSymbols && choices.field === symbolField ? choices : undefined;
  const choiceIssue = needsSymbols && (!current ? 'Loading source symbols…' : current.error ??
    (!current.values.length ? 'No identified symbols in the presented source. Bind a symbol field or document a single acquisition symbol.' :
      symbols.some(symbol => !current.values.includes(symbol)) ? 'Repair the unavailable symbol selection.' : undefined));
  const candidate = { version: 1, kind, fields, ...(kind === 'estimate-range' ? { metric } : {}),
    ...(singleSymbol ? { symbol: symbols[0] } : {}),
    ...(multipleSymbols ? { symbols } : {}),
    ...(kind === 'return-distribution' ? { bins: Number(bins) } : {}),
    ...(kind === 'etf-exposure' ? { mode } : {}),
    ...(kind === 'correlation' ? { lookback: Number(lookback), minOverlap: Number(overlap) } : {}) };
  const decoded = decodeRecipeOptions(candidate, kind);
  const problem = fieldIssue ? 'Choose a presented ' + fieldIssue.label.toLowerCase() + ' field.' : choiceIssue || (!decoded.ok && decoded.message);
  return <fieldset disabled={disabled}><legend>{recipeLabels[kind]} settings</legend>
    {kind === 'estimate-range' && <label>Metric<select value={metric} onChange={e => {
      const next = e.target.value === 'revenue' ? 'revenue' : 'eps';
      setMetric(next);
      const binding = defaults(kind, next, columns);
      setFields({ ...fields, low: binding.low ?? '', average: binding.average ?? '', high: binding.high ?? '' });
    }}>{(['eps', 'revenue'] as const).map(m => <option key={m} value={m} disabled={!!missingRoles(kind, columns, m).length}>{m === 'eps' ? 'EPS' : 'Revenue'}</option>)}</select></label>}
    {roleList.map(role => {
      const available = bindingCandidates(role, columns);
      const value = fields[role.key] ?? '';
      return <label key={role.key}>{role.label}<select value={value} onChange={e => {
        const next = { ...fields };
        if (e.target.value) next[role.key] = e.target.value; else delete next[role.key];
        setFields(next);
        if (role.key === 'symbol') setSymbols([]);
      }}>
        <option value="">{role.optional ? 'None' : 'Choose field'}</option>
        {value && !available.some(c => c.id === value) && <option value={value}>{value} (unavailable)</option>}
        {available.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select></label>;
    })}
    {singleSymbol && <label>Symbol<select value={symbols[0] ?? ''} onChange={e => setSymbols(e.target.value ? [e.target.value] : [])}>
      <option value="">Choose symbol</option>
      {[...new Set([...symbols, ...(current?.values ?? [])])].map(s => <option key={s} value={s}>{s}</option>)}
    </select></label>}
    {multipleSymbols && <fieldset><legend>Symbols</legend>
      {[...new Set([...symbols, ...(current?.values ?? [])])].map(s => <label key={s}><input type="checkbox" checked={symbols.includes(s)}
        onChange={e => setSymbols(e.target.checked ? [...symbols, s] : symbols.filter(v => v !== s))}/>{s}</label>)}
    </fieldset>}
    {kind === 'return-distribution' && <label>Bins<input type="number" min="5" max="100" step="1" value={bins} onChange={e => setBins(e.target.value)}/></label>}
    {kind === 'etf-exposure' && <label>Exposure mode<select value={mode} onChange={e => setMode(e.target.value === 'region' ? 'region' : 'sector')}>
      <option value="sector">Sector</option><option value="region">Region</option>
    </select></label>}
    {kind === 'correlation' && <><label>Lookback<input type="number" min="3" value={lookback} onChange={e => setLookback(e.target.value)}/></label>
      <label>Minimum overlap<input type="number" min="3" max={lookback} value={overlap} onChange={e => setOverlap(e.target.value)}/></label></>}
    {problem && <p role="status">{problem}</p>}
    <button type="button" disabled={!!problem} onClick={() => { if (!problem && decoded.ok) onApply(decoded.options); }}>Apply chart settings</button>
  </fieldset>;
}
