// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout } from '../../chartShapes';
import { escape } from '../figureHelpers';
import { statementRoundingTolerance } from '../statementPrecision';
import type { WidgetDataset } from '../types';
import { doubleUnitExponent, roundedRatio, scaledInteger } from './binary64';
import { resolveIncomeSankeyInput, type IncomeAnchor, type IncomeComponent, type IncomeLineValue, type IncomeSankeyInput } from './incomeSankeyInput';
import type { RecipeContext, RecipeOptions, RecipeRefusal, RecipeResult } from './types';

const anchorLabels = {
  revenue: 'Revenue', gross_profit: 'Gross profit', operating_income: 'Operating income',
  income_before_tax: 'Income before tax', net_income: 'Net income',
} as const satisfies Record<IncomeAnchor, string>;

const stages = [
  { id: 'gross-profit-bridge', from: 'revenue', to: 'gross_profit', label: 'Gross profit bridge',
    component: 'cost_of_revenue', expense: 'Cost of revenue', credit: 'Cost of revenue credit', adjustment: 'Gross profit adjustment' },
  { id: 'operating-income-bridge', from: 'gross_profit', to: 'operating_income', label: 'Operating income bridge',
    expense: 'Net operating deductions', credit: 'Net operating credits' },
  { id: 'pre-tax-income-bridge', from: 'operating_income', to: 'income_before_tax', label: 'Pre-tax income bridge',
    expense: 'Net non-operating expense', credit: 'Net non-operating income' },
  { id: 'tax-bridge', from: 'income_before_tax', to: 'net_income', label: 'Tax reconciliation',
    component: 'income_tax_expense', expense: 'Income tax expense', credit: 'Income tax credit', adjustment: 'Tax reconciliation adjustment' },
] as const satisfies readonly {
  id: string; from: IncomeAnchor; to: IncomeAnchor; label: string;
  component?: IncomeComponent; expense: string; credit: string; adjustment?: string;
}[];

type StageId = (typeof stages)[number]['id'];
type FlowNodeId = 'revenue' | 'net_income' | StageId | `${StageId}-${'component' | 'residual'}`;
type LinkKind = 'anchor' | 'component' | 'residual';
type FlowLink = {
  source: FlowNodeId; target: FlowNodeId; kind: LinkKind; label: string;
  value: number; signedValue: number; line?: IncomeLineValue;
};
type FlowStage = {
  id: StageId; from: IncomeAnchor; to: IncomeAnchor; residual: number;
  throughput: number;
  /** Accepted cancellation difference in original units, measured as outflow minus inflow. */
  rounding: number;
};
type FlowNode = { id: FlowNodeId; label: string; offset: number; value: number; kind: 'main' | 'credit' | 'deduction' };

export type IncomeFlowGraph = {
  ok: true; anchors: IncomeSankeyInput['anchors']; stages: FlowStage[]; links: FlowLink[];
  /** Divide original link values by displayScale to obtain the Plotly values. */
  displayScale: number;
};

const refuse = (message: string): RecipeRefusal => ({ ok: false, refused: true, message });
const overflow = () => refuse('The original statement amounts exceed finite precision for a reconciled income flow.');
const unfaithfulWidth = () => refuse('The income flow amounts differ too much to display each positive width faithfully.');
const labelFor = (field: IncomeAnchor, line: IncomeLineValue) =>
  line.origin.kind === 'calculated' ? `${anchorLabels[field]} (calculated)` : anchorLabels[field];

