// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo } from "react";
import { BUILTIN_BACKEND_ID } from "../lib/builtins";
import { isOnDashboard, type PresenceIndex } from "../lib/libraryPresence";
import type { WidgetDef } from "../lib/types";

export type LibraryFilter = {
  /** A backend id, not a name: Connections allows two backends the same name. */
  backendId: string | null;
  category: string | null;
  subCategory: string | null;
  type: string | null;
  provider: string | null;
  /** A dashboard id, not a name: two dashboards may share a name. */
  dashboardId: string | null;
};

export const EMPTY_FILTER: LibraryFilter = {
  backendId: null,
  category: null,
  subCategory: null,
  type: null,
  provider: null,
  dashboardId: null,
};

/** A backend as the filter needs it. The store's BackendConfig satisfies this. */
export type BackendOption = { id: string; name: string };

/**
 * How a backend id is written on screen, for the filter options and the card
 * pill alike -- one function so the two surfaces cannot label the same backend
 * differently. Builtins are not in Connections and so have no name to look up.
 * A widget whose backend has since been removed keeps its bare id rather than
 * showing a blank pill: the widget is still in the registry, and saying which
 * vanished backend it came from is more use than saying nothing.
 */
export function backendLabel(id: string, backends: BackendOption[]): string {
  if (id === BUILTIN_BACKEND_ID) return "Built-in";
  return backends.find((b) => b.id === id)?.name ?? id;
}

/** A dashboard as the filter needs it: identity, name, and the folders above it. */
export type DashboardOption = { id: string; name: string; path: string[] };

/** What a <select> needs: the value it reports and the text it shows. */
type Option = { value: string; label: string };

const asOptions = (values: string[]): Option[] => values.map((v) => ({ value: v, label: v }));

/**
 * Every dashboard, in the order given (the rail's). A name that repeats is
 * ambiguous in a list of names alone, so those entries — and only those —
 * carry their folder path: "Macro (Research)". Two same-named dashboards that
 * are both top-level have no path to add and stay bare; the id behind the
 * option still keeps them apart for the filter itself.
 */
export function dashboardOptions(dashboards: DashboardOption[]): Option[] {
  const seen = new Map<string, number>();
  for (const d of dashboards) seen.set(d.name, (seen.get(d.name) ?? 0) + 1);
  return dashboards.map((d) => ({
    value: d.id,
    label:
      (seen.get(d.name) ?? 0) > 1 && d.path.length > 0
        ? `${d.name} (${d.path.join(" / ")})`
        : d.name,
  }));
}

/** Widgets carry "" for an absent subCategory; it must never become an option. */
const uniqSorted = (values: string[]): string[] =>
  [...new Set(values.filter((v) => v !== ""))].sort((a, b) => a.localeCompare(b));


/**
 * Only `subCategories` responds to the current filter, narrowing to the
 * selected category. Narrowing the others too would make options disappear
 * from under the user as they select.
 */
export function filterOptions(
  widgets: WidgetDef[],
  filter: LibraryFilter,
): {
  backendIds: string[];
  categories: string[];
  subCategories: string[];
  types: string[];
  providers: string[];
} {
  const inCategory = filter.category
    ? widgets.filter((w) => w.category === filter.category)
    : widgets;
  return {
    // Ids, sorted into display order by the caller -- which is the only place
    // the names they sort by are known.
    backendIds: uniqSorted(widgets.map((w) => w.backendId)),
    categories: uniqSorted(widgets.map((w) => w.category)),
    subCategories: uniqSorted(inCategory.map((w) => w.subCategory)),
    types: uniqSorted(widgets.map((w) => w.type)),
    providers: uniqSorted(widgets.flatMap((w) => w.source)),
  };
}

/**
 * `presence` is only read for the On-dashboard constraint, but it is
 * required: a caller that forgets it would silently turn that filter into
 * "matches nothing" rather than fail, so the omission has to be a type error.
 * Pass an empty index when no dashboard can be selected. An id no dashboard
 * answers to matches nothing on purpose — the dashboard was deleted while the
 * library stayed open, and pretending the filter is off would silently widen
 * it.
 *
 * It is the INDEX rather than the dashboards themselves because this runs
 * once per widget per keystroke, and because it is the same index the
 * dashboard pills read: the filter and the pills cannot answer "is this
 * widget on that dashboard" differently if there is only one answer.
 */
