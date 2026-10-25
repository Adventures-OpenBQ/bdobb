// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { calendarSpelling } from "./calendars/catalogue";
import { isRangeType } from "./dateExpressions";
import { asRecord, isRecord } from "./isRecord";
import { toAggregationHint } from "./aggregationHint";
import { safeUrl } from "./safeUrl";
import { logOnce } from "./logger";
import { parseFyEndMonth } from "./periods";
import { AGG_NAMES, BUCKETS, UDF_COLOR_KEYS } from "./types";
import type {
  CandleColors,
  ColumnFormatterFn,
  ColumnSpec,
  FiscalFields,
  FormInput,
  Granularity,
  ParamOption,
  PivotConfig,
  SettingsUi,
  TableSpec,
  UdfChartSpec,
  WidgetDef,
  WidgetForm,
  WidgetParam,
} from "./types";

const DEFAULT_GRID = { w: 20, h: 9 };

function toStringArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

/**
 * A number is stringified exactly as `param.value` already is (see toParam):
 * the query string is a string either way, and a static `value: 2026` must
 * normalise the same as a fetched one. An option with a label and NO value at
 * all — the live `{ "label": "All Years" }` — becomes `""`, which
 * buildWidgetUrl already omits from the query string. Anything else (null, a
 * boolean, an object) has no sensible query-string form: null means "no
 * usable value", not "send nothing".
 */
function optionValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value === undefined) return "";
  return null;
}

/**
 * Exported because fetched option lists (dataClient's fetchParamOptions) go
 * through it too — one normaliser, so a value cannot mean different things
 * depending on where the list came from. `extraInfo`, which fetched options
 * carry, is ignored.
 */
export function toOptions(value: unknown): ParamOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options: ParamOption[] = [];
  for (const entry of value) {
    const o = asRecord(entry);
    if (!o || typeof o.label !== "string") continue;
    const v = optionValue(o.value);
    if (v === null) continue;
    options.push({ label: o.label, value: v });
  }
  return options.length > 0 ? options : undefined;
}

