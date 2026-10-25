// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useParamOptions, type OptionsState } from "../hooks/useParamOptions";
import { controlKind, fieldContext, paramsKey, visibleParams, wireParams, type ControlKind } from "../lib/params";
import { type CalendarTrace, type ExchangeCalendar } from "../lib/calendar";
import { isExpression, isPeriodType, previewExpression, resolveForDisplay, type PeriodType } from "../lib/dateExpressions";
import { isRelativeType, type Preset } from "../lib/presets";
import { fiscalLabel, monthControlParams, type FiscalSource } from "../lib/fiscalChain";
import { monthLabel, parseFyEndMonth } from "../lib/periods";
import { fiscalPeriodOptions, isStatementPeriodParam } from "../lib/statementFiscal";
import { splitParamEdit, type ParamEdit } from "../lib/paramGroups";
import type {
  BackendConfig,
  DashboardCard,
  ParamGroup,
  ParamOption,
  WidgetDef,
  WidgetParam,
} from "../lib/types";
import { GroupLink } from "./GroupLink";
import { ParamInput } from "./ParamInput";
import { PopupWidthContext } from "./pickers/PeriodPopover";
import type { RelativeContext } from "./pickers/RelativeTab";

/**
 * v5.4.0 (spec §1.5): the per-card "FY ends" control. `month`/`source`/
 * `ticker` are the chain's reading without the card's override (so the
 * Automatic option can say what Automatic gives); `override` is the card's
 * own month when set; `onChange` writes it, `undefined` meaning Automatic.
 */
export type FiscalControl = {
  month: number;
  source: FiscalSource;
  ticker?: string;
  override?: number;
  onChange: (month: number | undefined) => void;
};

type Props = {
  inline?: boolean;
  widget: WidgetDef;
  card: DashboardCard;
  groups: ParamGroup[] | undefined;
  /** The dashboard's Disable grouping toggle. Kept out of `groups` so the groups survive it. */
  groupsDisabled: boolean;
  effective: Record<string, string>;
  /** Needed to fetch optionsEndpoint options. Undefined = every such param errors. */
  backend: BackendConfig | undefined;
  /**
   * Each quarter / fiscal-year param's resolved year-end month, by paramName
   * (useFiscalYearEnd in WidgetCard). Labels, grids, the displayed value of
   * a `T` expression, and the group relabelling all read it. Absent means
   * December for every param.
   */
  fiscalYearEnd?: Record<string, number>;
  /** The trading calendars by MIC (useTradingCalendar in WidgetCard); absent means the weekday table. */
  calendars?: Record<string, ExchangeCalendar>;
  /** v5.4.0: the dashboard's exchange (calendarOf's fifth step). */
  exchange?: string;
  /** The dashboard's saved presets and the two writes on them (dashboardStore). */
  presets?: Preset[];
  onSavePreset?: (name: string, expr: string) => void;
  onDeletePreset?: (name: string) => void;
  /**
   * The viewer window: the Relative tab is still offered, but handed neither
   * write — chips load and Apply commits, nothing saves or deletes a preset,
   * because the viewer's store would refuse both and only log it (see
   * RelativeContext).
   */
  presetsReadOnly?: boolean;
  onApply: (edit: ParamEdit) => void;
  /** v5.4.0: each param's fiscal ⚠ text (useFiscalYearEnd's `reasons`), joined on one badge with a calendar reason. */
  fiscalReasons?: Record<string, string>;
  /** v5.4.0: the FY ends control; absent means the card shows none (fiscalControlParam decided). */
  fiscalControl?: FiscalControl;
  /** Distinguishes a second instance of the same card's controls — the Parameters panel — so label/htmlFor pairs stay unique. */
  idPrefix?: string;
};

/**
 * Before useParamOptions' first effect commits, a param has no entry yet.
 * Its key is empty because the hook has not named one yet — a real key never
 * is — and nothing keys off this stand-in: the cascade effect below reads
 * optionStates directly, so only rendering ever sees it.
 */
const LOADING: OptionsState = { status: "loading", key: "" };