export function matchesFilter(
  widget: WidgetDef,
  filter: LibraryFilter,
  presence: PresenceIndex,
): boolean {
  if (filter.backendId && widget.backendId !== filter.backendId) return false;
  if (filter.category && widget.category !== filter.category) return false;
  if (filter.subCategory && widget.subCategory !== filter.subCategory) return false;
  if (filter.type && widget.type !== filter.type) return false;
  // A multi-source widget matches on any of its sources; a source-less one
  // matches only "All providers".
  if (filter.provider && !widget.source.includes(filter.provider)) return false;
  if (filter.dashboardId && !isOnDashboard(presence, widget, filter.dashboardId)) return false;
  return true;
}

/** One labelled select with an "All …" first option. The Apps library's
 * Backend filter is this same control. */
export function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onSelect,
}: {
  label: string;
  allLabel: string;
  value: string | null;
  options: Option[];
  onSelect: (value: string | null) => void;
}) {
  return (
    <label className="library-filter">
      {label}
      <select value={value ?? ""} onChange={(e) => onSelect(e.target.value || null)}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

type Props = {
  widgets: WidgetDef[];
  /**
   * Connections' backends, for their names alone -- the options themselves come
   * from the widgets, so a backend that discovered nothing never becomes an
   * option that matches nothing. Builtins are covered without appearing here.
   */
  backends: BackendOption[];
  /**
   * Every dashboard, in rail order — NOT derived from `widgets`: a dashboard
   * carrying nothing this filter shows must stay selectable, and answer with
   * the "no widgets match" state.
   */
  dashboards: DashboardOption[];
  filter: LibraryFilter;
  onChange: (filter: LibraryFilter) => void;
};

function isEmptyFilter(filter: LibraryFilter): boolean {
  return (Object.keys(EMPTY_FILTER) as (keyof LibraryFilter)[]).every((k) => filter[k] === EMPTY_FILTER[k]);
}

export function LibraryFilters({ widgets, backends, dashboards, filter, onChange }: Props) {
  const options = filterOptions(widgets, filter);
  // Memoised on the dashboards alone: this component re-renders on every
  // keystroke in the Library's search box, and none of those keystrokes can
  // change which names repeat.
  const dashboardChoices = useMemo(() => dashboardOptions(dashboards), [dashboards]);
  // Sorted by the label rather than the id: the ids are opaque UUIDs, so
  // sorting them would put the list in an order the user cannot see.
  const backendChoices = options.backendIds
    .map((id) => ({ value: id, label: backendLabel(id, backends) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  function selectCategory(category: string | null) {
    const next: LibraryFilter = { ...filter, category };
    // A category change can strand the selected subcategory on a combination
    // that returns nothing. Clear it in the same update rather than letting
    // the UI reach a state with no possible results.
    const reachable = filterOptions(widgets, next).subCategories;
    if (next.subCategory && !reachable.includes(next.subCategory)) next.subCategory = null;
    onChange(next);
  }

  return (
    <div className="library-filters">
      <FilterSelect
        label="Backend"
        allLabel="All backends"
        value={filter.backendId}
        options={backendChoices}
        onSelect={(backendId) => onChange({ ...filter, backendId })}
      />
      <FilterSelect
        label="Category"
        allLabel="All categories"
        value={filter.category}
        options={asOptions(options.categories)}
        onSelect={selectCategory}
      />
      <FilterSelect
        label="Subcategory"
        allLabel="All subcategories"
        value={filter.subCategory}
        options={asOptions(options.subCategories)}
        onSelect={(subCategory) => onChange({ ...filter, subCategory })}
      />
      <FilterSelect
        label="Provider"
        allLabel="All providers"
        value={filter.provider}
        options={asOptions(options.providers)}
        onSelect={(provider) => onChange({ ...filter, provider })}
      />
      <FilterSelect
        label="Type"
        allLabel="All types"
        value={filter.type}
        options={asOptions(options.types)}
        onSelect={(type) => onChange({ ...filter, type })}
      />
      <FilterSelect
        label="On dashboard"
        allLabel="Any"
        value={filter.dashboardId}
        options={dashboardChoices}
        onSelect={(dashboardId) => onChange({ ...filter, dashboardId })}
      />
      <button
        type="button"
        className="library-filter-reset"
        disabled={isEmptyFilter(filter)}
        aria-label="Reset filters"
        onClick={() => onChange(EMPTY_FILTER)}
      >
        Reset
      </button>
    </div>
  );
}
