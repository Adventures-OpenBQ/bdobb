// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { WidgetParam } from "../lib/types";

type Props = {
  param: WidgetParam;
  /** The card's current value for this param. */
  value: string;
  /** Commit the selected option. The same edit path as any other parameter. */
  onSelect: (value: string) => void;
};

/**
 * A `type: "tabs"` param, as a segmented control in the card body.
 *
 * At the wire this param is a dropdown — the selected option's value is sent
 * as `?paramName=value` and nothing else about the request differs — so there
 * is no state here and no fetch: selecting commits through the card's
 * ordinary param edit path, which is what makes grouping and persistence
 * apply to a tab exactly as they apply to a select.
 *
 * A value the manifest does not offer selects nothing rather than silently
 * highlighting the first tab: the card would otherwise claim to be showing
 * something it is not.
 */
export function WidgetTabs({ param, value, onSelect }: Props) {
  return (
    <div className="widget-tabs" role="tablist" aria-label={param.label ?? param.paramName}>
      {(param.options ?? []).map((o, i) => (
        <button
          // Position too, as ParamInput's options: a manifest can repeat a value.
          key={`${i}:${o.value}`}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onSelect(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