/** Each bridge receives its original anchor and allocates the next original anchor exactly once. */
export function buildIncomeFlows(input: IncomeSankeyInput): IncomeFlowGraph | RecipeRefusal {
  const { anchors, components } = input;
  const links: FlowLink[] = [];
  const summaries: FlowStage[] = [];
  const view = new DataView(new ArrayBuffer(8));
  const exact = (amount: number) => scaledInteger(amount, view);
  const sourceAmount = (units: bigint) => roundedRatio(units, 1n, doubleUnitExponent);
  const upperBound = exact(Number.MAX_VALUE);
  const wholeUnit = Math.min(1, 1 / input.scale.multiplier);

  const carry = (source: FlowNodeId, target: FlowNodeId, field: IncomeAnchor) => {
    const line = anchors[field];
    if (line.value > 0) links.push({ source, target, kind: 'anchor', label: labelFor(field, line),
      value: line.value, signedValue: line.value, line });
  };
  carry('revenue', stages[0].id, 'revenue');

  for (const [index, stage] of stages.entries()) {
    const a = anchors[stage.from].value;
    const b = anchors[stage.to].value;
    const component = 'component' in stage ? components[stage.component] : undefined;
    const step = -(component?.value ?? 0);
    const gap = exact(b) - exact(a) - exact(step);
    if (gap > upperBound || gap < -upperBound) return overflow();
    const fullResidual = sourceAmount(gap);

    // A pure bridge has only the derived net change. Retain it even if it is small.
    // On component stages never suppress a whole source unit or a whole reporting-currency unit.
    const tolerance = statementRoundingTolerance(b, a + Math.abs(step));
    const withinRounding = (difference: number) => Math.abs(difference) <= tolerance && Math.abs(difference) < wholeUnit;
    const residual = component && withinRounding(fullResidual) ? 0 : fullResidual;

    const branch = (kind: 'component' | 'residual', signedValue: number, label: string, line?: IncomeLineValue) => {
      if (signedValue === 0) return;
      const id = `${stage.id}-${kind}` as const;
      links.push({ kind, source: signedValue > 0 ? id : stage.id, target: signedValue > 0 ? stage.id : id,
        label, value: Math.abs(signedValue), signedValue, line });
    };
    branch('component', step, step > 0 ? stage.credit : stage.expense, component);
    const adjustment = 'adjustment' in stage ? stage.adjustment : residual > 0 ? stage.credit : stage.expense;
    branch('residual', residual, `${adjustment} (derived)`);
    carry(stage.id, stages[index + 1]?.id ?? 'net_income', stage.to);

    const inflow = exact(a) + exact(Math.max(0, step)) + exact(Math.max(0, residual));
    const outflow = exact(b) + exact(Math.max(0, -step)) + exact(Math.max(0, -residual));
    if (inflow > upperBound || outflow > upperBound) return overflow();
    // Compare the exact totals before converting them to binary64. One rounded
    // residual may make the published totals differ by an ULP even when the
    // exact difference is within the same cancellation allowance.
    const rounding = sourceAmount(outflow - inflow);
    if (!withinRounding(rounding)) return unfaithfulWidth();
    summaries.push({ id: stage.id, from: stage.from, to: stage.to, residual,
      throughput: sourceAmount(inflow > outflow ? inflow : outflow), rounding });
  }

  const largest = Math.max(...summaries.map(stage => stage.throughput));
  // A shared binary scale keeps both huge and subnormal inputs away from Plotly's arithmetic limits.
  const displayScale = 2 ** Math.min(1023, Math.max(-1022, Math.floor(Math.log2(largest))));
  if (links.some(({ value }) => value / displayScale * displayScale !== value
    || value / largest < Number.EPSILON)) return unfaithfulWidth();
  return { ok: true, anchors, stages: summaries, links, displayScale };
}

function flowNodes(graph: IncomeFlowGraph): FlowNode[] {
  const endpoint = (id: 'revenue' | 'net_income'): FlowNode =>
    ({ id, label: anchorLabels[id], offset: 0, value: graph.anchors[id].value, kind: 'main' });
  const nodes = [endpoint('revenue')];
  for (const summary of graph.stages) {
    const stage = stages.find(entry => entry.id === summary.id)!;
    const { id, label } = stage;
    const branches = (kind: 'credit' | 'deduction', carry: number) => {
      let offset = carry / graph.displayScale;
      for (const link of graph.links) {
        if (link.kind === 'anchor' || (kind === 'credit' ? link.target !== id : link.source !== id)) continue;
        const value = link.value;
        nodes.push({ id: kind === 'credit' ? link.source : link.target, label: link.label, value, offset, kind });
        offset += value / graph.displayScale;
      }
    };
    branches('credit', graph.anchors[stage.from].value);
    nodes.push({ id, label, value: summary.throughput, offset: 0, kind: 'main' });
    branches('deduction', graph.anchors[stage.to].value);
  }
  nodes.push(endpoint('net_income'));
  return nodes.filter(node => node.value > 0);
}

