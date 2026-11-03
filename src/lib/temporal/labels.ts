// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/** Human labels for TemporalDB contract enums. Wire values are never rewritten. */
export const TEMPORAL_MODE_LABELS:Record<string,string>={current_corrected:'Current corrected',known_at:'Known at',effective_on:'Effective on',snapshot:'Snapshot'};
export const KNOWLEDGE_BASIS_LABELS:Record<string,string>={local_received:'Local receipt',provider_published:'Provider published'};
export const basisLabel=(basis:string|null|undefined):string=>basis&&basis!=='unspecified'?KNOWLEDGE_BASIS_LABELS[basis]??basis:'Basis unspecified';