function toOptionsParams(value: unknown): Record<string, string | number | boolean> | undefined {
  const r = asRecord(value);
  if (!r) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Exactly the field types widget-parameters/input-form documents. */
const FORM_INPUT_TYPES = new Set(["text", "number", "date", "dropdown", "button"]);

/**
 * One `inputParams` entry, with toParam's discipline: an entry that names no
 * field, declares a type the reference does not document, is a `dropdown`
 * with no options, is a `multiSelect` with nothing to select from, or is a
 * `button` with no label to press, describes no usable control and is
 * dropped. What survives is always renderable, never half-typed.
 */
function toFormInput(f: Record<string, unknown>): FormInput | null {
  if (typeof f.paramName !== "string") return null;
  if (typeof f.type !== "string" || !FORM_INPUT_TYPES.has(f.type)) return null;
  const options = toOptions(f.options);
  if (f.type === "dropdown" && !options) return null;
  // multiSelect means "pick several FROM a list"; without one there is
  // nothing to pick, exactly as controlKind already refuses for a WidgetParam.
  if (f.multiSelect === true && !options) return null;
  const input: FormInput = { paramName: f.paramName, type: f.type as FormInput["type"] };
  if (typeof f.label === "string") input.label = f.label;
  if (f.type === "button" && input.label === undefined) return null;
  // Stringified exactly as WidgetParam.value is: the control is a string
  // control either way, and formSubmitBody re-types it for the POST.
  if (typeof f.value === "string" || typeof f.value === "number" || typeof f.value === "boolean") {
    input.value = String(f.value);
  }
  if (typeof f.description === "string") input.description = f.description;
  if (f.multiSelect === true) input.multiSelect = true;
  if (options) input.options = options;
  return input;
}

/**
 * `type: "form"`. A form with no `endpoint` has nowhere to POST, and a form
 * with no surviving `button` has no way to be submitted; either way there is
 * nothing worth rendering, so the whole form is dropped and controlKind
 * reports the param "unsupported" — hidden and logged once, which is what
 * this param type already did.
 */
function toForm(p: Record<string, unknown>): WidgetForm | undefined {
  if (p.type !== "form") return undefined;
  if (typeof p.endpoint !== "string" || p.endpoint === "") return undefined;
  if (!Array.isArray(p.inputParams)) return undefined;
  const seen = new Set<string>();
  const inputs = p.inputParams
    .filter(isRecord)
    .map(toFormInput)
    .filter((f): f is FormInput => f !== null)
    // A later field sharing an earlier one's paramName would collide under
    // the same formFieldKey; keep the first and drop the rest.
    .filter((f) => (seen.has(f.paramName) ? false : (seen.add(f.paramName), true)));
  if (!inputs.some((f) => f.type === "button")) return undefined;
  return { endpoint: p.endpoint, inputs };
}

/**
 * The fiscal fields, on a param or (v5.4.0) on a widget. OpenBB's
 * `fiscal_year_start_month` is the same fact from the other end — the year
 * ends the month before it starts (7 → June, 1 → December) — and an explicit
 * `fiscalYearEnd` wins, which is exactly the chain's order (spec §4.4). So it
 * is folded into `fiscalYearEnd` here and nothing downstream knows it
 * existed. Anything but an integer 1–12 is ignored, with one log line.
 */
function fiscalFields(raw: Record<string, unknown>, where: string): FiscalFields {
  const out: FiscalFields = {};
  const end = parseFyEndMonth(raw.fiscalYearEnd);
  const start = raw.fiscal_year_start_month;
  if (end !== undefined) out.fiscalYearEnd = end;
  else if (typeof start === "number" && Number.isInteger(start) && start >= 1 && start <= 12) {
    out.fiscalYearEnd = start === 1 ? 12 : start - 1;
  }
  // Validate fiscal_year_start_month independently and log if invalid, regardless
  // of whether fiscalYearEnd answered.
  if (start !== undefined && !(typeof start === "number" && Number.isInteger(start) && start >= 1 && start <= 12)) {
    void logOnce(`fiscal-start:${where}`, `ignored fiscal_year_start_month ${JSON.stringify(start)} on ${where}: not an integer 1-12`);
  }
  if (typeof raw.fiscalYearEndParam === "string" && raw.fiscalYearEndParam !== "") out.fiscalYearEndParam = raw.fiscalYearEndParam;
  if (typeof raw.fiscalYearEndEndpoint === "string" && raw.fiscalYearEndEndpoint !== "") {
    out.fiscalYearEndEndpoint = raw.fiscalYearEndEndpoint;
  }
  return out;
}

/**
 * A param value as the one string a card's params and the query string carry:
 * a scalar stringified, a list of scalars comma-joined -- the same convention
 * a multi-select control writes (formSubmitBody splits on ","). Anything else
 * (null, an object, a list holding one, an empty list) has no such form and
 * is undefined, so an empty saved selection never overrides a default.
 * Shared with appsJson, whose saved card params use the same shapes.
 */
export function paramString(value: unknown): string | undefined {
  const scalar = (v: unknown) => typeof v === "string" || typeof v === "number" || typeof v === "boolean";
  if (scalar(value)) return String(value);
  if (Array.isArray(value) && value.length > 0 && value.every(scalar)) return value.join(",");
  return undefined;
}

/** Copies each of `keys` from `from` onto `to` when its value is of type `kind`. */
function copyTyped<T>(to: T, from: Record<string, unknown>, kind: "string" | "boolean" | "number", keys: readonly (keyof T & string)[]): void {
  for (const k of keys) if (typeof from[k] === kind) (to as Record<string, unknown>)[k] = from[k];
}

function toParam(p: Record<string, unknown>): WidgetParam | null {
  if (typeof p.paramName !== "string") return null;
  const param: WidgetParam = { paramName: p.paramName };
  copyTyped(param, p, "string", ["label", "type", "description", "optionsEndpoint"]);
  copyTyped(param, p, "boolean", ["show", "optional", "multiSelect"]);
  // The reference types value as string | number | boolean, and openbb-api
  // emits booleans (hidden chart=true) and numbers (limit). The query string
  // is a string either way, so stringify here and keep WidgetParam.value flat.
  const value = paramString(p.value);
  if (value !== undefined) param.value = value;
  // v5.4.0 (spec §4.9): a range default written as OpenBB's `{start, end}`
  // object is the composite `start/end` every range stores.
  const range = p.type === "date_range" || p.type === "quarter_range" ? asRecord(p.value) : null;
  if (range && typeof range.start === "string" && typeof range.end === "string") {
    param.value = `${range.start}/${range.end}`;
  }
  const options = toOptions(p.options);
  if (options) param.options = options;
  const optionsParams = toOptionsParams(p.optionsParams);
  if (optionsParams) param.optionsParams = optionsParams;
  // Not an OpenBB field; the built-ins declare it and a backend may. Anything
  // but a string is dropped rather than coerced, like every field here.
  if (typeof p.groupType === "string" && p.groupType !== "") param.groupType = p.groupType;
  // The v5.2.0 period fields. Each is checked for its documented shape and
  // otherwise left absent; the type it belongs on is the control's business,
  // not the parser's, so a `granularity` on a `date` is kept and ignored.
  // v5.4.0 (spec §4.6): OpenBB's full list. Display only — the wire stays ISO
  // 8601 to the second whatever the field shows.
  const GRANULARITIES: readonly Granularity[] = ["year", "month", "day", "hour", "minute", "second"];
  if (GRANULARITIES.includes(p.granularity as Granularity)) param.granularity = p.granularity as Granularity;
  if (typeof p.rangeEnd === "string" && p.rangeEnd !== "") param.rangeEnd = p.rangeEnd;
  Object.assign(param, fiscalFields(p, `param ${p.paramName}`));
  // A calendar name in the catalogue's own spelling, in any case, so `xnys` and `XNYS` are one calendar and
  // `us_futures` survives (ruling Q1). Any other name is upper-cased and kept, for "Unknown calendar".
  if (typeof p.exchange === "string" && p.exchange.trim() !== "") param.exchange = calendarSpelling(p.exchange);
  // Strictly an array of strings — the reference shape is a list, and a bare
  // string would have to be guessed at.
  if (Array.isArray(p.roles)) {
    const roles = p.roles.filter((r): r is string => typeof r === "string");
    if (roles.length > 0) param.roles = roles;
  }
  // v5.4.0, OpenBB's own fields, each kept only in its documented shape.
  if (p.groupable === false) param.groupable = false;
  if (p.multiple === true) param.multiple = true;
  const style = asRecord(p.style);
  if (style && typeof style.popupWidth === "number" && Number.isFinite(style.popupWidth)) {
    param.popupWidth = Math.min(1000, Math.max(200, Math.round(style.popupWidth)));
  }
  const form = toForm(p);
  if (form) param.form = form;
  return param;
}

function toParams(
  value: unknown,
): { params: WidgetParam[]; dropped: number; wrongShape: boolean; shadowed: string[] } {
  // `params` absent entirely, or explicitly `null` (a plausible
  // serialization of a Python-side `params=None`), is normal and must not
  // be reported -- nothing was dropped either way. A genuinely wrong shape
  // (an object, a string, a number) silently discarded every one of them
  // under the old behavior -- that is reported.
  if (!Array.isArray(value)) {
    const wrongShape = value !== undefined && value !== null;
    return { params: [], dropped: 0, wrongShape, shadowed: [] };
  }
  // OpenBB's "organized params" publish each visual section as a NESTED array.
  // Flattened one level so both shapes parse -- a no-op on a flat list. BDOBB
  // has no param sections, so the grouping is lost here and the controls are
  // not; read as-is, every section is a non-record and the widget arrives with
  // no controls at all. Counting drops against the flattened list keeps a
  // section of two junk entries reported as two, not as one.
  const flat = value.flat();
  const parsed = flat
    .filter(isRecord)
    .map(toParam)
    .filter((p): p is WidgetParam => p !== null);
  // A date_range sends its end under `rangeEnd`; a second param declared
  // under that same name would collide with it on the wire, so that param is
  // dropped and named in the widget's issues. The range keeps its place
  // whichever of the two was declared first.
  // v5.4.0: a quarter_range does the same with its end.
  const rangeEnds = new Map<string, string>();
  for (const p of parsed) {
    if (isRangeType(p.type) && p.rangeEnd) rangeEnds.set(p.rangeEnd, p.paramName);
  }
  const shadowed: string[] = [];
  const params = parsed.filter((p) => {
    const owner = rangeEnds.get(p.paramName);
    if (owner === undefined || owner === p.paramName) return true;
    shadowed.push(`param ${p.paramName} is the rangeEnd of ${owner}; dropped`);
    return false;
  });
  return { params, dropped: flat.length - parsed.length, wrongShape: false, shadowed };
}

const CELL_DATA_TYPES = new Set(["text", "number", "boolean", "date", "dateString", "object"]);

const FORMATTER_FNS = new Set([
  "int",
  "none",
  "percent",
  "normalized",
  "normalizedPercent",
  "dateToYear",
]);

/** Anything the reference does not document is dropped, never guessed at. */
function toFormatterFn(value: unknown): ColumnFormatterFn | undefined {
  return typeof value === "string" && FORMATTER_FNS.has(value)
    ? (value as ColumnFormatterFn)
    : undefined;
}

/**
 * One columnsDefs entry, with exactly toParam's discipline: an entry with no
 * string `field` names no column and is dropped; every other property is kept
 * only when its type matches the reference, and is otherwise silently absent.
 * A kept column is therefore always usable, never half-typed.
 */
function toColumnSpec(c: Record<string, unknown>): ColumnSpec | null {
  if (typeof c.field !== "string") return null;
  const column: ColumnSpec = { field: c.field };
  copyTyped(column, c, "string", ["headerName", "headerTooltip", "prefix", "suffix"]);
  copyTyped(column, c, "boolean", ["abbreviate", "hide", "enableCellChangeWs"]);
  copyTyped(column, c, "number", ["width", "minWidth", "maxWidth"]);
  if (typeof c.cellDataType === "string" && CELL_DATA_TYPES.has(c.cellDataType)) {
    column.cellDataType = c.cellDataType as ColumnSpec["cellDataType"];
  }
  const formatterFn = toFormatterFn(c.formatterFn);
  if (formatterFn) column.formatterFn = formatterFn;
  // Only what Intl.NumberFormat accepts as maximumFractionDigits (0..20):
  // anything else throws a RangeError on every cell and blanks the card.
  if (
    typeof c.decimalPlaces === "number" &&
    Number.isInteger(c.decimalPlaces) &&
    c.decimalPlaces >= 0 &&
    c.decimalPlaces <= 20
  ) {
    column.decimalPlaces = c.decimalPlaces;
  }
  if (c.pinned === "left" || c.pinned === "right") column.pinned = c.pinned;
  if (c.align === "left" || c.align === "right" || c.align === "center") column.align = c.align;

  // The live manifest sends both `"greenRed"` and `["greenRed"]`;
  // toStringArray already normalises exactly that pair.
  const renderFn = toStringArray(c.renderFn);
  if (renderFn.length > 0) column.renderFn = renderFn;
  // Kept opaque, and only when it says something: the renderer reads
  // `colorRules` out of it and ignores the rest.
  const renderFnParams = asRecord(c.renderFnParams);
  if (renderFnParams && Object.keys(renderFnParams).length > 0) {
    column.renderFnParams = renderFnParams;
  }
  // Kept opaque, resolved by parseSparkline when the column is built.
  const sparkline = asRecord(c.sparkline);
  if (sparkline && Object.keys(sparkline).length > 0) {
    column.sparkline = sparkline;
  }
  const aggregation = toAggregationHint(c.aggregation);
  if (aggregation) column.aggregation = aggregation;
  return column;
}

/**
 * `data.table`. A widget with no usable column at all gets no TableSpec, so
 * the renderer's "no spec" path — today's rendering, unchanged — is what runs.
 */
function toTable(data: Record<string, unknown> | undefined): TableSpec | undefined {
  const table = asRecord(data?.table);
  if (!table || !Array.isArray(table.columnsDefs)) return undefined;
  const columns = table.columnsDefs
    .filter(isRecord)
    .map(toColumnSpec)
    .filter((c): c is ColumnSpec => c !== null);
  if (columns.length === 0) return undefined;
  const spec: TableSpec = { columns };
  const formatterFn = toFormatterFn(table.formatterFn);
  if (formatterFn) spec.formatterFn = formatterFn;
  return spec;
}

/**
 * `data.table.pivot`. The manifest is untrusted JSON, so every part is checked
 * and a bad part is DROPPED, never coerced — and the widget is never rejected
 * for it: a wrong preset costs the preset, not the card.
 *
 * A field listed in both group lists keeps its first placement (one list
 * only), and duplicates within a list collapse; neither counts as malformed
 * beyond the duplicate itself.
 *
 * `enabled` defaults to true: an author who wrote a preset meant it to show.
 */
function toPivot(data: Record<string, unknown> | undefined): PivotConfig | undefined {
  const table = isRecord(data?.table) ? data.table : null;
  const raw = table && Object.hasOwn(table, "pivot") && isRecord(table.pivot) ? table.pivot : null;
  if (!raw) return undefined;

  const taken = new Set<string>();
  const list = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
      if (typeof item !== "string" || item === "" || taken.has(item)) continue;
      taken.add(item);
      out.push(item);
    }
    return out;
  };
  // fromEntries, never a spread with a computed key: a field named
  // "__proto__" must land as an own property, as everywhere else here.
  const map = <T extends string>(value: unknown, allowed: readonly T[]): Record<string, T> | undefined => {
    if (value === undefined) return undefined;
    if (!isRecord(value)) return undefined;
    const entries: [string, T][] = [];
    for (const [field, name] of Object.entries(value)) {
      if ((allowed as readonly unknown[]).includes(name)) entries.push([field, name as T]);
    }
    return entries.length > 0 ? (Object.fromEntries(entries) as Record<string, T>) : undefined;
  };

  const grouping = list(raw.grouping);
  const split = list(raw.split);
  const buckets = map(raw.buckets, BUCKETS);
  const aggregationFns = map(raw.aggregationFns, AGG_NAMES);
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : true;

  // Nothing to group or split by is no preset at all.
  if (grouping.length === 0 && split.length === 0) return undefined;
  const pivot: PivotConfig = { enabled, grouping, split };
  if (buckets) pivot.buckets = buckets;
  if (aggregationFns) pivot.aggregationFns = aggregationFns;
  return pivot;
}

