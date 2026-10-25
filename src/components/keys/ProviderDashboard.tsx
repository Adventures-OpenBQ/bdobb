// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo } from "react";
import type { KeysRow } from "../renderers/KeysRenderer";
import {
  CREDENTIAL_LABEL,
  deriveProvider,
  filterProviders,
  sortProviders,
  summarize,
  TILE_LABELS,
  type Filter,
  type Provider,
  type Sort,
  type View,
} from "../../lib/providerAvailability";
import { usageCardLine } from "../../lib/providerUsage";

type ProviderDashboardProps = {
  rows: KeysRow[];
  view: View;
  onViewChange: (v: View) => void;
  onProbe: () => void;
  onOpenDetails: (provider: Provider) => void;
};

/**
 * The Provider keys body: fixed summary tiles and toolbar, then a scrolling
 * grid of provider cards (spec §4). Purely presentational — it derives Provider
 * shapes from the rows it is handed and never contacts a vendor. onProbe is only
 * the Check-all button; onOpenDetails is only a card's Details button; the tiles,
 * the All button and the Sort select only call onViewChange. Counts always come
 * from the full derived set, never from the filtered view.
 */
export function ProviderDashboard({ rows, view, onViewChange, onProbe, onOpenDetails }: ProviderDashboardProps) {
  const providers = useMemo(() => rows.map(deriveProvider), [rows]);
  const counts = useMemo(() => summarize(providers), [providers]);
  const shown = useMemo(
    () => sortProviders(filterProviders(providers, view.filter), view.sort),
    [providers, view.filter, view.sort],
  );
  // The fifth "No key required" tile exists only when key-maint has told us a
  // requirement for at least one row; absent `auth` everywhere means today's
  // key-maint, and the tile stays hidden rather than reading a false 0.
  const showKeyless = rows.some((r) => r.auth !== undefined);
  const tiles = TILE_LABELS.filter(([key]) => key !== "none_required" || showKeyless);
  const filterLabel = TILE_LABELS.find(([key]) => key === view.filter)?.[1];

  const choose = (key: Filter) => onViewChange({ filter: view.filter === key ? "all" : key, sort: view.sort });

  return (
    <div className="bd-provider">
      <div className="bd-provider-heading">
        <div>
          <h3>Provider availability</h3>
          <p className="bd-muted">Select a summary below to filter your providers.</p>
        </div>
        <button type="button" className="bd-button" aria-label="Check all providers" onClick={onProbe}>
          Check all
        </button>
      </div>
      <div className="bd-provider-summary" role="group" aria-label="Filter providers by status or key requirement">
        {tiles.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="bd-provider-stat"
            data-tone={key}
            aria-pressed={view.filter === key}
            aria-controls="provider-results"
            onClick={() => choose(key)}
          >
            <div className="bd-provider-stat-top">
              <strong>{counts[key === "none_required" ? "none_required" : (key as Exclude<Filter, "all">)]}</strong>
              <span>{view.filter === key ? "Selected" : "Filter"}</span>
            </div>
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="bd-provider-toolbar">
        <button
          type="button"
          className="bd-button bd-button--ghost"
          aria-controls="provider-results"
          aria-pressed={view.filter === "all"}
          onClick={() => onViewChange({ filter: "all", sort: view.sort })}
        >
          {`All providers (${providers.length})`}
        </button>
        <span className="bd-muted bd-provider-result-count" role="status">
          {`${shown.length} of ${providers.length}${filterLabel !== undefined ? ` · ${filterLabel}` : ""}`}
        </span>
        <div className="bd-provider-sort">
          <label htmlFor="provider-sort">Sort</label>
          <select
            id="provider-sort"
            className="bd-input"
            value={view.sort}
            onChange={(e) => onViewChange({ filter: view.filter, sort: e.target.value as Sort })}
          >
            <option value="name-asc">Name: A to Z</option>
            <option value="name-desc">Name: Z to A</option>
            <option value="available-first">Available first</option>
            <option value="attention-first">Needs attention first</option>
          </select>
        </div>
      </div>
      <div className="bd-provider-scroll">
        <ul className="bd-provider-grid" id="provider-results">
          {shown.map((p) => (
            <li key={p.id} className="bd-provider-card">
              <div className="bd-provider-card-top">
                <h4>{p.name}</h4>
                <span className="bd-provider-state" data-tone={p.category}>
                  {p.statusLabel}
                </span>
              </div>
              <p className="bd-muted">{`Credential: ${CREDENTIAL_LABEL[p.credential]}`}</p>
              {p.usage !== undefined ? <p className="bd-muted">{usageCardLine(p.usage)}</p> : null}
              <div className="bd-provider-card-bottom">
                <span className="bd-muted">{p.explanation}</span>
                <button
                  type="button"
                  className="bd-button bd-button--ghost"
                  aria-label={`Details for ${p.name}`}
                  onClick={() => onOpenDetails(p)}
                >
                  Details
                </button>
              </div>
            </li>
          ))}
        </ul>
        {shown.length === 0 ? (
          <p className="bd-empty" role="status">
            No providers match this status. Select All providers to clear the filter.
          </p>
        ) : null}
        {showKeyless ? (
          <p className="bd-muted bd-provider-footnote">
            &lsquo;No key required&rsquo; overlaps the availability statuses; its count is not part of the totals.
            Availability reflects the last test, which is not a guarantee.
          </p>
        ) : null}
      </div>
    </div>
  );
}