/**
 * The kinds ParamInput renders as a React Aria control. Such a control is
 * named through aria-label (ParamInput); a <label htmlFor> would point at
 * nothing, so their label carries no htmlFor and names no control.
 */
const RAC_KINDS = new Set(["date", "time", "datetime", "range", "quarter", "fiscalYear", "week", "quarterRange"]);

/**
 * v5.5.0 (task 3): kinds whose control shows no value of its own worth
 * reading at a glance — a bare number or free text says nothing until you
 * read the label next to it. These keep their label on screen; every other
 * kind is a chip, its label hidden but still the accessible name.
 */
const TEXTLIKE_KINDS = new Set<ControlKind>(["text", "number", "suggest", "form", "tabs", "unsupported"]);

/**
 * The part of a shown value the new option list still offers. A single value
 * the list no longer offers clears to ""; a multi value keeps its offered
 * members and drops the rest, so `a,b` with `b` withdrawn becomes `a`.
 */
function retainOffered(value: string, options: ParamOption[], multi: boolean): string {
  const offered = new Set(options.map((o) => o.value));
  if (!multi) return offered.has(value) ? value : "";
  return value
    .split(",")
    .filter((v) => offered.has(v))
    .join(",");
}

/**
 * The parts of the shown value the offered list does not carry, each of which
 * needs an option of its own. Without them a stored value silently reads back
 * as the first option (single) or as unselected (multi) — the display would
 * then disagree with what the card stores. This is also what a control shows
 * while its list is still loading: its own value, not a blank.
 *
 * An empty single value counts where "" is a real state a select can
 * otherwise not represent: an endpoint-backed param (the value a cascade just
 * cleared) or a param declared `optional: true` (nothing sent, so no filter —
 * showing the first option would claim a filter the request does not carry).
 * Any other static select with nothing stored keeps its long-standing
 * behaviour of displaying its first option.
 */
function unofferedValues(
  value: string,
  options: ParamOption[],
  multi: boolean,
  blankIsReal: boolean,
): string[] {
  const offered = new Set(options.map((o) => o.value));
  if (multi) return value.split(",").filter((v) => v !== "" && !offered.has(v));
  if (offered.has(value) || (value === "" && !blankIsReal)) return [];
  return [value];
}

/** The twelve months a month control offers when its manifest lists none, valued 1–12 (spec §4.5). */
const TWELVE_MONTHS: ParamOption[] = Array.from({ length: 12 }, (_, i) => ({ label: String(i + 1), value: String(i + 1) }));

/**
 * A month control's options with each label the system locale's
 * abbreviation, read from the option's value or, failing that, its label.
 * The VALUE is untouched: it is what the backend receives, so the Period
 * echo's `fy_end` goes on sending `December` (spec §4.5).
 */
function monthOptions(options: ParamOption[]): ParamOption[] {
  return options.map((o) => {
    const month = parseFyEndMonth(o.value) ?? parseFyEndMonth(o.label);
    return month === undefined ? o : { ...o, label: monthLabel(month) };
  });
}

/** controlKind, except that a month control (see monthOptions) is a dropdown even with no options of its own. */
function kindOf(param: WidgetParam, monthParams: Set<string>): ControlKind {
  const kind = controlKind(param);
  return kind === "text" && monthParams.has(param.paramName) ? "select" : kind;
}

