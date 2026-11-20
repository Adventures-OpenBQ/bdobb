// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from 'react';
import { bindingRoles, bindingCandidates, isIncomePeriodColumn } from '../../lib/widgetData/chartRecipes/bindings';
import { decodeRecipeOptions } from '../../lib/widgetData/chartRecipes/settings';
import type { RecipeOptions } from '../../lib/widgetData/chartRecipes/types';
import type { DatasetColumn, WidgetDataset } from '../../lib/widgetData/types';
import { acquiredNewsWindow, inspectNewsPresentation, inspectNewsSource, resolveNewsWindow } from '../../lib/widgetData/chartRecipes/newsCalendarInput';

type Kind = RecipeOptions['kind'];
type Metric = 'eps' | 'revenue';
type Mode = 'sector' | 'region';
type LoadNewsInput = (signal: AbortSignal) => Promise<WidgetDataset>;
type LoadSymbols = (field: string | undefined, signal: AbortSignal) => Promise<string[]>;
export type SourceChoiceKind = 'bubble-regression' | 'dividend-steps' | 'income-sankey';
export type SourceChoice = { value: string; label: string; issue?: string };
type LoadSourceChoices = (kind: SourceChoiceKind, dateField: string | undefined, signal: AbortSignal) => Promise<SourceChoice[]>;

const sourceChoiceLabels = {
  'bubble-regression': { label: 'Price date', unavailable: 'Present valid price-data dates from the screening source.' },
  'dividend-steps': { label: 'Acquired instrument', unavailable: 'Acquire dividend data with a qualified instrument receipt.' },
  'income-sankey': { label: 'Income statement period', unavailable: 'Present an acquired actual FY or FQ income statement period.' },
};

function usesSourceChoices(kind: Kind): kind is SourceChoiceKind {
  return Object.hasOwn(sourceChoiceLabels, kind);
}

export const recipeLabels: Partial<Record<Kind, string>> = {
  drawdown: 'Drawdown', 'yield-curve': 'Yield curve', 'estimate-range': 'Estimate range',
  'monthly-returns': 'Monthly returns', correlation: 'Correlation',
  'return-distribution': 'Return distribution', 'small-multiples': 'Small multiples',
  'etf-pareto': 'ETF holdings Pareto', 'etf-exposure': 'ETF exposure',
  'bubble-regression': 'Screening bubble', 'dividend-steps': 'Dividend steps', 'income-sankey': 'Income Sankey',
  'news-sentiment-calendar': 'News sentiment calendar',
};

function missingRoles(kind: Kind, columns: DatasetColumn[], metric: Metric, mode?: Mode) {
  return bindingRoles(kind, metric, mode).filter(r => !r.optional && !bindingCandidates(r, columns).length).map(r => r.label.toLowerCase());
}
export function recipeAvailability(kind: Kind, columns: DatasetColumn[], verifiedEmpty = false): string | null {
  if (kind === 'news-sentiment-calendar') return null; // The draft loads and checks the acquisition, including a columnless empty result.
  if (kind === 'dividend-steps' && verifiedEmpty) return null;
  if (kind === 'income-sankey') return columns.some(isIncomePeriodColumn) ? null
    : 'Present actual FY or FQ columns from an income Statement table.';
  const missing = missingRoles(kind, columns, 'eps');
  if (kind === 'etf-exposure' && !missingRoles(kind, columns, 'eps', 'region').length) return null;
  if (!missing.length || (kind === 'estimate-range' && !missingRoles(kind, columns, 'revenue').length)) return null;
  return 'Present raw fields for ' + missing.join(', ') + '.';
}
function defaults(kind: Kind, metric: Metric, columns: DatasetColumn[], mode?: Mode): Record<string, string> {
  return Object.fromEntries(bindingRoles(kind, metric, mode).flatMap(role => {
    const available = bindingCandidates(role, columns);
    const named = available.find(c => role.names.includes((c.sourceFieldId ?? c.id).toLowerCase()));
    const column = named ?? (role.date && available.length === 1 ? available[0] : undefined);
    return column ? [[role.key, column.id]] : [];
  }));
}