/** Plotly's left alignment with zero padding sizes all bands from the largest topological layer. */
function plotCapacity(graph: IncomeFlowGraph, nodes: readonly FlowNode[]): number {
  const depths = new Map<FlowNodeId, number>();
  const totals: number[] = [];
  for (const { id, value } of nodes) {
    const incoming = graph.links.filter(link => link.target === id);
    const depth = Math.max(0, ...incoming.map(link => depths.get(link.source)! + 1));
    depths.set(id, depth);
    totals[depth] = (totals[depth] ?? 0) + value / graph.displayScale;
  }
  return Math.max(...totals);
}

const nodeColors = { main: '#4c9aff', credit: '#4aab87', deduction: '#ce7951' } as const;
const linkColors = { main: 'rgba(76,154,255,.46)', credit: 'rgba(74,171,135,.52)', deduction: 'rgba(206,121,81,.51)' } as const;

function periodLabel({ kind, fiscalPeriod, fiscalYear }: IncomeSankeyInput['period']): string {
  return [kind, kind === 'FQ' && fiscalPeriod?.startsWith('Q') ? fiscalPeriod : '', fiscalYear].filter(Boolean).join(' ');
}

function wrapLabel(label: string, limit: number): string {
  const lines: string[] = [];
  for (const word of label.split(' ')) {
    const current = lines.at(-1);
    if (!current || current.length + word.length + 1 > limit) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  return lines.map(escape).join('<br>');
}

export function buildIncomeSankey(dataset: WidgetDataset, options: RecipeOptions, context: RecipeContext): RecipeResult {
  if (options.kind !== 'income-sankey') return refuse('Choose the income Sankey recipe.');
  if (dataset.freshness && dataset.freshness.availability !== 'available')
    return { ok: false, message: dataset.freshness.error ?? 'The income statement acquisition is unavailable. Reload the source table.' };
  const input = resolveIncomeSankeyInput(dataset, options);
  if (!input.ok) return input;
  const graph = buildIncomeFlows(input);
  if (!graph.ok) return graph;

  const { anchors, stages: summaries, links, displayScale } = graph;
  const nodes = flowNodes(graph);
  const capacity = plotCapacity(graph, nodes);
  if (links.some(link => link.value / displayScale / capacity < Number.EPSILON)) return unfaithfulWidth();

  const positions = nodes.map((_, index) => (index + .5) / nodes.length);
  const indices = new Map(nodes.map(({ id }, index) => [id, index]));
  const byStage = new Map(summaries.map(stage => [stage.id, stage]));
  const units = `${input.currency} × ${input.scale.multiplier}`;
  const original = (value: number) => `${value} ${units}`;
  const scope = `${input.issuer} · ${periodLabel(input.period)} ended ${input.period.end} · ${units}`;
  const originLabel = (line: IncomeLineValue) => line.origin.kind === 'reported' ? 'Reported' : 'Calculated';
  const nodeHover = (node: FlowNode) => {
    if (node.id === 'revenue' || node.id === 'net_income') return `${node.label}<br>Reported ${original(node.value)}`;
    const stage = byStage.get(node.id as StageId);
    if (stage) {
      const anchor = anchors[stage.to];
      return `${node.label}<br>${originLabel(anchor)} ${anchorLabels[stage.to]} ${original(anchor.value)}<br>Reconciled throughput ${original(stage.throughput)}`;
    }
    const link = links.find(link => link.kind !== 'anchor' && (link.source === node.id || link.target === node.id))!;
    return linkHover(link);
  };
  function linkHover(link: FlowLink): string {
    const line = link.line;
    return [
      link.label,
      line ? `${originLabel(line)} ${original(line.value)}` : `Derived change ${original(link.signedValue)}`,
      link.kind === 'residual' && /(gross-profit|tax)-bridge/.test(link.source + link.target)
        ? 'Includes adjustments and lines not shown' : '',
    ].filter(Boolean).map(escape).join('<br>');
  }

  const width = Math.max(240, context.viewportWidth ?? 390);
  const narrow = width < 540;
  const graphLeft = .025, graphRight = narrow ? .48 : .62;
  const margin = { l: 10, r: 10, t: 65, b: 9, autoexpand: false };
  const graphHeight = Math.max(4, nodes.length) * 49;
  const graphWidth = (width - margin.l - margin.r) * (graphRight - graphLeft);
  const labelLeft = graphRight + .045;
  const base = themedLayout(context.theme);
  const notes = [
    `${scope}. Original statement values use the declared multiplier of ${input.scale.multiplier}.`,
    Object.entries(anchors).map(([id, line]) => `${labelFor(id as IncomeAnchor, line)} ${original(line.value)}`).join(' · '),
    ...input.notes,
  ];
  for (const stage of stages) {
    const summary = byStage.get(stage.id)!;
    const anchor = anchors[stage.to];
    const branchNotes = links.filter(link => link.kind !== 'anchor' && (link.source === stage.id || link.target === stage.id))
      .map(link => `${link.label} ${link.signedValue > 0 ? '+' : ''}${original(link.signedValue)}`);
    const component = 'component' in stage ? input.components[stage.component] : undefined;
    if (component?.value === 0) branchNotes.unshift(`${stage.expense} ${original(0)}`);
    if (branchNotes.length) notes.push(`${stage.label}. ${branchNotes.join(' · ')}.`);
    if (summary.rounding)
      notes.push(`${stage.label} rounding difference ${original(summary.rounding)} (outflow minus inflow).`);
    if (summary.throughput !== anchor.value)
      notes.push(`${stage.label} throughput ${original(summary.throughput)}. ${originLabel(anchor)} ${anchorLabels[stage.to]} ${original(anchor.value)}.`);
  }
  if (summaries.some(stage => stage.rounding))
    notes.push('Cancellation-sized differences smaller than one source unit and one currency unit are treated as rounding.');

  const trace = {
    type: 'sankey', uid: 'income-sankey', arrangement: 'fixed', orientation: 'v',
    domain: { x: [graphLeft, graphRight], y: [0, 1] },
    textfont: { color: 'rgba(0,0,0,0)', shadow: 'none' },
    node: {
      align: 'left', pad: 0, thickness: 14,
      // Plotly 3.7 scales explicit x/y by domain width/height before applying
      // the vertical SVG transform. Swap the scale factors for this orientation.
      x: positions.map(position => position * graphHeight / graphWidth),
      y: nodes.map(node => (node.offset + node.value / displayScale / 2) / capacity * graphWidth / graphHeight),
      label: nodes.map(node => escape(node.label)),
      color: nodes.map(node => nodeColors[node.kind]),
      customdata: nodes.map(nodeHover), hovertemplate: '%{customdata}<extra></extra>',
    },
    link: {
      source: links.map(link => indices.get(link.source)!),
      target: links.map(link => indices.get(link.target)!),
      value: links.map(link => link.value / displayScale),
      label: links.map(link => escape(link.label)),
      color: links.map(link => linkColors[link.kind === 'anchor' ? 'main' : link.signedValue > 0 ? 'credit' : 'deduction']),
      customdata: links.map(linkHover), hovertemplate: '%{customdata}<extra></extra>',
    },
  };
  return { ok: true, revision: input.revision, notes, figure: { data: [trace], layout: {
    ...base, uirevision: input.revision, width, height: graphHeight + margin.t + margin.b, margin, hovermode: 'closest',
    title: { text: `${escape(input.issuer)} · Income Sankey<br>${escape(periodLabel(input.period))} · ${input.period.end} · ${escape(units)}`,
      x: .025, font: { size: narrow ? 13 : 15 } },
    annotations: nodes.map((node, index) => ({
      xref: 'paper', yref: 'paper', x: labelLeft, y: 1 - positions[index], xanchor: 'left', yanchor: 'middle',
      text: wrapLabel(node.label, narrow ? Math.max(15, Math.floor((width - 20) * (1 - labelLeft) / 7)) : 30),
      font: { size: 12 }, align: 'left', showarrow: false, captureevents: false,
    })),
  } } };
}
