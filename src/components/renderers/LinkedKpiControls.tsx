// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { MetricPreset } from '../../lib/widgetData/chartRecipes/metricEvidence';
import { kpiFields, kpiObservationChoices, kpiUnitLabel, type kpiSourceChoices } from '../../lib/widgetData/kpi/bindings';
import { decodeLinkedKpiOptions, KPI_METRIC_LABELS } from '../../lib/widgetData/kpi/settings';
import type { LinkedKpiOptions } from '../../lib/widgetData/kpi/types';
import type { DatasetColumn } from '../../lib/widgetData/types';

type Draft = {
  metric: MetricPreset | '';
  valueField: string;
  observation: LinkedKpiOptions['observation'];
  view: LinkedKpiOptions['view'];
  useRange: boolean;
  min: string;
  max: string;
  label: string;
  reference: 'none' | 'observation' | 'user-target';
  referenceId: string;
  target: string;
};

export function kpiDraft(options?: LinkedKpiOptions): Draft {
  return {
    metric: options?.metric ?? '', valueField: options?.valueField ?? '',
    observation: options?.observation ?? { mode: 'latest' }, view: options?.view ?? 'card',
    useRange: !!options?.range, min: options?.range ? String(options.range.min) : '',
    max: options?.range ? String(options.range.max) : '', label: options?.range?.label ?? '',
    reference: options?.reference?.kind ?? 'none',
    referenceId: options?.reference?.kind === 'observation' ? options.reference.id : '',
    target: options?.reference?.kind === 'user-target' ? String(options.reference.value) : '',
  };
}

const inputNumber = (value: string) => value.trim() ? Number(value) : NaN;

export function decodeKpiDraft(draft: Draft) {
  return decodeLinkedKpiOptions({
    version: 1, metric: draft.metric, valueField: draft.valueField, observation: draft.observation, view: draft.view,
    ...(draft.useRange && { range: { min: inputNumber(draft.min), max: inputNumber(draft.max), label: draft.label } }),
    ...(draft.reference === 'observation' && { reference: { kind: 'observation', id: draft.referenceId } }),
    ...(draft.reference === 'user-target' && { reference: { kind: 'user-target', value: inputNumber(draft.target) } }),
  });
}

type Props = {
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  columns: readonly DatasetColumn[];
  choices: ReturnType<typeof kpiSourceChoices>;
  canApply: boolean;
  saving: boolean;
  message?: string;
  onSubmit: (event: FormEvent) => void;
};

