// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { BUILTIN_BACKEND_ID } from "../lib/builtins";
import type { WidgetDef } from "../lib/types";

export type LibraryFilter = {
  /** A backend id, not a name: Connections allows two backends the same name. */
  backendId: string | null;
  category: string | null;
  subCategory: string | null;
  type: string | null;
  provider: string | null;
};

export const EMPTY_FILTER: LibraryFilter = {
  backendId: null,
  category: null,
  subCategory: null,
  type: null,
  provider: null,
};

/** A backend as the filter needs it. The store's BackendConfig satisfies this. */
export type BackendOption = { id: string; name: string };

/**
 * How a backend id is written on screen, for the filter options and the card
 * pill alike, so the two surfaces cannot label the same backend differently.
 * Builtins are not in Connections and so have no name to look up. A widget
 * whose backend has since been removed keeps its bare id rather than a blank.
 */
export function backendLabel(id: string, backends: BackendOption[]): string {
  if (id === BUILTIN_BACKEND_ID) return "Built-in";
  return backends.find((b) => b.id === id)?.name ?? id;
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
): { backendIds: string[]; categories: string[]; subCategories: string[]; types: string[]; providers: string[] } {
  const inCategory = filter.category
    ? widgets.filter((w) => w.category === filter.category)
    : widgets;
  return {
    // Ids, sorted into display order by the caller, which knows their names.
    backendIds: uniqSorted(widgets.map((w) => w.backendId)),
    categories: uniqSorted(widgets.map((w) => w.category)),
    subCategories: uniqSorted(inCategory.map((w) => w.subCategory)),
    types: uniqSorted(widgets.map((w) => w.type)),
    providers: uniqSorted(widgets.flatMap((w) => w.source)),
  };
}

export function matchesFilter(widget: WidgetDef, filter: LibraryFilter): boolean {
  if (filter.backendId && widget.backendId !== filter.backendId) return false;
  if (filter.category && widget.category !== filter.category) return false;
  if (filter.subCategory && widget.subCategory !== filter.subCategory) return false;
  if (filter.type && widget.type !== filter.type) return false;
  // A multi-source widget matches on any of its sources; a source-less one
  // matches only "All providers".
  if (filter.provider && !widget.source.includes(filter.provider)) return false;
  return true;
}

/** One labelled select with an "All …" first option. The Apps library's
 * Backend filter is this same control. */
export function FilterSelect({
  label,
  allLabel,
  value,
  options,
  labelOf = (o) => o,
  onSelect,
}: {
  label: string;
  allLabel: string;
  value: string | null;
  options: string[];
  labelOf?: (option: string) => string;
  onSelect: (value: string | null) => void;
}) {
  return (
    <label className="library-filter">
      {label}
      <select value={value ?? ""} onChange={(e) => onSelect(e.target.value || null)}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {labelOf(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

type Props = {
  widgets: WidgetDef[];
  /**
   * Connections' backends, for their names alone: the options come from the
   * widgets, so a backend that discovered nothing never becomes an option.
   */
  backends: BackendOption[];
  filter: LibraryFilter;
  onChange: (filter: LibraryFilter) => void;
};

function isEmptyFilter(filter: LibraryFilter): boolean {
  return (Object.keys(EMPTY_FILTER) as (keyof LibraryFilter)[]).every((k) => filter[k] === EMPTY_FILTER[k]);
}

export function LibraryFilters({ widgets, backends, filter, onChange }: Props) {
  const options = filterOptions(widgets, filter);
  // Sorted by label, not by the opaque id the user cannot see.
  const labelOfBackend = (id: string) => backendLabel(id, backends);
  const backendIds = [...options.backendIds].sort((a, b) =>
    labelOfBackend(a).localeCompare(labelOfBackend(b)),
  );

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
        options={backendIds}
        labelOf={labelOfBackend}
        onSelect={(backendId) => onChange({ ...filter, backendId })}
      />
      <FilterSelect
        label="Category"
        allLabel="All categories"
        value={filter.category}
        options={options.categories}
        onSelect={selectCategory}
      />
      <FilterSelect
        label="Subcategory"
        allLabel="All subcategories"
        value={filter.subCategory}
        options={options.subCategories}
        onSelect={(subCategory) => onChange({ ...filter, subCategory })}
      />
      <FilterSelect
        label="Provider"
        allLabel="All providers"
        value={filter.provider}
        options={options.providers}
        onSelect={(provider) => onChange({ ...filter, provider })}
      />
      <FilterSelect
        label="Type"
        allLabel="All types"
        value={filter.type}
        options={options.types}
        onSelect={(type) => onChange({ ...filter, type })}
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
