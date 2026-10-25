// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useParamOptions, type OptionsState } from "../hooks/useParamOptions";
import { controlKind, paramsKey, resolveParamValue, visibleParams } from "../lib/params";
import { splitParamEdit, type ParamEdit } from "../lib/paramGroups";
import type {
  BackendConfig,
  DashboardCard,
  ParamGroup,
  ParamOption,
  WidgetDef,
} from "../lib/types";
import { GroupLink } from "./GroupLink";
import { ParamInput } from "./ParamInput";

type Props = {
  widget: WidgetDef;
  card: DashboardCard;
  groups: ParamGroup[] | undefined;
  /** The dashboard's Disable grouping toggle. Kept out of `groups` so the groups survive it. */
  groupsDisabled: boolean;
  effective: Record<string, string>;
  /** Needed to fetch optionsEndpoint options. Undefined = every such param errors. */
  backend: BackendConfig | undefined;
  onApply: (edit: ParamEdit) => void;
};

/**
 * Before useParamOptions' first effect commits, a param has no entry yet.
 * Its key is empty because the hook has not named one yet — a real key never
 * is — and nothing keys off this stand-in: the cascade effect below reads
 * optionStates directly, so only rendering ever sees it.
 */
const LOADING: OptionsState = { status: "loading", key: "" };

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
 * An empty single value counts only for an endpoint-backed param, where ""
 * is a real state (the value a cascade just cleared) that a select can
 * otherwise not represent. A static select with nothing stored keeps its
 * long-standing behaviour of displaying its first option.
 */
function unofferedValues(
  value: string,
  options: ParamOption[],
  multi: boolean,
  fromEndpoint: boolean,
): string[] {
  const offered = new Set(options.map((o) => o.value));
  if (multi) return value.split(",").filter((v) => v !== "" && !offered.has(v));
  if (offered.has(value) || (value === "" && !fromEndpoint)) return [];
  return [value];
}

export function ParamControls({
  widget,
  card,
  groups,
  groupsDisabled,
  effective,
  backend,
  onApply,
}: Props) {
  const params = useMemo(() => visibleParams(widget), [widget]);

  /**
   * Uncommitted keystrokes in a TYPED control, by param name. A select or a
   * checkbox commits on change and never appears here; a text, number or
   * date field commits on blur or Enter, as a form field does, so a half-typed
   * symbol does not refetch the card on every keystroke.
   */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const displayed = (name: string) => resolveParamValue(effective[name] ?? "");
  const shown = (name: string) => drafts[name] ?? displayed(name);

  const kindByName = useMemo(() => {
    const m = new Map<string, ReturnType<typeof controlKind>>();
    for (const p of params) m.set(p.paramName, controlKind(p));
    return m;
  }, [params]);

  const isTyped = (name: string) => {
    const kind = kindByName.get(name);
    return kind === "text" || kind === "number" || kind === "date";
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
    onApply(splitParamEdit({ [name]: value }, card, groups, widget, groupsDisabled));
  };

  const commitDraft = (name: string) => {
    const draft = drafts[name];
    if (draft === undefined) return;
    setDrafts((d) => {
      const next = { ...d };
      delete next[name];
      return next;
    });
    commit(name, draft);
  };

  // Only the params the row actually renders: a show:false param (every
  // fileSelector in the live manifest) has no control, so fetching a list for
  // it buys nothing.
  const shownWidget = useMemo(() => ({ ...widget, params }), [widget, params]);

  // Fetched from the DRAFT-MERGED values, so picking Chamber refetches
  // Committee live — a select commits on change, so its draft IS the
  // committed value by the time the list is requested.
  const optionStates = useParamOptions(backend, shownWidget, { ...effective, ...drafts });

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
      onApply(splitParamEdit(cleared, card, groups, widget, groupsDisabled));
      // A draft outranks the committed value on screen, so one left behind
      // here would go on showing what the new list just withdrew.
      setDrafts((d) => {
        const next = { ...d };
        for (const name of Object.keys(cleared)) delete next[name];
        return next;
      });
    }
    // `shown` reads drafts and effective, deliberately not listed: the trigger
    // that matters is a list arriving under a new key, and the guards above
    // make any extra run a no-op anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionStates, params, kindByName]);

  return (
    <div className="card-params">
      {params.map((p) => {
        const kind = controlKind(p);
        const id = `${card.id}-${p.paramName}`;
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
          typedOrError ? setDrafts((d) => ({ ...d, [p.paramName]: v })) : commit(p.paramName, v);
        // The endpoint is authoritative when there is one: static options on
        // an endpoint param are ignored (the one live case declaring both,
        // Chamber, declares identical content).
        const options =
          state === undefined
            ? (p.options ?? [])
            : state.status === "error"
              ? []
              : (state.options ?? []);
        // Nothing to choose from yet: disabled, showing the current value
        // (see unofferedValues) rather than an empty control. A cascade
        // refetch carries the previous list, so it is not pending and stays
        // populated.
        const pending = state?.status === "loading" && options.length === 0;
        const unoffered = unofferedValues(value, options, kind === "multi", state !== undefined);
        // One Enter handler for the whole control, on the wrapper: putting a
        // second one on the input itself would commit twice in one event.
        // An Enter that ends an IME composition is the IME's, not a commit.
        const onKeyDown = typedOrError
          ? (e: KeyboardEvent) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) commitDraft(p.paramName);
            }
          : undefined;

        return (
          // The hint is a sibling of the label, not inside it: a description
          // or a fetch error must not be absorbed into the control's
          // accessible name, which is the param's label alone. The link is a
          // sibling for the same reason.
          <div key={p.paramName} className="param-field" title={p.description}>
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
            />
            <label className="param-label" htmlFor={id}>
              {label}
            </label>
            {/* The span only relays a bubbled keydown from the real
                input/select inside it -- that child is the interactive
                element and already carries its own role and tabIndex. */}
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
            <span onKeyDown={onKeyDown}>
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
                <ParamInput
                  id={id}
                  kind={kind}
                  value={value}
                  options={options}
                  unoffered={unoffered}
                  disabled={pending}
                  onChange={set}
                  onBlur={typed ? () => commitDraft(p.paramName) : undefined}
                />
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