export function LinkedKpiControls({ draft, setDraft, columns, choices, canApply, saving, message, onSubmit }: Props) {
  const update = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  const fields = kpiFields(columns, draft.metric);
  const observations = kpiObservationChoices(choices, draft.metric);
  const available = observations.filter(observation => !choices?.omitted.has(observation.observation_id));
  const selected = draft.observation.mode === 'pinned' ? draft.observation.id : '@latest';
  const missingPin = selected !== '@latest' && !observations.some(observation => observation.observation_id === selected);
  const currencies = new Set(observations.map(observation => kpiUnitLabel(observation.unit)));
  const pinned = observations.find(observation => observation.observation_id === selected);
  const unit = pinned ? kpiUnitLabel(pinned.unit) : currencies.size === 1 ? [...currencies][0] : undefined;
  const canCompare = choices?.source.origin === 'acquired-snapshot' && available.length > 1;
  const observationLabel = (observation: typeof observations[number]) =>
    [observation.observation_id, observation.vintage, kpiUnitLabel(observation.unit)].join(' · ');

  function selectMetric(metric: MetricPreset | '') {
    const fields = kpiFields(columns, metric);
    setDraft({ ...kpiDraft(), metric, valueField: fields.length === 1 ? fields[0].id : '' });
  }

  return <form className="linked-kpi-controls" noValidate onSubmit={onSubmit}>
    <fieldset disabled={saving}>
      <label>KPI preset
        <select aria-label="KPI preset" value={draft.metric} onChange={event => selectMetric(event.target.value as Draft['metric'])}>
          <option value="">Choose a KPI preset</option>
          {(Object.keys(KPI_METRIC_LABELS) as MetricPreset[]).map(metric => <option key={metric} value={metric}
            disabled={!choices?.source.metrics[metric]}>{KPI_METRIC_LABELS[metric]}</option>)}
        </select>
      </label>
      <label>Original numeric field
        <select aria-label="Original numeric field" value={draft.valueField} onChange={event => update({ valueField: event.target.value })}>
          <option value="">Choose an original field</option>
          {draft.valueField && !fields.some(column => column.id === draft.valueField)
            ? <option value={draft.valueField} disabled>{draft.valueField} (unavailable)</option> : null}
          {fields.map(column => <option key={column.id} value={column.id}>{column.label ?? column.id}</option>)}
        </select>
      </label>
      <label>Observation
        <select aria-label="Observation" value={selected} onChange={event => update({ observation: event.target.value === '@latest'
          ? { mode: 'latest' } : { mode: 'pinned', id: event.target.value } })}>
          <option value="@latest">Follow latest acquired</option>
          {missingPin ? <option value={selected} disabled>{selected} (unavailable)</option> : null}
          {observations.map(observation => <option key={observation.observation_id} value={observation.observation_id}
            disabled={choices?.omitted.has(observation.observation_id)}>{observationLabel(observation)}</option>)}
        </select>
      </label>
      <label>KPI view
        <select aria-label="KPI view" value={draft.view} onChange={event => update(event.target.value === 'gauge' ? { view: 'gauge', useRange: true } : { view: 'card' })}>
          <option value="card">Card</option>
          <option value="gauge">Gauge</option>
        </select>
      </label>
      {draft.view === 'card' ? <label className="linked-kpi-checkbox">
        <input type="checkbox" checked={draft.useRange} onChange={event => update({ useRange: event.target.checked })}/> Use a range
      </label> : null}
      {draft.useRange ? <>
        <label>Range minimum<input type="number" step="any" value={draft.min} onChange={event => update({ min: event.target.value })}/></label>
        <label>Range maximum<input type="number" step="any" value={draft.max} onChange={event => update({ max: event.target.value })}/></label>
        <label>User range label<input maxLength={120} value={draft.label} onChange={event => update({ label: event.target.value })}/></label>
      </> : null}
      <label>Reference
        <select aria-label="Reference" value={draft.reference} onChange={event => update({ reference: event.target.value as Draft['reference'] })}>
          <option value="none">None</option>
          <option value="user-target">User target (assumption)</option>
          <option value="observation" disabled={!canCompare}>Acquired observation</option>
        </select>
      </label>
      {draft.reference === 'user-target'
        ? <label>User target<input type="number" step="any" value={draft.target} onChange={event => update({ target: event.target.value })}/></label> : null}
      {draft.reference === 'observation' ? <label>Reference observation
        <select aria-label="Reference observation" value={draft.referenceId} onChange={event => update({ referenceId: event.target.value })}>
          <option value="">Choose a reference observation</option>
          {draft.referenceId && !observations.some(observation => observation.observation_id === draft.referenceId)
            ? <option value={draft.referenceId} disabled>{draft.referenceId} (unavailable)</option> : null}
          {observations.map(observation => <option key={observation.observation_id} value={observation.observation_id}
            disabled={observation.observation_id === selected || choices?.omitted.has(observation.observation_id)}>
            {observationLabel(observation)}
          </option>)}
        </select>
      </label> : null}
    </fieldset>
    {draft.useRange || draft.reference === 'user-target' ? <p>Enter assumptions in {unit ?? 'the selected observation’s acquired units'}.</p> : null}
    {message ? <p role="status">{message}</p> : null}
    <button type="submit" className="bd-button bd-button--primary" disabled={!canApply || saving}>{saving ? 'Saving KPI settings…' : 'Apply KPI settings'}</button>
  </form>;
}
