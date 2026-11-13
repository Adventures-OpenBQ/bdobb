// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { PIN_EDGES } from "./types";
import type { Dashboard, PinEdge } from "./types";

/**
 * Settings ▸ Locked Widgets ▸ See-through where empty, per edge (spec
 * 2026-11-12-see-through-locked-bands). Only `true` is ever stored: an edge
 * that is off has no key, and both off is no field at all, so a docks file
 * or sync record written with the switch off is the one written before it
 * existed.
 */
export type DockSeeThrough = Partial<Record<PinEdge, true>>;

/** Leniently, as a file is read: the edges whose value is exactly `true`, or undefined when there are none. */
export function readDockSeeThrough(v: unknown): DockSeeThrough | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  const out: DockSeeThrough = {};
  for (const edge of PIN_EDGES) if (o[edge] === true) out[edge] = true;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** `d` with `edge` switched on or off; the field goes once no edge is on. */
export function withDockSeeThrough(d: Dashboard, edge: PinEdge, on: boolean): Dashboard {
  const { dockSeeThrough: _previous, ...rest } = d;
  const next = readDockSeeThrough({ ...d.dockSeeThrough, [edge]: on });
  return next ? { ...rest, dockSeeThrough: next } : rest;
}

/**
 * Whether a band with cards, not being edited, floats over the dashboard.
 * A band capped by the window scrolls its own rows, which a band that passes
 * scrolling through cannot also do; a workspace has no one scroll region to
 * give the room to (each tile scrolls its own). Either way the band is the
 * ordinary opaque strip until that changes.
 */
export function bandFloats(o: { seeThrough: boolean; capped: boolean; workspace: boolean }): boolean {
  return o.seeThrough && !o.capped && !o.workspace;
}