function toGridData(value: unknown): { w: number; h: number } {
  const g = asRecord(value);
  if (!g || typeof g.w !== "number" || typeof g.h !== "number") return { ...DEFAULT_GRID };
  return { w: g.w, h: g.h };
}

const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);

/**
 * The shortest auto-refresh a manifest's own `refetchInterval` may set. The
 * manifest is the backend's JSON, so a typo (`1`, meant as a minute) would
 * otherwise poll every millisecond; raised to one second it is harmless.
 * Zero and negative values pass through: the hook already treats them as
 * "not declared" and falls back to the user's setting.
 */
const MIN_REFETCH_MS = 1_000;
const refetchMs = (v: unknown) => {
  const n = num(v);
  return n !== undefined && n > 0 ? Math.max(n, MIN_REFETCH_MS) : n;
};

export type WidgetIssue = { id: string; reason: string };

/**
 * "<root>" stands in for the payload itself rather than one widget id — angle
 * brackets keep it out of the way of any real widgets.json key, and it can't
 * collide because it isn't drawn from the payload at all.
 */
export const ROOT_ISSUE_ID = "<root>";

function describeRootType(value: unknown): string {
  if (Array.isArray(value)) return "an array";
  if (value === null) return "null";
  return `a ${typeof value}`;
}

