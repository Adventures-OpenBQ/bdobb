// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
export function equivalent(actual: unknown, expected: unknown, path?: string, toleratedColumns?: Set<string> | Map<number, Set<string>>, schema?: 'none' | 'baseline' | 'snapshots'): void;
export function summarize(values: number[]): {median: number; p95: number; observations: number[]};
export function engineOrder(iteration: number): ('typescript' | 'rust')[];
export function toleratedComputedColumns(definition: unknown, columns: unknown[]): Set<string>;
