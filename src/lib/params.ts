// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { logOnce } from "./logger";
import type {
  DashboardCard,
  FormInput,
  Settings,
  WidgetDef,
  WidgetForm,
  WidgetParam,
} from "./types";

/**
 * The only token this version resolves. The spec's "including offsets" is
 * deferred: it defines no grammar, and no widget in the manifest uses one,
 * so a guessed grammar could not be validated against anything.
 */
export const CURRENT_DATE_TOKEN = "$currentDate";

/**
 * Local time, not UTC: the token means "today" to the person looking at the
 * screen, and a UTC date reads as yesterday for most of the US evening.
 * `en-CA` is the ISO YYYY-MM-DD locale, and toLocaleDateString reads the
 * LOCAL calendar fields, so it is the wall clock the token means.
 */
export function resolveParamValue(value: string, today: Date = new Date()): string {
  if (value === CURRENT_DATE_TOKEN) return today.toLocaleDateString("en-CA");
  if (value.startsWith(CURRENT_DATE_TOKEN)) {
    void logOnce(`param-token:${value}`, `unsupported date token, sent as-is: ${value}`);
  }
  return value;
}

export function resolveParams(
  params: Record<string, string>,
  today: Date = new Date(),
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) out[key] = resolveParamValue(value, today);
  return out;
}

/**
 * A deterministic, order-independent fingerprint of a params object's
 * values. useWidgetData depends on this string rather than on the params
 * object's identity: effectiveParams (src/lib/paramGroups.ts) returns a
 * fresh object on every call, so any upstream identity churn would otherwise
 * refetch even when nothing a request cares about actually changed.
 *
 * Sorting keys before encoding makes {a:"1",b:"2"} and {b:"2",a:"1"} produce
 * the same string. Encoding through JSON.stringify (rather than joining
 * "key:value" pairs by hand) keeps a value's own separator characters from
 * forging a collision with a different split across keys, and keeps a key
 * that is absent distinct from one present with an empty string.
 */
export function paramsKey(params: Record<string, string>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  );
}

export type ControlKind =
  | "select"
  | "endpoint"
  | "multi"
  | "date"
  | "number"
  | "boolean"
  | "text"
  | "tabs"
  | "form"
  | "unsupported";

/**
 * Order is load-bearing, twice over:
 *
 * 1. 21 params in the live manifest declare BOTH `type: "endpoint"` and an
 *    `optionsEndpoint`; classifying by `type` first would land them on a
 *    control kind with no data behind it.
 * 2. `optionsEndpoint` is checked BEFORE static `options`, so static options
 *    on an endpoint param are ignored — the endpoint is authoritative. The
 *    one live case that declares both (Chamber) declares identical content,
 *    so this costs nothing and keeps a single source of truth.
 */
export function controlKind(param: WidgetParam): ControlKind {
  // Both render in the card body rather than in the parameter panel, and both
  // are only usable once they carry what they need: a tabs param is a
  // dropdown at the wire and needs the list to segment, a form needs the
  // endpoint-and-button contract widgetsJson.ts checked. Without it, each is
  // what it has always been — hidden, and named once in the log by the guard
  // immediately below, which is unchanged.
  if (param.type === "tabs" && (param.options?.length ?? 0) > 0) return "tabs";
  if (param.form) return "form";
  if (param.type === "form" || param.type === "tabs") {
    void logOnce(`param-type:${param.type}`, `unsupported param type: ${param.type}`);
    return "unsupported";
  }
  // A multi-select needs a list to select FROM; either source will do.
  if (param.multiSelect === true && (param.optionsEndpoint || (param.options?.length ?? 0) > 0)) {
    return "multi";
  }
  if (param.optionsEndpoint) return "endpoint";
  if (param.options && param.options.length > 0) return "select";
  if (param.type === "date") return "date";
  if (param.type === "number") return "number";
  if (param.type === "boolean") return "boolean";
  return "text";
}

/**
 * Exported so WidgetCard's decision to mount the controls row and the row's
 * own contents can never disagree. Tabs and forms are excluded along with the
 * unsupported: both render in the card body, above the renderer, and a
 * control that is already on screen must not also appear in the header.
 */
export function visibleParams(widget: WidgetDef): WidgetParam[] {
  return widget.params.filter((p) => {
    if (p.show === false) return false;
    const kind = controlKind(p);
    return kind !== "unsupported" && kind !== "tabs" && kind !== "form";
  });
}

/**
 * The params WidgetCard renders in the body rather than in the panel. One
 * function over both kinds so the two lists cannot drift apart on the `show`
 * rule they share.
 */
export function bodyParams(widget: WidgetDef, kind: "tabs" | "form"): WidgetParam[] {
  return widget.params.filter((p) => p.show !== false && controlKind(p) === kind);
}

/**
 * The flat key a form field's value is stored under in `card.params`. Flat and
 * dotted rather than nested so a field persists, exports and groups exactly
 * like every other parameter — DashboardCard.params is Record<string, string>
 * and nothing about it has to learn that forms exist.
 */
export function formFieldKey(formParamName: string, fieldName: string): string {
  return `${formParamName}.${fieldName}`;
}

/**
 * Every params KEY this widget can carry, mapped to the name a ParamGroup
 * binds it by. A declared param maps to itself; a form field stored under
 * `report.symbol` maps to `symbol`, which is what lets a form's `symbol`
 * field join the dashboard's `symbol` group alongside the cards that declare
 * `symbol` directly. The form param itself is absent: it holds no value.
 */