/**
 * `settings.ui` of a `type: "settings"` widget. The manifest is untrusted
 * JSON, and anything that is not one of the three documented shapes is
 * `unknown` -- which the dialog shows as "Needs a newer app version" rather
 * than drawing a guess.
 */
function toSettingsUi(value: unknown): SettingsUi {
  const ui = asRecord(value)?.ui;
  if (ui === "form") return { kind: "form" };
  const shape = asRecord(ui);
  if (shape && typeof shape.app === "string") return { kind: "app", name: shape.app };
  if (shape && typeof shape.page === "string") return { kind: "page", path: shape.page };
  return { kind: "unknown" };
}

const DEFAULT_UDF_UPDATE_MS = 60_000;
/** A UDF backend is asked for a whole year of bars each time; more often than this is a hammer. */
const MIN_UDF_UPDATE_MS = 5_000;

/**
 * An `advanced_charting` widget's `data` block: `defaultSymbol`,
 * `updateFrequency` and `chartConfig`. Same rule as the rest of this file --
 * keep only what the reference documents, in the shape it documents, and
 * default the rest. A colour that is not a non-empty string is dropped (so
 * the library's own default applies), not passed through as undefined.
 * `showVolume` is on unless it is literally `false`.
 */
function toUdfChart(data: Record<string, unknown> | undefined): UdfChartSpec {
  const config = asRecord(data?.chartConfig);
  const colors: CandleColors = {};
  for (const key of UDF_COLOR_KEYS) {
    const value = config?.[key];
    if (typeof value === "string" && value !== "") colors[key] = value;
  }
  const symbol = typeof data?.defaultSymbol === "string" ? data.defaultSymbol.trim() : "";
  const freq = data?.updateFrequency;
  return {
    defaultSymbol: symbol || "AAPL",
    updateFrequency:
      typeof freq === "number" && Number.isFinite(freq) && freq > 0
        ? Math.max(MIN_UDF_UPDATE_MS, freq)
        : DEFAULT_UDF_UPDATE_MS,
    colors,
    showVolume: config?.showVolume !== false,
  };
}

