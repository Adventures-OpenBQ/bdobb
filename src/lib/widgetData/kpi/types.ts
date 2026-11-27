// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { PlotlyFigure } from '../../chartShapes';
import type { MetricObservation, MetricPreset, MetricUnit } from '../chartRecipes/metricEvidence';
import type { RecipeRefusal } from '../chartRecipes/types';

export type LinkedKpiOptions = {
  version: 1;
  metric: MetricPreset;
  valueField: string;
  observation: { mode: 'latest' } | { mode: 'pinned'; id: string };
  view: 'card' | 'gauge';
  range?: { min: number; max: number; label: string };
  reference?: { kind: 'observation'; id: string } | { kind: 'user-target'; value: number };
};

export type KpiReference =
  | { kind: 'observation'; value: number; observation: MetricObservation }
  | { kind: 'user-target'; value: number };

export type KpiSnapshot = {
  value: number;
  label: string;
  unit: MetricUnit;
  issuer: string;
  listing: string;
  shareClass: string | null;
  observation: MetricObservation;
  asOf: string | null;
  retrievedAt: string;
  scope: { acquiredRowCount: number; presentedRowCount: number; filtered: boolean; omittedObservationCount: number };
  deltaAbsolute?: number;
  /** Percent change (100 is a doubling), independently of the acquired metric's unit. */
  deltaPercent?: number;
  referenceLabel?: string;
  reference?: KpiReference;
  range?: NonNullable<LinkedKpiOptions['range']>;
  outOfRange: boolean;
};

export type KpiResult = { ok: true; snapshot: KpiSnapshot; revision: string; notes: string[]; gauge?: PlotlyFigure } | RecipeRefusal;