export function ParamControls({
  inline = false,
  widget,
  card,
  groups,
  groupsDisabled,
  effective,
  backend,
  fiscalYearEnd = {},
  calendars,
  exchange,
  presets = [],
  onSavePreset,
  onDeletePreset,
  presetsReadOnly = false,
  onApply,
  fiscalReasons = {},
  fiscalControl,
  idPrefix = "",
}: Props) {
  const params = useMemo(() => visibleParams(widget), [widget]);

  // Only the params the row actually renders: a show:false param (every
  // fileSelector in the live manifest) has no control, so fetching a list for
  // it buys nothing.
  const shownWidget = useMemo(() => ({ ...widget, params }), [widget, params]);

  /**
   * Uncommitted keystrokes in a TYPED control, by param name. A select or a
   * checkbox commits on change and never appears here; a text, number, date
   * or time field commits on blur or Enter, as a form field does, so a
   * half-typed symbol does not refetch the card on every keystroke.
   */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /**
   * The same drafts, readable synchronously. A calendar pick fires the day
   * picker's onChange (draft written) and its close (draft committed) in one
   * event, before React re-renders — a commit that read `drafts` from this
   * render's closure would still see the value from before the pick.
   */
  const draftsRef = useRef<Record<string, string>>({});
  const writeDraft = (name: string, value: string) => {
    draftsRef.current = { ...draftsRef.current, [name]: value };
    setDrafts(draftsRef.current);
  };
  const dropDrafts = (names: string[]) => {
    const next = { ...draftsRef.current };
    for (const name of names) delete next[name];
    draftsRef.current = next;
    setDrafts(next);
  };

  /**
   * v5.4.0 (spec §4.5): the params some `fiscalYearEndParam` names, on a
   * param or on the widget. Each is a month control — see monthOptions.
   * Reuses fiscalChain's monthControlParams rather than rebuilding the set
   * here (controller ruling PF5: one definition of "is this a month control").
   */
  const monthParams = useMemo(() => monthControlParams(widget), [widget]);

  const kindByName = useMemo(() => {
    const m = new Map<string, ControlKind>();
    for (const p of params) m.set(p.paramName, kindOf(p, monthParams));
    return m;
  }, [params, monthParams]);

  // What the control SHOWS for a stored value: an expression resolved in the
  // param's own vocabulary (a quarter param's `T` is this quarter under its
  // year end), a literal as-is. A range stays composite here; only the wire
  // splits it. Resolved on the param's exchange calendar, as the wire is, so
  // the control, the ◷ tooltip and the request agree.
  const displayed = (name: string) => {
    const param = params.find((p) => p.paramName === name);
    // The type is the LAST declaration's, same as kindByName above, so the two
    // agree even on a malformed manifest that declares a name twice. A value
    // that cannot resolve shows as stored; the ⚠ badge says why.
    return resolveForDisplay(params.filter((p) => p.paramName === name).at(-1)?.type, effective[name] ?? "", {
      fiscalYearEnd: fiscalYearEnd[name],
      ...fieldContext(widget, param, { exchange, calendars }, effective),
    });
  };
  const shown = (name: string) => drafts[name] ?? displayed(name);

  /**
   * What each control's resolution consulted, for the ⚠ badge: one
   * wireParams pass over the effective params with a trace — the same call
   * the request makes, so the badge and the wire cannot disagree about which
   * calendar answered.
   */
  const trace: Record<string, CalendarTrace> = {};
  const calendarErrors: Record<string, string> = {};
  wireParams(shownWidget, effective, { fiscalYearEnd, calendars, trace, exchange, errors: calendarErrors });

  /**
   * The Relative tab's context for one period control: preview in the
   * control's own vocabulary (its type, year end and exchange calendar), the
   * dashboard's presets, and the two writes. Built per render — the tab only
   * reads it while its popover is open.
   */
  const relativeFor = (name: string, type: PeriodType, param: WidgetParam): RelativeContext | undefined => {
    if (!isRelativeType(type) || !onSavePreset || !onDeletePreset) return undefined;
    return {
      preview: (expr) =>
        previewExpression(type, expr, { fiscalYearEnd: fiscalYearEnd[name], ...fieldContext(widget, param, { exchange, calendars }, effective) }),
      presets,
      onSavePreset: presetsReadOnly ? undefined : onSavePreset,
      onDeletePreset: presetsReadOnly ? undefined : onDeletePreset,
    };
  };

  const isTyped = (name: string) => {
    const kind = kindByName.get(name);
    return kind === "text" || kind === "number" || kind === "date" || kind === "time" || kind === "suggest";
  };

  // A boolean control with no seeded default displays as "" (absent), but
  // unchecking always writes "false" — so "" and "false" must read as the
  // same value, or an unseeded boolean could be written as an explicit
  // cache=false without anyone having changed it.
  const normalize = (name: string, value: string) =>
    kindByName.get(name) === "boolean" && value === "" ? "false" : value;

  /**
   * One control's committed value. Only a genuine difference from what is
   * displayed is written: typing a value and typing it back must not save the
   * dashboard, and re-picking today's date on a $currentDate token must not
   * burn the token into a literal date. The write goes through
   * splitParamEdit, so a bound control moves its group and an unbound one
   * lands on the card — the same path the Apply button took.
   */
  const commit = (name: string, value: string) => {
    if (normalize(name, value) === normalize(name, displayed(name))) return;
    onApply(splitParamEdit({ [name]: value }, card, groups, widget, groupsDisabled, fiscalYearEnd));
  };

  const commitDraft = (name: string) => {
    const draft = draftsRef.current[name];
    if (draft === undefined) return;
    dropDrafts([name]);
    commit(name, draft);
  };

  // Fetched from the DRAFT-MERGED values, so picking Chamber refetches
  // Committee live — a select commits on change, so its draft IS the
  // committed value by the time the list is requested.
  // v5.4.0 (spec §6): what the options request substitutes is each param's
  // WIRE value — resolved on its own type, calendar and year end, over the
  // full widget so a hidden param is typed too. A grouped `T-1w` arrives as a
  // date, and a date_range gives its start by its own name and its end by
  // its rangeEnd name (ruling 5).
  const optionStates = useParamOptions(
    backend,
    shownWidget,
    wireParams(widget, { ...effective, ...drafts }, { fiscalYearEnd, calendars, exchange }),
  );

  /**
   * Cascade clearing, decided by REQUEST KEY. Every options state carries the
   * key it belongs to; the key a param was on when the row opened is
   * recorded below, once, from the first state seen for it — loading included.
   * A ready list arriving under any other key means an upstream param moved
   * while the row was open, and a shown value that list does not offer is
   * cleared.
   *
   * Both standing rules fall out of that comparison rather than being special
   * cases: the first result after opening never clears (its key IS the mount
   * key), and an unchanged upstream never wipes a downstream (same key again).
   *
   * Keying it, rather than comparing option arrays, is what covers the case
   * where the upstream changes while the downstream's first list is still in
   * flight: the old list is dropped unseen, so the new one is the first list
   * this param ever shows — indistinguishable from an opening result by
   * array identity, and plainly a different key.
   */
  const mountKey = useRef<Record<string, string>>({});
  const clearedForKey = useRef<Record<string, string>>({});

  /**
   * The row stays mounted across a commit, so "the key this param opened on"
   * has to move with the card. The two ways `effective` can change pull in
   * opposite directions, and this is where they are told apart:
   *
   * - A commit from THIS row is a reopen. It writes the value the row was
   *   already showing, so every key is unchanged and adopting the keys on
   *   screen is exactly right — the row carries on from where the card now
   *   is. Without it, returning an upstream param to the value the row was
   *   first opened with would look like the opening result and a downstream
   *   value the returning list does not offer would survive.
   * - An external upstream change (a group edit from another card) is a
   *   change. Its list arrives under a key this row never showed, so it
   *   fails the comparison below and clears, exactly as a user's own edit
   *   would.
   *
   * Rewritten to the keys on screen, not wiped: nothing here re-seeds them
   * (the cascade effect below does not re-run when a commit leaves every key
   * alone), so a wipe would leave the NEXT list to arrive — the one that
   * should clear — to seed itself and clear nothing.
   *
   * A param still LOADING keeps whatever key it had. Its list is in flight
   * under a key nothing has shown yet; adopting that key would make the answer
   * count as an opening result the moment it lands, which is precisely the
   * cascade this exists to catch.
   */
  const effectiveKey = paramsKey(effective);
  useEffect(() => {
    const before = mountKey.current;
    const next: Record<string, string> = {};
    for (const [name, state] of Object.entries(optionStates)) {
      // An error names no list, and with no backend not even a real key, so it
      // can no more define an opening state here than it can seed one below.
      const adopted =
        state.status === "ready"
          ? state.key
          : state.status === "loading"
            ? (before[name] ?? state.key)
            : before[name];
      if (adopted !== undefined) next[name] = adopted;
    }
    mountKey.current = next;
    clearedForKey.current = {};
    // Only the change of params triggers this; optionStates is read for the
    // keys it happens to hold at that moment, and must not re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveKey]);

  useEffect(() => {
    const cleared: Record<string, string> = {};
    for (const p of params) {
      const state = optionStates[p.paramName];
      if (!state) continue;
      // v5.4.0 (ruling 17): a `multiple` field accepts any typed value, so a
      // new list is never a reason to clear it.
      if (kindByName.get(p.paramName) === "suggest") continue;
      // Never seeded from an error state: with no backend its key names no
      // backend either, so the first real list would arrive under a different
      // key and wipe a stored value the user never touched.
      if (state.status !== "error") mountKey.current[p.paramName] ??= state.key;
      if (state.status !== "ready" || state.options.length === 0) continue;
      if (state.key === mountKey.current[p.paramName]) continue;
      // At most once per (param, key): re-running on an unrelated param's
      // state change must not re-clear a value the user has since chosen.
      if (clearedForKey.current[p.paramName] === state.key) continue;
      clearedForKey.current[p.paramName] = state.key;
      const current = shown(p.paramName);
      const kept = retainOffered(current, state.options, kindByName.get(p.paramName) === "multi");
      if (kept === current) continue;
      // `commit`'s no-spontaneous-write rule, applied per name here because
      // the write below is one edit for all of them: a clear that lands on
      // the value the card already holds must not be what makes the
      // dashboard save.
      if (normalize(p.paramName, kept) === normalize(p.paramName, displayed(p.paramName))) continue;
      cleared[p.paramName] = kept;
    }
    // ONE write for every param this pass cleared, not one each. Each write
    // carries a full `cardParams` built from the same `card` prop — which
    // cannot have re-rendered inside this pass — and applyCardParams assigns
    // it wholesale, so a second write would put back the first's pre-clear
    // value; clearedForKey has already stamped both names, so neither would
    // ever clear again.
    //
    // Committed, not drafted: the upstream change that caused these lists has
    // already been written, so this is still a second write after it, and the
    // member fetch between them may carry the values the new lists withdrew.
    // This write corrects them.
    if (Object.keys(cleared).length > 0) {
      onApply(splitParamEdit(cleared, card, groups, widget, groupsDisabled, fiscalYearEnd));
      // A draft outranks the committed value on screen, so one left behind
      // here would go on showing what the new list just withdrew.
      dropDrafts(Object.keys(cleared));
    }
    // `shown` reads drafts and effective, deliberately not listed: the trigger
    // that matters is a list arriving under a new key, and the guards above
    // make any extra run a no-op anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionStates, params, kindByName]);

  const Container=inline?Fragment:"div";
  return (
    <Container {...(inline?{}:{className:"card-params"})}>
      {params.map((p) => {
        const kind = kindOf(p, monthParams);
        const id = `${idPrefix}${card.id}-${p.paramName}`;
        const label = p.label ?? p.paramName;
        const value = shown(p.paramName);
        const typed = isTyped(p.paramName);
        // Only a param with an endpoint has a fetch state. A multiSelect
        // param with a static list has none, and must not be left waiting
        // on one that will never arrive.
        const state = p.optionsEndpoint ? (optionStates[p.paramName] ?? LOADING) : undefined;
        // An errored endpoint param falls back to a hand-typed text input
        // below, so it drafts and commits exactly like a declared text field.
        const typedOrError = typed || state?.status === "error";
        const set = (v: string) =>
          typedOrError ? writeDraft(p.paramName, v) : commit(p.paramName, v);
        // The endpoint is authoritative when there is one: static options on
        // an endpoint param are ignored (the one live case declaring both,
        // Chamber, declares identical content).
        const listed =
          state === undefined
            ? (p.options ?? [])
            : state.status === "error"
              ? []
              : (state.options ?? []);
        // v5.4.0: a month control shows locale abbreviations, and a static one
        // with no list of its own offers the twelve months.
        const options = !monthParams.has(p.paramName)
          ? listed
          : monthOptions(state === undefined && listed.length === 0 ? TWELVE_MONTHS : listed);
        // A statement period's choices read FY / FQ / TTM. Only the labels
        // change: `options` (values) still drives unoffered and the pending
        // test, and `value` is what is stored, so the select keeps showing the
        // choice whose value is stored.
        const named = isStatementPeriodParam({ paramName: p.paramName, options })
          ? fiscalPeriodOptions(options, value)
          : options;
        // Nothing to choose from yet: disabled, showing the current value
        // (see unofferedValues) rather than an empty control. A cascade
        // refetch carries the previous list, so it is not pending and stays
        // populated.
        const pending = state?.status === "loading" && options.length === 0;
        const unoffered = unofferedValues(
          value,
          options,
          kind === "multi",
          state !== undefined || p.optional === true,
        );
        // One Enter handler for the whole control, on the wrapper: putting a
        // second one on the input itself would commit twice in one event.
        // An Enter that ends an IME composition is the IME's, not a commit.
        const onKeyDown = typedOrError
          ? (e: KeyboardEvent) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) commitDraft(p.paramName);
            }
          : undefined;
        const storedValue = effective[p.paramName] ?? "";
        const expression = isExpression(p.type, storedValue);
        const fallback = trace[p.paramName]?.fallback === true;
        // A chip shows its value, not its name: the name is the tooltip and
        // stays the control's accessible name. Text-like kinds keep the name
        // on screen — a bare number or free text says nothing by itself.
        const chip = !TEXTLIKE_KINDS.has(kind);
        const exprLabel = expression
          ? `Expression ${storedValue}, resolves now to ${displayed(p.paramName)}, updates when the card refreshes`
          : null;
        const fieldTitle = exprLabel ?? (p.description ? `${label}\n${p.description}` : label);

        return (
          // The hint is a sibling of the label, not inside it: a description
          // or a fetch error must not be absorbed into the control's
          // accessible name, which is the param's label alone. The link is a
          // sibling for the same reason.
          <div key={p.paramName} className="param-field" data-kind={kind} data-chip={chip ? "" : undefined} title={fieldTitle}>
            {/* v5.4.0 (spec §4.3): a groupable: false param shows no chain link at all. */}
            {p.groupable === false ? null : (
              <GroupLink
                card={card}
                param={p}
                groups={groups}
                groupsDisabled={groupsDisabled}
                // What the control SHOWS, draft included: clicking the link
                // from a half-typed field must seed the new group with what is
                // on screen, not with the committed value the pending blur has
                // yet to replace.
                value={shown(p.paramName)}
                fiscalYearEnd={fiscalYearEnd[p.paramName]}
              />
            )}
            <label className={chip ? "param-label param-label-hidden" : "param-label"} htmlFor={RAC_KINDS.has(kind) ? undefined : id}>
              {label}
            </label>
            {/* Author ruling 2026-10-16: the control and its ◷ / ⚠ badges
                are one unit that never wraps apart -- the box, its picker
                chip and the badge stay on one line wherever the field sits
                (title-bar chips or the Parameters panel grid). */}
            <span className="param-entry">
            <span role="presentation" className="param-control" onKeyDown={onKeyDown}>
              {state?.status === "error" ? (
                // The list could not be fetched. A text input keeps the param
                // usable by hand; the error is the field's title in place of
                // the description.
                <input
                  id={id}
                  type="text"
                  title={state.error}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  onBlur={() => commitDraft(p.paramName)}
                />
              ) : (
                // v5.4.0 (spec §4.8): the param's popupWidth reaches whichever
                // popover this control draws.
                <PopupWidthContext.Provider value={p.popupWidth}>
                  <ParamInput
                    id={id}
                    kind={kind}
                    // v5.4.x: a `date` control is an EXPRESSION field -- its
                    // box shows what is stored (or the draft being typed) and
                    // reads the resolution beneath, so typing `T-1bd` no
                    // longer resolves itself away as you type. Every other
                    // kind still shows the resolved value, as it always has.
                    value={kind === "date" ? (drafts[p.paramName] ?? storedValue) : value}
                    resolved={displayed(p.paramName)}
                    label={label}
                    fiscalYearEnd={fiscalYearEnd[p.paramName]}
                    granularity={p.granularity}
                    options={named}
                    unoffered={unoffered}
                    disabled={pending}
                    onChange={set}
                    onBlur={typed ? () => commitDraft(p.paramName) : undefined}
                    stored={storedValue}
                    relative={isPeriodType(p.type) ? relativeFor(p.paramName, p.type, p) : undefined}
                    // The day picker's Apply: committed at once, never drafted.
                    // Any draft is dropped first — the popover's close reports
                    // a blur right after this, and a stale segment edit must
                    // not be written ahead of the expression (one write, not
                    // two; see DayPicker).
                    onExpression={(expr) => {
                      dropDrafts([p.paramName]);
                      commit(p.paramName, expr);
                    }}
                  />
                </PopupWidthContext.Provider>
              )}
            </span>
            {/*
             * Ruling 2 (task-11 review): the accessible name IS the full
             * tooltip text, not a short label with the detail left in
             * `title` alone — a screen reader only reaches `title` as the
             * description, and these spans are non-focusable (no extra tab
             * stop per control), so a keyboard user cannot get to `title` at
             * all. `aria-label` and `title` are therefore built from the
             * same string on both badges.
             */}
            {exprLabel ? (
              <span className="param-badge-expr" role="img" aria-label={exprLabel} title={exprLabel}>
                {"◷"}
              </span>
            ) : null}
            {/*
             * v5.4.0 (spec §1.4): one ⚠ per control, whatever fell back. A
             * calendar reason and a fiscal one are joined with "; " into the
             * one accessible name, which stays the full tooltip text.
             */}
            {(() => {
              const warnings = [
                calendarErrors[p.paramName] !== undefined ? `Calendar error: ${calendarErrors[p.paramName]}` : undefined,
                fallback ? `Fallback calendar: ${trace[p.paramName]?.reason}` : undefined,
                fiscalReasons[p.paramName],
              ].filter((w): w is string => w !== undefined);
              if (warnings.length === 0) return null;
              const warnLabel = warnings.join("; ");
              return (
                <>
                  {/* Focusable so the detail is reachable without hover; the status region announces it when it appears. */}
                  {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
                  <span className="param-badge-warn" role="img" aria-label={warnLabel} title={warnLabel} tabIndex={0}>
                    {"⚠"}
                  </span>
                  <span className="sr-only" role="status">
                    {warnLabel}
                  </span>
                </>
              );
            })()}
            {trace[p.paramName]?.provisional ? (
              // Spec ruling 2026-10-23: planning-v1 accepted a provisional day, and the card says so.
              <span className="param-badge-provisional" role="img" aria-label="Provisional calendar evidence (planning-v1)" title="Provisional calendar evidence (planning-v1)">
                Provisional
              </span>
            ) : null}
            </span>
          </div>
        );
      })}
      {fiscalControl ? (
        // v5.4.0 (spec §1.5; ruling 1): the last field in the row. A native
        // select shows only its chosen option, so the chain's reading rides
        // in the Automatic option's text while no month is chosen.
        <div className="param-field" data-kind="select" data-chip="" title="FY ends">
          <label className="param-label param-label-hidden" htmlFor={`${idPrefix}${card.id}-fy-ends`}>
            FY ends
          </label>
          <select
            id={`${idPrefix}${card.id}-fy-ends`}
            value={fiscalControl.override === undefined ? "" : String(fiscalControl.override)}
            onChange={(e) => fiscalControl.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          >
            <option value="">
              {fiscalControl.override === undefined
                ? `Automatic (${fiscalLabel(fiscalControl.month, fiscalControl.source, fiscalControl.ticker)})`
                : "Automatic"}
            </option>
            {TWELVE_MONTHS.map((m) => (
              <option key={m.value} value={m.value}>
                {monthLabel(Number(m.value))}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </Container>
  );
}