/**
 * widgets.json is a JSON object keyed by widget id. One malformed entry is
 * skipped rather than failing the whole backend — and, since that skip used to
 * be silent, every drop is now reported alongside the widgets. What is
 * ACCEPTED is deliberately unchanged.
 *
 * `issues` covers loss at the level of a whole entry or a whole field
 * (a non-object entry, a params array whose entries don't survive, a
 * params value that isn't an array at all). It does NOT cover field-level
 * coercion within a widget that is otherwise kept — e.g. a non-string
 * `endpoint` silently becomes `""`, a non-number `refetchInterval` becomes
 * `undefined` and a positive one under a second is raised to a second —
 * those widgets are still returned with no issue reported. An
 * empty `issues` array means "nothing was dropped," not "every field is
 * well-formed."
 */
export function normalizeWidgets(
  raw: unknown,
  backendId: string,
): { widgets: WidgetDef[]; issues: WidgetIssue[] } {
  const root = asRecord(raw);
  if (!root) {
    return {
      widgets: [],
      issues: [
        {
          id: ROOT_ISSUE_ID,
          reason: `widgets.json root is not an object keyed by widget id (got ${describeRootType(raw)})`,
        },
      ],
    };
  }

  const widgets: WidgetDef[] = [];
  const issues: WidgetIssue[] = [];

  for (const [id, value] of Object.entries(root)) {
    const w = asRecord(value);
    if (!w) {
      issues.push({ id, reason: "entry is not a JSON object" });
      continue;
    }

    const data = asRecord(w.data);
    const { params, dropped, wrongShape, shadowed } = toParams(w.params);
    if (wrongShape) issues.push({ id, reason: "params is not an array; all params dropped" });
    else if (dropped > 0) issues.push({ id, reason: `${dropped} malformed params dropped` });
    for (const reason of shadowed) issues.push({ id, reason });

    // storage.mcpUrl is backend-supplied and becomes a URL the app contacts,
    // so only http(s) is accepted; anything else is an issue, not a guess.
    const storage = asRecord(w.storage);
    let mcpUrl: string | undefined;
    if (storage && storage.mcpUrl !== undefined) {
      if (typeof storage.mcpUrl === "string" && safeUrl(storage.mcpUrl.trim()) !== null) mcpUrl = storage.mcpUrl.trim();
      else issues.push({ id, reason: "storage.mcpUrl is not an http(s) URL; ignored" });
    }

    // A malformed pivot PRESET is the backend's manifest quirk, not a loss of
    // the user's own data, and it never stops the widget loading -- so it is
    // kept out of `issues` (which drives the connection's own notice).
    const pivot = toPivot(data);

    widgets.push({
      id,
      backendId,
      name: str(w.name, id),
      description: str(w.description, ""),
      type: str(w.type, "table"),
      provider: typeof w.provider === "string" ? w.provider : undefined,
      protocolVersion: typeof w.protocolVersion === "number" ? w.protocolVersion : undefined,
      ssrm: toSsrmCapabilities(w.ssrm),
      category: str(w.category, "Uncategorized"),
      subCategory: str(w.subCategory, ""),
      endpoint: str(w.endpoint, ""),
      wsEndpoint: typeof w.wsEndpoint === "string" && w.wsEndpoint !== "" ? w.wsEndpoint : undefined,
      wsRowIdColumn: data && typeof data.wsRowIdColumn === "string" ? data.wsRowIdColumn : undefined,
      gridData: toGridData(w.gridData),
      params,
      dataKey: data && typeof data.dataKey === "string" ? data.dataKey : undefined,
      table: toTable(data),
      ...(pivot ? { pivot } : {}),
      udfChart: w.type === "advanced_charting" ? toUdfChart(data) : undefined,
      source: toStringArray(w.source),
      // A literal `true` and nothing else. Anything truthy would opt a widget
      // out of automatic execution that never asked to be — the opposite of
      // this file's rule everywhere else, which is to drop what the reference
      // does not document rather than guess at it.
      calendarBinding: w.calendarBinding as WidgetDef["calendarBinding"],
      calendarResolutionPolicy: w.calendarResolutionPolicy as WidgetDef["calendarResolutionPolicy"],
      runButton: w.runButton === true ? true : undefined,
      refetchInterval: w.refetchInterval === false ? false : refetchMs(w.refetchInterval),
      mcpUrl,
      exchange: typeof w.exchange === "string" && w.exchange.trim() !== "" ? calendarSpelling(w.exchange) : undefined,
      ...fiscalFields(w, `widget ${id}`),
      settingsUi: w.type === "settings" ? toSettingsUi(w.settings) : undefined,
    });
  }
  return { widgets, issues };
}