export function bindableKeys(widget: WidgetDef): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of widget.params) {
    if (p.form) {
      for (const f of p.form.inputs) {
        if (f.type !== "button") out.set(formFieldKey(p.paramName, f.paramName), f.paramName);
      }
      continue;
    }
    out.set(p.paramName, p.paramName);
  }
  return out;
}

/**
 * The card's params with every form entry removed — the params that go on the
 * widget's GET. A form is not a query parameter: its fields are card state
 * the user fills in before pressing a button, so leaving them in would put
 * `report.symbol=AAPL` in the query string AND refetch the card on every
 * keystroke (useWidgetData keys its fetch on paramsKey of exactly this
 * object).
 *
 * Returns the SAME object when the widget declares no form, so the memo that
 * feeds useWidgetData keeps its identity for every other card in the app.
 */
export function queryParams(
  widget: WidgetDef,
  params: Record<string, string>,
): Record<string, string> {
  const drop = new Set<string>();
  for (const p of widget.params) {
    if (!p.form) continue;
    drop.add(p.paramName);
    for (const f of p.form.inputs) drop.add(formFieldKey(p.paramName, f.paramName));
  }
  if (drop.size === 0) return params;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!drop.has(key)) out[key] = value;
  }
  return out;
}

/** The control a form field renders as, in controlKind's own vocabulary. */
export function formInputKind(input: FormInput): ControlKind {
  if (input.type === "dropdown") return input.multiSelect === true ? "multi" : "select";
  if (input.type === "number") return "number";
  if (input.type === "date") return "date";
  return "text";
}

/**
 * The JSON body a form submit POSTs. Every non-button field goes under its
 * own bare `paramName` (the `${form}.` prefix is storage, not wire), typed as
 * the field declares it: a multiSelect field as the array its comma-joined
 * storage encodes, a number field as a number — a string would earn a 422
 * from a schema expecting one — and everything else as the string on screen.
 * An empty number is `null` rather than NaN, which JSON cannot carry.
 *
 * The pressed button contributes its own value, or `true` when it declares
 * none: that is how an endpoint with two buttons knows which one was pressed.
 *
 * A number field that is empty, or whose text does not parse to a finite
 * number, is sent as `null` rather than as the `NaN` `Number(raw)` would
 * otherwise produce -- `NaN` is not valid JSON and would silently become
 * `null` on the wire anyway, so this makes that deliberate instead of an
 * accident of serialization.
 *
 * Every value goes through resolveParamValue first, exactly as the query
 * path does (dataClient's postForm resolves the URL params, buildWidgetUrl
 * the GET's): a field whose manifest default is `$currentDate` must POST
 * today's date, not the token, or the endpoint sees a value no schema
 * accepts. Same helper, so the two paths cannot resolve differently.
 */
export function formSubmitBody(
  formParamName: string,
  form: WidgetForm,
  params: Record<string, string>,
  button: FormInput,
  today: Date = new Date(),
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of form.inputs) {
    if (f.type === "button") continue;
    const raw = resolveParamValue(params[formFieldKey(formParamName, f.paramName)] ?? "", today);
    if (f.multiSelect === true) body[f.paramName] = raw === "" ? [] : raw.split(",");
    else if (f.type === "number") {
      const n = Number(raw);
      body[f.paramName] = raw !== "" && Number.isFinite(n) ? n : null;
    } else body[f.paramName] = raw;
  }
  body[button.paramName] = button.value ?? true;
  return body;
}

/**
 * A widget's own default param values, as a plain params object. Used both
 * to seed a new card (dashboardStore) and to probe a provider's key status
 * (providerKeysStore) — the latter only ever selects a widget whose every
 * param already carries a default (see pickProbeWidget), so dropping them
 * would turn a well-formed request into a validation error.
 */
export function seedParams(widget: WidgetDef): Record<string, string> {
  const params: Record<string, string> = {};
  for (const p of widget.params) {
    // A form holds no value of its own; its FIELDS do, each under its flat
    // key, so a new card opens with the defaults the manifest declared.
    if (p.form) {
      for (const f of p.form.inputs) {
        if (f.type === "button") continue;
        if (typeof f.value === "string" && f.value !== "") {
          params[formFieldKey(p.paramName, f.paramName)] = f.value;
        }
      }
      continue;
    }
    if (typeof p.value === "string" && p.value !== "") params[p.paramName] = p.value;
  }
  return params;
}

/**
 * The symbol override to seed a new card's params with, beyond the widget's
 * own defaults: a linked-symbol match against the tab it's being added to
 * (when enabled), falling back to the settings' default ticker. A widget
 * with no `symbol` param is left alone either way -- there is nothing on it
 * to override.
 */
export function resolveSymbolOverride(
  widget: WidgetDef,
  siblingCards: DashboardCard[],
  settings: Settings,
): Record<string, string> {
  if (!widget.params.some((p) => p.paramName === "symbol")) return {};

  if (settings.matchDashboardSymbol) {
    const sibling = [...siblingCards].reverse().find((c) => c.params.symbol);
    if (sibling) return { symbol: sibling.params.symbol };
  }
  if (settings.defaultTicker) return { symbol: settings.defaultTicker };
  return {};
}
