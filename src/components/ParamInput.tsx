// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ControlKind } from "../lib/params";
import type { ParamOption } from "../lib/types";

type Props = {
  id: string;
  kind: ControlKind;
  value: string;
  options?: ParamOption[];
  /**
   * Values to offer beyond `options` — what the parameter panel shows for a
   * stored value its fetched list does not carry. Empty for a form field,
   * whose options are static and therefore always complete.
   */
  unoffered?: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
  /**
   * Focus left a TYPED control — the text/number/date input below and nothing
   * else, which is the only kind any caller supplies this for: WidgetFormPanel
   * commits a typed field on blur rather than on every keystroke, and
   * ParamControls does the same (on blur and on Enter), passing this for
   * exactly those controls. A select or a checkbox commits on change and is
   * never given one, so wiring it there would be a branch no caller reaches.
   */
  onBlur?: () => void;
};

/**
 * The offered options, then any stored value the list does not carry. A value
 * outside the offered set must still be shown honestly rather than silently
 * falling back to the first option, which would desync the display from what
 * the card actually stores (see unofferedValues in ParamControls) — and while
 * a list is still loading EVERY selected member is unoffered, which is what
 * keeps a multi-select showing the card's selection instead of dropping it.
 */
function optionList(options: ParamOption[], unoffered: string[]) {
  return (
    <>
      {/* Keyed by position too: a manifest can repeat a value, and a
          duplicate key makes React drop or reuse the wrong option. */}
      {options.map((o, i) => (
        <option key={`${i}:${o.value}`} value={o.value}>
          {o.label}
        </option>
      ))}
      {unoffered.map((v) => (
        <option key={`unoffered:${v}`} value={v}>
          {v}
        </option>
      ))}
    </>
  );
}

/**
 * One parameter control: the select/multi-select/checkbox/date/number/text
 * input the parameter panel has always rendered, extracted so a widget form
 * renders the SAME controls rather than a second set that could drift from
 * them in styling, in value encoding (a multi-select is comma-joined) or in
 * behaviour.
 *
 * Purely presentational: it owns no draft, fetches nothing and decides
 * nothing about when a value is committed. ParamControls commits a select or
 * a checkbox on change and a typed control on blur or Enter; WidgetFormPanel
 * holds a typed field's draft and commits it on blur. Both are the caller's
 * business.
 */
export function ParamInput({
  id,
  kind,
  value,
  options = [],
  unoffered = [],
  disabled = false,
  onChange,
  onBlur,
}: Props) {
  if (kind === "multi") {
    return (
      <select
        id={id}
        multiple
        disabled={disabled}
        value={value === "" ? [] : value.split(",")}
        onChange={(e) =>
          onChange(
            Array.from(e.target.selectedOptions)
              .map((o) => o.value)
              .join(","),
          )
        }
      >
        {optionList(options, unoffered)}
      </select>
    );
  }

  if (kind === "select" || kind === "endpoint") {
    return (
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {optionList(options, unoffered)}
      </select>
    );
  }

  if (kind === "boolean") {
    return (
      <input
        id={id}
        type="checkbox"
        disabled={disabled}
        checked={value === "true"}
        onChange={(e) => onChange(e.target.checked ? "true" : "false")}
      />
    );
  }

  return (
    <input
      id={id}
      type={kind === "date" ? "date" : kind === "number" ? "number" : "text"}
      disabled={disabled}
      onBlur={onBlur}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