/** Keep only inert, explicitly declared standard SSRM operations. */
function toSsrmCapabilities(value: unknown): WidgetDef['ssrm'] {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
 const v=value as Record<string,unknown>;
 const raw=(v.pivot as {columns?:unknown})?.columns;
 const pivot=Array.isArray(raw)&&raw.length>0&&raw.length<=4096&&raw.every(c=>c&&typeof c==='object'&&typeof c.id==='string'&&!!c.id&&typeof c.label==='string'&&(c.dtype===undefined||['text','number','boolean','date','dateString','object'].includes(c.dtype)))?
  {columns:raw.map(c=>({id:c.id as string,label:c.label as string,...(c.dtype?{dtype:c.dtype as ColumnSpec['cellDataType']}:{})}))}:undefined;
 return {
  ...(pivot?{pivot}:{}),
  ...(typeof v.sorting==='boolean'?{sorting:v.sorting}:{}),
  ...(Array.isArray(v.filtering)?{filtering:v.filtering.filter((x):x is 'text'|'number'=>x==='text'||x==='number')}:{}),
  ...(v.grouping===true?{grouping:true}:{}),
  ...(Array.isArray(v.aggregations)?{aggregations:v.aggregations.filter((x):x is 'sum'|'min'|'max'|'mean'|'count'=>['sum','min','max','mean','count'].includes(x))}:{}),
 };
}
