// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ControlKind } from "../lib/params";
// PF10: a single `import type … from "../lib/types"` line for this file — Granularity merged in here.
import type { Granularity, ParamOption } from "../lib/types";
import { DatetimePicker } from "./pickers/DatetimePicker";
import type { RelativeContext } from "./pickers/RelativeTab";
import { DayPicker } from "./pickers/DayPicker";
import { FiscalYearPicker } from "./pickers/FiscalYearPicker";
import { QuarterPicker } from "./pickers/QuarterPicker";
import { QuarterRangePicker } from "./pickers/QuarterRangePicker";
import { RangePicker } from "./pickers/RangePicker";
import { TimePicker } from "./pickers/TimePicker";
import { WeekPicker } from "./pickers/WeekPicker";

type Props = {
  id: string;
  kind: ControlKind;
  value: string;
  /**
   * The param's label. A native input is named by ParamControls' `<label
   * htmlFor>`; a React Aria control has no single element for that to point
   * at, so it is named through aria-label instead — which is why this is
   * here. Absent for the native kinds, where it is unused.
   */
  label?: string;
  options?: ParamOption[];
  /**
   * Values to offer beyond `options` — what the parameter panel shows for a
   * stored value its fetched list does not carry. Empty for a form field,
   * whose options are static and therefore always complete.
   */
  unoffered?: string[];
  disabled?: boolean;
  /**
   * The form panel's date fields stay native `<input type="date">`s (design
   * §1: forms are untouched); the header row's become the React Aria day
   * picker. Only the form passes this.
   */
  native?: boolean;
  /** This control's resolved year-end month, for the quarter / fiscal-year kinds. */
  fiscalYearEnd?: number;
  /** A datetime's field depth; the wire is always to the second. */
  granularity?: Granularity;
  /** The Relative tab's context for a period control (v5.3.0); absent for a form's native field. */
  relative?: RelativeContext;
  /** The STORED value, which may be an expression; `value` is what the control shows. */
  stored?: string;
  /**
   * v5.4.x: what the shown value RESOLVES to, for the controls that read it
   * beneath the box (the day picker). The caller resolves; this component
   * only places it.
   */
  resolved?: string;
  /** The day picker's Apply: an expression committed at once, unlike its drafted wire dates. */
  onExpression?: (expr: string) => void;
  onChange: (value: string) => void;
  /**
   * Focus left a TYPED control — the text/number/date input below, or the day
   * picker or time field described last, the only kinds any caller supplies
   * this for: WidgetFormPanel commits a typed field on blur rather than on
   * every keystroke, and ParamControls does the same (on blur and on Enter),
   * passing this for exactly those controls. A select or a checkbox commits on change and is
   * never given one, so wiring it there would be a branch no caller reaches.
   *
   * The React Aria day picker and time field are typed controls too: each
   * reports this when focus leaves the WHOLE control (focus-within, not one
   * segment), and the day picker also reports its calendar closing as a
   * blur, since a pick there is a finished edit.
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
 * Seven kinds are React Aria controls rather than native inputs: the day
 * picker (`date`, outside a form) and the time field inline, and the
 * datetime, range, quarter, fiscal-year and week popovers behind a trigger.
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
  label,
  options = [],
  unoffered = [],
  disabled = false,
  native = false,
  fiscalYearEnd,
  granularity,
  relative,
  stored,
  resolved,
  onExpression,
  onChange,
  onBlur,
}: Props) {
  if (kind === "multi" || kind === "select" || kind === "endpoint") {
    const multi = kind === "multi";
    return (
      <select
        id={id}
        multiple={multi}
        disabled={disabled}
        value={multi ? (value === "" ? [] : value.split(",")) : value}
        onChange={(e) =>
          onChange(
            multi
              ? Array.from(e.target.selectedOptions)
                  .map((o) => o.value)
                  .join(",")
              : e.target.value,
          )
        }
      >
        {optionList(options, unoffered)}
      </select>
    );
  }

  // v5.4.0 (spec §4.7): a text field whose options are the native datalist's
  // suggestions; any typed value is accepted, a multiSelect as `a,b`.
  if (kind === "suggest") {
    return (
      <>
        <input id={id} type="text" list={`${id}-options`} disabled={disabled} onBlur={onBlur} value={value} onChange={(e) => onChange(e.target.value)} />
        <datalist id={`${id}-options`}>{optionList(options, [])}</datalist>
      </>
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

  const name = label ?? id;

  if (kind === "date" && !native) {
    return (
      <DayPicker
        label={name}
        // `value` is what the box SHOWS -- the caller's draft, else the
        // stored text -- so an expression stays readable and editable.
        // `resolved` is what it currently means, read beneath the box.
        value={value}
        resolved={resolved}
        disabled={disabled}
        onChange={onChange}
        onBlur={onBlur}
        relative={relative}
        stored={stored}
        onExpression={onExpression}
      />
    );
  }
  if (kind === "time") {
    return <TimePicker label={name} value={value} disabled={disabled} onChange={onChange} onBlur={onBlur} />;
  }
  if (kind === "datetime") {
    return <DatetimePicker label={name} value={value} granularity={granularity} disabled={disabled} onChange={onChange} relative={relative} stored={stored} />;
  }
  if (kind === "range") {
    return <RangePicker label={name} value={value} disabled={disabled} onChange={onChange} relative={relative} stored={stored} />;
  }
  if (kind === "quarter") {
    return <QuarterPicker label={name} value={value} fiscalYearEnd={fiscalYearEnd} disabled={disabled} onChange={onChange} relative={relative} stored={stored} />;
  }
  if (kind === "quarterRange") {
    return <QuarterRangePicker label={name} value={value} fiscalYearEnd={fiscalYearEnd} disabled={disabled} onChange={onChange} relative={relative} stored={stored} />;
  }
  if (kind === "fiscalYear") {
    return <FiscalYearPicker label={name} value={value} fiscalYearEnd={fiscalYearEnd} disabled={disabled} onChange={onChange} relative={relative} stored={stored} />;
  }
  if (kind === "week") {
    return <WeekPicker label={name} value={value} disabled={disabled} onChange={onChange} relative={relative} stored={stored} />;
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