export function LinkedChartRecipeControls({ kind, saved, columns, verifiedEmpty, loadSymbols, loadSourceChoices, loadNewsInput, disabled, onApply }: {
  kind: Kind; saved?: RecipeOptions; columns: DatasetColumn[]; verifiedEmpty?: boolean; loadSymbols: LoadSymbols;
  loadSourceChoices?: LoadSourceChoices; loadNewsInput?: LoadNewsInput; disabled: boolean; onApply: (options: RecipeOptions) => void;
}) {
  const [metric, setMetric] = useState<Metric>(() => saved?.kind === 'estimate-range' ? saved.metric
    : kind === 'estimate-range' && !missingRoles(kind, columns, 'revenue').length && missingRoles(kind, columns, 'eps').length ? 'revenue' : 'eps');
  const [mode, setMode] = useState<Mode>(() => saved?.kind === 'etf-exposure' ? saved.mode
    : kind === 'etf-exposure' && missingRoles(kind, columns, metric).length && !missingRoles(kind, columns, metric, 'region').length ? 'region' : 'sector');
  const [editedFields, setFields] = useState<Record<string, string> | undefined>(() => saved && 'fields' in saved ? { ...saved.fields } : undefined);
  const news = kind === 'news-sentiment-calendar';
  const [newsRead, setNewsRead] = useState<{ load: LoadNewsInput; dataset?: WidgetDataset; error?: string }>();
  useEffect(() => {
    if (!news || !loadNewsInput) return;
    const controller = new AbortController();
    void loadNewsInput(controller.signal).then(dataset => {
      if (!controller.signal.aborted) setNewsRead({ load: loadNewsInput, dataset });
    }).catch(error => {
      if (!controller.signal.aborted) setNewsRead({ load: loadNewsInput, error: error instanceof Error ? error.message : String(error) });
    });
    return () => controller.abort();
  }, [news, loadNewsInput]);
  const newsReadCurrent = newsRead?.load === loadNewsInput ? newsRead : undefined;
  const newsDataset = newsReadCurrent?.dataset;
  const newsAdmission = newsDataset && inspectNewsSource(newsDataset);
  const newsSource = newsAdmission?.ok ? newsAdmission.value.source : undefined;
  const newsProblem = news && (newsReadCurrent?.error ?? (newsAdmission && !newsAdmission.ok ? newsAdmission.message : undefined)
    ?? (!newsSource ? 'Loading acquired CompanyNews evidence…' : undefined));
  const acquired = newsSource && acquiredNewsWindow(newsSource);
  const [newsInstrument, setNewsInstrument] = useState(saved?.kind === 'news-sentiment-calendar' ? saved.instrument : undefined);
  const instrument = newsInstrument ?? newsSource?.instrument ?? '';
  const [windowMode, setWindowMode] = useState(saved?.kind === 'news-sentiment-calendar' ? saved.window.mode : 'latest-12-months');
  const savedPins = saved?.kind === 'news-sentiment-calendar' && saved.window.mode === 'pinned' ? saved.window : undefined;
  const [start, setStart] = useState(savedPins?.start);
  const [end, setEnd] = useState(savedPins?.end);
  const defaultWindow = newsSource && resolveNewsWindow(newsSource, { mode: 'latest-12-months' });
  const defaultPins = defaultWindow?.ok ? defaultWindow.value : undefined;
  const pinStart = start ?? defaultPins?.start ?? '';
  const pinEnd = end ?? defaultPins?.end ?? '';
  const emptyAcquisition = (kind === 'dividend-steps' && verifiedEmpty)
    || (news && !!newsSource && newsSource.delivered_count === 0 && !columns.length);
  const fields = editedFields ?? (emptyAcquisition
    ? Object.fromEntries(bindingRoles(kind, metric).filter(role => !role.optional).map(role => [role.key, role.names[0]]))
    : defaults(kind, metric, columns, mode));
  const [symbols, setSymbols] = useState<string[]>(() => saved && 'symbols' in saved ? saved.symbols : saved && 'symbol' in saved ? [saved.symbol] : []);
  const [lookback, setLookback] = useState(String(saved?.kind === 'correlation' ? saved.lookback : 252));
  const [overlap, setOverlap] = useState(String(saved?.kind === 'correlation' ? saved.minOverlap : 60));
  const [bins, setBins] = useState(String(saved?.kind === 'return-distribution' ? saved.bins : 30));
  const singleSymbol = kind === 'monthly-returns' || kind === 'return-distribution';
  const multipleSymbols = kind === 'drawdown' || kind === 'correlation' || kind === 'small-multiples';
  const needsSymbols = singleSymbol || multipleSymbols;
  const roleList = emptyAcquisition ? [] : bindingRoles(kind, metric, mode);
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
  const sourceKind = usesSourceChoices(kind) ? kind : undefined;
  const priceDateField = sourceKind === 'bubble-regression' ? fields.date : undefined;
  const [sourceChoice, setSourceChoice] = useState(() => {
    if (saved?.kind === 'bubble-regression') return saved.priceDate;
    if (saved?.kind === 'dividend-steps') return saved.instrument;
    if (saved?.kind === 'income-sankey') return saved.periodColumn;
  });
  const [regression, setRegression] = useState(saved?.kind !== 'bubble-regression' || saved.regression);
  const [sourceChoices, setSourceChoices] = useState<{ load: LoadSourceChoices; field?: string; values: SourceChoice[]; error?: string }>();
  useEffect(() => {
    if (!sourceKind || !loadSourceChoices || (sourceKind === 'bubble-regression' && !fieldsReady)) return;
    const controller = new AbortController();
    void loadSourceChoices(sourceKind, priceDateField, controller.signal).then(values => {
      if (!controller.signal.aborted) setSourceChoices({ load: loadSourceChoices, field: priceDateField, values });
    }).catch(error => {
      if (!controller.signal.aborted) setSourceChoices({ load: loadSourceChoices, field: priceDateField, values: [],
        error: error instanceof Error ? error.message : String(error) });
    });
    return () => controller.abort();
  }, [sourceKind, loadSourceChoices, priceDateField, fieldsReady]);
  const sourceCurrent = sourceChoices?.load === loadSourceChoices && sourceChoices?.field === priceDateField ? sourceChoices : undefined;
  const sourceValues = sourceCurrent?.values ?? [];
  const value = sourceChoice ?? (sourceKind === 'bubble-regression' ? 'latest' : sourceValues[0]?.value ?? '');
  const choiceLabel = sourceKind && sourceChoiceLabels[sourceKind];
  const latest = sourceKind === 'bubble-regression' && value === 'latest';
  const unavailable = Boolean(value && !latest && !sourceValues.some(choice => choice.value === value));
  const sourceIssue = choiceLabel && (!sourceCurrent ? 'Loading choices from the source…' : sourceCurrent.error
    ?? (latest ? sourceValues[0] : sourceValues.find(choice => choice.value === value))?.issue
    ?? (!sourceValues.length ? choiceLabel.unavailable : unavailable ? 'Repair the unavailable ' + choiceLabel.label.toLowerCase() + '.' : undefined));
  const candidate = kind === 'income-sankey' ? { version: 1, kind, periodColumn: value } : {
    version: 1, kind, fields, ...(kind === 'estimate-range' ? { metric } : {}),
    ...(kind === 'bubble-regression' ? { priceDate: value, regression } : {}),
    ...(kind === 'dividend-steps' ? { instrument: value } : {}),
    ...(news ? { instrument, window: windowMode === 'pinned' ? { mode: windowMode, start: pinStart, end: pinEnd } : { mode: windowMode } } : {}),
    ...(singleSymbol ? { symbol: symbols[0] } : {}),
    ...(multipleSymbols ? { symbols } : {}),
    ...(kind === 'return-distribution' ? { bins: Number(bins) } : {}),
    ...(kind === 'etf-exposure' ? { mode } : {}),
    ...(kind === 'correlation' ? { lookback: Number(lookback), minOverlap: Number(overlap) } : {}) };
  const decoded = decodeRecipeOptions(candidate, kind);
  let newsDraftIssue: string | undefined;
  if (decoded.ok && decoded.options.kind === 'news-sentiment-calendar' && newsDataset && newsSource) {
    const window = resolveNewsWindow(newsSource, decoded.options.window);
    if (!window.ok) newsDraftIssue = window.message;
    else {
      const draft = inspectNewsPresentation(newsDataset, decoded.options);
      if (!draft.ok) newsDraftIssue = draft.message;
    }
  }
  const problem = newsProblem || (fieldIssue ? 'Choose a presented ' + fieldIssue.label.toLowerCase() + ' field.'
    : choiceIssue || sourceIssue || newsDraftIssue || (!decoded.ok && decoded.message));
  const bindingInputs = roleList.map(role => {
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
  });
  return <fieldset disabled={disabled}><legend>{recipeLabels[kind] ?? kind} settings</legend>
    {kind === 'estimate-range' && <label>Metric<select value={metric} onChange={e => {
      const next = e.target.value === 'revenue' ? 'revenue' : 'eps';
      setMetric(next);
      const binding = defaults(kind, next, columns);
      setFields({ ...fields, low: binding.low ?? '', average: binding.average ?? '', high: binding.high ?? '' });
    }}>{(['eps', 'revenue'] as const).map(m => <option key={m} value={m} disabled={!!missingRoles(kind, columns, m).length}>{m === 'eps' ? 'EPS' : 'Revenue'}</option>)}</select></label>}
    {!news && bindingInputs}
    {choiceLabel && <label>{choiceLabel.label}<select value={value} onChange={e => setSourceChoice(e.target.value)}>
      {sourceKind !== 'bubble-regression' && <option value="">{sourceKind === 'dividend-steps' ? 'Choose instrument' : 'Choose period'}</option>}
      {sourceKind === 'bubble-regression' && <option value="latest">Latest</option>}
      {unavailable && <option value={value}>{value}{sourceCurrent && ' (unavailable)'}</option>}
      {sourceValues.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
    </select></label>}
    {news && <>
      <label>Acquired instrument<select value={instrument} onChange={e => setNewsInstrument(e.target.value)}>
        {!instrument && <option value="">Awaiting acquired instrument</option>}
        {instrument && instrument !== newsSource?.instrument && <option value={instrument} disabled>{instrument} (unavailable)</option>}
        {newsSource && <option value={newsSource.instrument}>{newsSource.instrument}</option>}
      </select></label>
      <label>Calendar window<select value={windowMode} onChange={e => setWindowMode(e.target.value === 'pinned' ? 'pinned' : 'latest-12-months')}>
        <option value="latest-12-months">Latest acquired 12 months</option><option value="pinned">Pinned dates</option>
      </select></label>
      {windowMode === 'pinned' && <>
        <label>Start date<input type="date" min={acquired?.start} max={acquired?.end} value={pinStart} onChange={e => setStart(e.target.value)}/></label>
        <label>End date<input type="date" min={acquired?.start} max={acquired?.end} value={pinEnd} onChange={e => setEnd(e.target.value)}/></label>
      </>}
    </>}
    {kind === 'bubble-regression' && <label><input type="checkbox" checked={regression}
      onChange={e => setRegression(e.target.checked)}/>Show regression</label>}
    {singleSymbol && <label>Symbol<select value={symbols[0] ?? ''} onChange={e => setSymbols(e.target.value ? [e.target.value] : [])}>
      <option value="">Choose symbol</option>
      {[...new Set([...symbols, ...(current?.values ?? [])])].map(s => <option key={s} value={s}>{s}</option>)}
    </select></label>}
    {multipleSymbols && <fieldset><legend>Symbols</legend>
      {[...new Set([...symbols, ...(current?.values ?? [])])].map(s => <label key={s}><input type="checkbox" checked={symbols.includes(s)}
        onChange={e => setSymbols(e.target.checked ? [...symbols, s] : symbols.filter(v => v !== s))}/>{s}</label>)}
    </fieldset>}
    {kind === 'return-distribution' && <label>Bins<input type="number" min="5" max="100" step="1" value={bins} onChange={e => setBins(e.target.value)}/></label>}
    {kind === 'etf-exposure' && <label>Exposure mode<select value={mode} onChange={e => {
      const next = e.target.value === 'region' ? 'region' : 'sector';
      setMode(next);
      setFields({ ...fields, category: defaults(kind, metric, columns, next).category ?? '' });
    }}>
      <option value="sector">Sector</option><option value="region">Region</option>
    </select></label>}
    {kind === 'correlation' && <><label>Lookback<input type="number" min="3" value={lookback} onChange={e => setLookback(e.target.value)}/></label>
      <label>Minimum overlap<input type="number" min="3" max={lookback} value={overlap} onChange={e => setOverlap(e.target.value)}/></label></>}
    {news && roleList.length > 0 && <details className="news-calendar-fields">
      <summary>Article fields</summary>
      <div>{bindingInputs}</div>
    </details>}
    {problem && <p role="status">{problem}</p>}
    <button type="button" disabled={!!problem} onClick={() => { if (!problem && decoded.ok) onApply(decoded.options); }}>Apply chart settings</button>
  </fieldset>;
}
