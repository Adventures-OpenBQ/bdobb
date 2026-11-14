// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import { useId, useState, type ReactNode } from "react";
import { CHART_INTERVAL, CHART_LAYOUT, CHART_RANGE, CHART_SESSION } from "../../../lib/chart/chartGroups";
import { getHost } from "../../../host";
import { groupFor } from "../../../lib/paramGroups";
import { intervalLabel } from "../../../lib/chart/intervalLabel";
import { RANGE_PRESETS, shownAs } from "../../../lib/chart/rangeExpr";
import type { DashboardCard, ParamGroup, WidgetParam } from "../../../lib/types";
import { ChartGroupChip } from "./ChartGroupChip";
import { Popover } from "./Popover";
import { SpecPopover } from "./SpecPopover";

// `null` is "the card carries no range at all": the seed fits everything
// loaded, and no chip is lit. Custom means a range that matches no preset.
type Preset = "1D" | "5D" | "1M" | "Custom" | null;

/**
 * ADJ's explanation, in one place: the pointer reads it from `title`, a screen
 * reader from `aria-describedby` (which wins over `title` for the description,
 * so nothing is announced twice).
 */
const ADJ_HINT =
  "Adjusted or raw close for the indicators. Tick-derived candles carry no adjustment data and are unadjusted either way.";

/**
 * The chart's command cluster and actions (spec 2026-09-24, A1/A3, D3),
 * relocated here from the header row: interval · range | session on line 1,
 * then Adjusted, the panels editor, the three actions (Series, the `{ }`
 * spec popover, Snapshot), the Left toolbar switch and the card's Keep-open
 * pin on line 2. Every control and popover below is unchanged from the
 * header's own version -- this component only supplies the two-line
 * wrapper (`.chart-params` > two `.chart-params-line`) and, since the
 * settings gear that used to host it is gone, ADJ and Panels are now their
 * own direct controls rather than living behind one shared popover.
 *
 * Task 6 (spec 2026-09-24, C): Panels and Series no longer open a popover of
 * their own here -- both are openers for the one Layout editor, mounted once
 * at the renderer's top level. `layoutTab` says which tab it is showing (or
 * null, closed), and each button's `onOpenLayout` call names the tab it
 * wants; `PanelEditor` and the old studies selector's anchor are gone from
 * this component entirely.
 */
export function ChartControls({
  intervals, interval, onInterval, onCustomInterval, intervalOpen, intervalChildren, preset, onPreset, rangeFixed = false, onCustomRange, rangeOpen, rangeChildren,
  exchange, session, onSession, adjusted, onAdjusted, layoutTab, onOpenLayout,
  layouts, layoutMatch, onApplyLayout, onApplyMacro,
  specJson, onApplySpec, onSnapshot,
  studyValues, onStudyValues, seriesPills, onSeriesPills, snapshotHeader, onSnapshotHeader, onOk, onCancel, paramsDirty, railHidden, onRailHidden,
  card, groups, groupsDisabled, symbolParam, symbolValue, macroParam, macroValue, layoutLockedBy, sourceParam, sourceValue, onSource, narrow, chartRangeValue,
  seriesCount, panelCount,
}: {
  intervals: string[]; interval: string; onInterval: (interval: string) => void;
  /**
   * The interval's Custom… box (spec 2026-09-25, G8), the same shape as the
   * range's Custom…: `onCustomInterval` toggles the popover, `intervalOpen`
   * says whether it is showing, and `intervalChildren` is the IntervalPopover
   * the renderer mounts. A custom interval is the same `interval` field, so it
   * flows through `onInterval` like any chip.
   */
  onCustomInterval: (open: boolean) => void; intervalOpen: boolean; intervalChildren: ReactNode;
  preset: Preset; onPreset: (label: "1D" | "5D" | "1M") => void;
  /**
   * v12.4.0 (T9): true once the card's `start`/`end` parameters fix the
   * window (spec, Widget properties) -- the preset chips and the narrow
   * select can then choose nothing (the window is not theirs to set), so
   * they show disabled with a title saying why, and a press calls neither
   * `onPreset`. Custom… stays live: the popover it opens still shows the
   * effective window, read-only.
   */
  rangeFixed?: boolean;
  onCustomRange: (open: boolean) => void; rangeOpen: boolean; rangeChildren: ReactNode;
  /**
   * The session toggle (v12.3.0 slice 4, session addendum §4.4): the
   * exchange the regular session belongs to, or null to show no toggle at
   * all -- a crypto or forex symbol, a daily chart. Controlled like the
   * range: the renderer patches the card and the card is what is shown.
   */
  exchange: string | null; session: "extended" | "regular" | "24hr"; onSession: (session: "extended" | "regular" | "24hr") => void;
  adjusted: boolean; onAdjusted: (adjusted: boolean) => void;
  /** The one Layout editor (spec 2026-09-24, C): which tab it is open on (null = closed), and the opener each button calls. */
  layoutTab: "series" | "panels" | null;
  onOpenLayout: (tab: "series" | "panels") => void;
  /**
   * The saved layout library on the row's Layout control (spec 2026-09-24,
   * D9): the names to list, the name this card currently matches ("Default", a
   * saved name, or "Custom" once anything is changed), and the apply. Choosing
   * a name lays the card out; the card is then its own -- editing it never
   * writes back to the library.
   */
  layouts: string[];
  layoutMatch: string;
  onApplyLayout: (name: string) => void;
  specJson: string; onApplySpec: (text: string) => string | null;
  onSnapshot: () => void;
  /**
   * The Keep-open pin (user ruling 2026-09-24, D5): saved with the card, it
   * decides whether this strip is showing on the next load. It never
   * touches what is on screen now -- that is the card's transient open flag
   * in WidgetCard -- so ticking it while the row is open changes only the
   * next render of the dashboard.
   */
  /**
   * The two legend blocks above the plot and their writers (user, 2026-09-27).
   * Both default to shown; a card stores the flag only once it is turned off.
   * They replaced Keep open, which decided whether this row came up showing on
   * the next load -- the card title bar's own parameters control governs that.
   */
  studyValues: boolean; onStudyValues: (show: boolean) => void;
  seriesPills: boolean; onSeriesPills: (show: boolean) => void;
  /** Whether the PNG export carries the card's header band (owner, 2026-09-27). */
  snapshotHeader: boolean; onSnapshotHeader: (on: boolean) => void;
  /**
   * The Parameters transaction (spec 2026-09-24, D1/D9). Every control still
   * applies the moment it is touched; OK is a no-op that closes the row (or,
   * with Keep open ticked, leaves it showing), and Cancel restores the owned
   * facets the row changed. `paramsDirty` reports only whether Cancel has
   * anything to undo -- it never means "unsaved", because values are always
   * applied. Optional so a caller that mounts the strip outside the card
   * (none today) still renders.
   */
  onOk?: () => void; onCancel?: () => void; paramsDirty?: boolean;
  /**
   * The Left toolbar switch (spec 2026-09-24, D8): whether the drawing rail is
   * hidden for THIS card. `checked` shows the rail, so the box is checked when
   * `railHidden` is false. Written through the chart's own patch path; the
   * tool state and drawings live in the renderer and are untouched.
   */
  railHidden: boolean; onRailHidden: (hidden: boolean) => void;
  /**
   * The card's group context for the row's three group chips (spec
   * 2026-09-25, F). Optional so the strip still renders in isolation (its own
   * tests build it without a card). Symbol reuses GroupLink -- it is a declared
   * parameter, so its group binds and applies today with no new mechanism, and
   * F adds only this indicator. Range and Interval use ChartGroupChip, whose
   * group binds the reserved chart-state facet `chart.range` / `chart.interval`
   * (F2/F3). `chartRangeValue` is the encoded current range that seeds a new
   * Range group; `interval` (already a prop) seeds a new Interval group.
   */
  card?: DashboardCard;
  groups?: ParamGroup[];
  groupsDisabled?: boolean;
  symbolParam?: Pick<WidgetParam, "paramName" | "type" | "groupType" | "label">;
  symbolValue?: string;
  /**
   * The `macro` parameter and its current value, for the group chip in the
   * Layout caption. Like `symbol` and unlike range/interval, `macro` is a
   * DECLARED widget parameter, so it groups through the ordinary GroupLink with
   * no new mechanism -- ChartGroupChip is only for the reserved chart facets.
   */
  macroParam?: Pick<WidgetParam, "paramName" | "type" | "groupType" | "label" | "options">;
  macroValue?: string;
  /**
   * The Layout group that owns this card's arrangement ("Layout · DJIA"), or
   * undefined. While set the layout editors are read-only, and say why.
   */
  layoutLockedBy?: string;
  /**
   * The chart's `source` parameter (owner, 2026-09-28: "move the source in
   * between Symbol and Interval"). It used to reach the generic parameter
   * editor as the one field the chart did not consume, and so drew on its
   * own line under Symbol; this strip owns it now, exactly as it owns
   * `macro`, and WidgetCard omits it from the editor. Same shape as
   * `macroParam`: the options are the widget's, the chip is the card's.
   */
  sourceParam?: Pick<WidgetParam, "paramName" | "type" | "groupType" | "label" | "options">;
  sourceValue?: string;
  /**
   * Applying a backend macro, which is the OTHER half of the Layout select
   * (user, 2026-09-26: "the dropdown in Layout should be displaying
   * <Chart Specific> or the macros -- there should not be a separate Macros
   * dropdown"). The reference has exactly one control here and it is the macro
   * one: `<select id="macro" aria-label="Load a saved macro">` under the
   * "Layout / Optional saved macro" caption (app/index.html:152).
   *
   * Writes the `macro` PARAMETER; the renderer expands it into this card's own
   * series and panels and then clears the parameter back to "none", so the
   * select falls back to the current-state option. That is the documented
   * behaviour of a macro, not a bug: "a macro is a starting point, not a mode"
   * (help/guide/arts-charts.md, Macros).
   */
  onApplyMacro?: (value: string) => void;
  /** Writes the `source` parameter; a select is committed as it changes, like the Layout select. */
  onSource?: (value: string) => void;
  /**
   * The card is narrower than NARROW_WIDTH, measured by the renderer's
   * ResizeObserver. The row carries it as `data-narrow` on its OWN root: the
   * flag used to live only on `.arts-charts`, but this row is handed UP to
   * WidgetCard through `controlsSlot` and renders outside that element, so
   * rules scoped to `.arts-charts[data-narrow]` could never reach it.
   */
  narrow?: boolean;
  chartRangeValue?: string;
  /**
   * Live counts for the Series/Panels badges (spec 2026-09-25, J18); aria-hidden,
   * so they never change a button's name. The renderer derives them from the
   * arrays it actually draws (its effective series list and panel defs), not
   * from a literal or the raw card, so the badge can never disagree with the
   * chart. Optional so a caller that mounts the strip without the renderer (the
   * tests do) simply shows no badge rather than "0".
   */
  seriesCount?: number;
  panelCount?: number;
}) {
  const { GroupLink } = getHost().components;
  const [specOpen, setSpecOpen] = useState(false);
  // Generated, not the literal "adj-hint": two chart cards on one dashboard
  // both render this strip, and a duplicated id points both buttons'
  // description at whichever hint the document happens to hold first.
  const adjHint = useId();
  /**
   * The tools row's hints: `data-tip` draws them at once on hover or focus
   * (`[data-tip]` in styles.css), the span is their `aria-describedby`. The
   * pair replaces `title`, which shows only after a second's rest and cannot
   * coexist with a drawn hint without showing twice. ADJ keeps its own span
   * above; the rest share this id.
   */
  const tip = useId();
  const hint = (key: string, text: string) => ({
    props: { "data-tip": text, "aria-describedby": `${tip}-${key}` },
    node: <span id={`${tip}-${key}`} className="chart-sr-only">{text}</span>,
  });
  /* The group this card's RANGE is linked to, or undefined when it is linked to
     none — read through the same `groupFor` every other grouped control uses, so
     the pill cannot disagree with the chips below it (spec 2026-09-25, J18). */
  const rangeGroup = card !== undefined ? groupFor(card, groups, CHART_RANGE) : undefined;
  /**
   * The backend macros offered in the Layout select. `none` is the parameter's
   * "no macro" placeholder -- the state the card returns to after one is
   * applied -- and `layoutMatch` already shows that state, so it is not an
   * option anyone needs to pick.
   */
  const macros = (macroParam?.options ?? []).filter((o) => o.value !== "" && o.value !== "none");

  return (
    <div className="chart-params" data-narrow={narrow ? "true" : undefined}>
      {/* Reference layout (reference-css/toolbar-and-widget.css `.editor`): the
          Parameters row is a two-column grid -- the parameters in column 1
          (`.chart-params-fields`, the reference's `.parameters`) and a fixed
          actions column in column 2 (`.chart-params-actions`, its `.actions`).
          Column 1 groups the fields in the two `.chart-params-line` divs of
          spec 2026-09-24 D3 -- the command cluster (Interval, Range, Session),
          then the chart's tools (Layout, ADJ, spec, snapshot, Left toolbar) --
          but they are NO LONGER two hard rows: styles.css gives them
          `display: contents` and wraps the fields as one row, so Layout rolls
          up beside Session on a card wide enough to hold it (user,
          2026-09-26). The divs remain the reference's grouping and the D3
          order test's handle. The transaction (status, Keep open, Cancel/OK) no longer
          trails line 2 -- it moved into the actions column below, where the
          reference puts it. */}
      <div className="chart-params-fields">
      <div className="chart-params-line">
      {/* The captioned, read-only Symbol field (spec 2026-09-25, J16).
          J closeout (2026-09-26, point 2): DELIBERATE DEVIATION from the reference
          mockup, on the user's explicit instruction ("move the symbol to the top
          row far left"). The reference (screenshot 01) puts Symbol in row 2,
          column 2; the user wants it FIRST on line 1, before Interval. A later
          reader comparing against the mockup should not "fix" this back.
          Otherwise unchanged from J16: it is a REFLECTION, not a second editable
          ticker -- the editable symbol stays in the chart Header as the single
          source of truth, and the reference's own `.symbol-parameter-value` holds
          a <strong> + a <span> with NO input. The value line renders whenever the
          symbol parameter is known; the GroupLink chip needs the card's group
          context, so it renders only when a card is supplied. */}
      {symbolParam ? (
        <div className="chart-field chart-symbol-field">
          {/* NOT aria-hidden, unlike the group captions: this caption labels a
              static value region, not a control that already names itself, so it
              is safe to announce and doubles no name. The GroupLink beside it has
              its own "Group Symbol" accessible name, distinct from this word. */}
          <span className="chart-header-label">Symbol</span>
          {/* Read-only reflection: content with no role, so a screen reader reads
              the static ticker and never a second editable field.
              The mockup's "This widget only" scope note is GONE (user,
              2026-09-27): it took the width a long ticker needs, and
              "BTC-USD" was wrapping onto two lines beside it. The scope it
              described is not lost -- the group chip beside this field says
              whether the symbol is linked, and says it operably. */}
          <span className="chart-control-row">
            {card ? (
              <GroupLink
                card={card}
                param={symbolParam}
                groups={groups}
                groupsDisabled={groupsDisabled ?? false}
                value={symbolValue ?? ""}
              />
            ) : null}
            <div className="chart-symbol-value">
              <strong>{symbolValue ?? ""}</strong>
            </div>
          </span>
        </div>
      ) : null}
      {/* Source, between Symbol and Interval (owner, 2026-09-28). The caption
          is aria-hidden because the select names itself "Source" -- the
          Interval/Range/Session pattern -- and the chip rides in the control
          row beside it, as the Layout field's does. Its own class, not
          `chart-range-select`: that one is the NARROW-card Range mirror and is
          `display: none` at full width -- borrowing it drew a caption with no
          control under it (measured, 2026-09-28). */}
      {sourceParam ? (
        <div className="chart-field chart-source-field">
          <span className="chart-header-label" aria-hidden="true">Source</span>
          <span className="chart-control-row">
            {card ? (
              <GroupLink
                card={card}
                param={sourceParam}
                groups={groups}
                groupsDisabled={groupsDisabled ?? false}
                value={sourceValue ?? ""}
              />
            ) : null}
            <select
              className="chart-source-select"
              aria-label="Source"
              value={sourceValue ?? ""}
              onChange={(e) => onSource?.(e.target.value)}
            >
              {(sourceParam.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </span>
        </div>
      ) : null}
      {/* The Interval group is named by its own aria-label below (D2/D3): the
          visible label, the accessible name and the card's `interval`
          parameter all say the same word, so this span stays aria-hidden to
          avoid doubling the name -- same pattern as Range and Session. Each
          group is wrapped in a `.chart-field` (reference `.field`) so its
          caption stacks ON TOP of the control instead of sitting inline beside
          it. */}
      <div className="chart-field">
      {/* J closeout (2026-09-26, point 5): DELIBERATE DEVIATION from the reference
          mockup, on the user's explicit instruction ("chips should sit next to the
          labels (interval, range)"). The reference right-aligns each field's group
          chip across the caption line (its `.label-line { justify-content:
          space-between }`); the user wants the operable group chip IMMEDIATELY
          BESIDE the caption word instead, so this uses a gap, not space-between,
          and no 112px alignment slot. A later reader comparing against screenshots
          01/04 should not "fix" this back to the reference. The chip was in the
          detached `.chart-group-links` strip below -- the "random group chips" the
          user reported as not near what they group; it moved here, it did not
          duplicate (the strip is gone). The word stays aria-hidden so it does not
          double the segmented group's own aria-label="Interval"; the chip is a
          SIBLING of that hidden span, not a child, so its "Group Interval"
          accessible name stays in the tree. Rendered only when the card's group
          context is supplied (the strip's own tests mount without one). */}
      <span className="chart-header-label" aria-hidden="true">Interval</span>
      {/* The group chip leads the CONTROL row, not the caption (user,
          2026-09-26: "put the group chips on the same row as the buttons and
          the fields, on the left before the buttons and fields"). It used to
          ride beside the caption word; it is the same operable chip either
          way, and it stays a SIBLING of the aria-hidden label so its own
          "Group …" name survives. */}
      <span className="chart-control-row">
        {card ? (
          <ChartGroupChip
            card={card}
            groups={groups}
            groupsDisabled={groupsDisabled ?? false}
            paramName={CHART_INTERVAL}
            label="Interval"
            value={interval}
          />
        ) : null}
      {/* The interval group with its Custom… box (spec 2026-09-25, G8). The
          chips render `intervalLabel(iv)` -- the interval's own name for the
          range's `shownAs` mapping, so `5m` reads `5min`. `customInterval` is
          true when the current value is none of the chips: then no chip is
          lit and the Custom… chip is pressed and reads the value's label, so
          the strip still shows what the chart is on. */}
      <span className="chart-popover-anchor">
        <div className="chart-segmented" role="group" aria-label="Interval">
          {intervals.map((iv) => (
            <button key={iv} type="button" aria-pressed={interval === iv} onClick={() => onInterval(iv)}>{intervalLabel(iv)}</button>
          ))}
          {/* The aria-label is CONDITIONAL, and that is the whole point of it
              (spec 2026-09-25, G8). In the placeholder state this button's text
              is "Custom…" -- the same words as the Range group's own Custom…
              button, so with no label the two are one accessible name apart in a
              flat screen-reader list (a rotor or elements list, where the
              enclosing group is not announced) and a user hears "Custom…" twice
              with nothing to tell them apart. The narrow range control at the
              bottom of this file already solves its half the same way, with
              aria-label="Custom range…", so this matches that vocabulary
              exactly rather than inventing a second one.
              But once a CUSTOM value is live the button's text IS the value's
              label ("90min"), which is the feature -- the strip showing what the
              chart is actually on. A static aria-label would override that text
              and silently take the feature away from exactly the users it was
              added for, so the label is dropped in that state and the live text
              speaks for itself. */}
          <button
            type="button"
            aria-pressed={!intervals.includes(interval)}
            aria-expanded={intervalOpen}
            aria-label={intervals.includes(interval) ? "Custom interval…" : undefined}
            title="Custom interval — a bar size the chips do not offer"
            onClick={() => onCustomInterval(!intervalOpen)}
          >
            {intervals.includes(interval) ? "Custom…" : intervalLabel(interval)}
          </button>
        </div>
      </span>
      </span>
      {/* J closeout (2026-09-26, item 4): the interval's Custom… box is a native
          modal <dialog> now (IntervalPopover), not an anchored popover, so it is
          mounted directly here while `intervalOpen` rather than through
          <Popover>. It centres and dims itself via showModal(), so it sits
          outside the `.chart-popover-anchor` -- the anchor only mattered to the
          popover's outside-click boundary, which the modal no longer needs. */}
      {intervalOpen ? intervalChildren : null}
      </div>
      {/* Range as a `.chart-field` (reference `.field`): the "Range" caption
          stacks above the chips, where the retired `.chart-header-row` (a flex
          ROW) had it inline beside them. */}
      <div className="chart-field">
      {/* The Range group pill (spec 2026-09-25, J18). It names the GROUP this
          card's range is linked to, and renders nothing when it is linked to
          none -- the same thing the Symbol field's indicator says in words.
          That is what the reference shows: its mockup card is linked to a group
          someone named "Market window", so the pill reads "Market window". It
          is the group's NAME, not a description of the range.
          Task 10 caught this as a three-way disagreement: the code had the
          literal string "Market window" HARDCODED, J18's own text called it
          "the active range's label", and the reference meant neither. A
          hardcoded name is the worst of the three -- a card in no group still
          announced one, so the row asserted a link that did not exist.
          aria-hidden because the operable state lives on the group chips
          below; this is the visual echo of it, not a second control. */}
      {/* J closeout (2026-09-26, point 5): the same DELIBERATE DEVIATION as
          Interval (user: chips beside the labels, not the reference's right-aligned
          `.label-line`). The operable Range group chip sits beside the caption
          word. The aria-hidden `chart-range-pill` name echo stays inside the hidden
          label -- it is aria-hidden itself and renders nothing when the range is
          linked to no group, so an ungrouped card announces none (the hardcoded-name
          defect fixed earlier stays fixed). The chip is a SIBLING of the hidden
          label, so "Group Range" stays accessible. */}
      <span className="chart-header-label" aria-hidden="true">
        Range
        {rangeGroup !== undefined ? <span className="chart-range-pill" aria-hidden="true">{rangeGroup.name}</span> : null}
      </span>
      {/* The group chip leads the CONTROL row, not the caption (user,
          2026-09-26: "put the group chips on the same row as the buttons and
          the fields, on the left before the buttons and fields"). It used to
          ride beside the caption word; it is the same operable chip either
          way, and it stays a SIBLING of the aria-hidden label so its own
          "Group …" name survives. */}
      <span className="chart-control-row">
        {card ? (
          <ChartGroupChip
            card={card}
            groups={groups}
            groupsDisabled={groupsDisabled ?? false}
            paramName={CHART_RANGE}
            label="Range"
            value={chartRangeValue ?? ""}
          />
        ) : null}
      <span className="chart-popover-anchor">
        {/* J closeout (2026-09-26, point 3; user: "range should be displayed as
            mutually exclusive the same as interval"): Range is the SAME
            `.chart-segmented` control Interval uses, not the free-standing
            `.chart-chips` pills it was. One bordered block, buttons joined, the
            selected member filled in the accent -- so the four options read as
            one mutually-exclusive set exactly like the Interval group above.
            `chart-range-chips` stays on the element only so the narrow-card rule
            (`.arts-charts[data-narrow] .chart-range-chips { display:none }`) can
            still swap it for the select mirror below. */}
        <div className="chart-segmented chart-range-chips" role="group" aria-label="Range">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.label} type="button" aria-pressed={preset === p.label}
              aria-disabled={rangeFixed || undefined}
              title={rangeFixed ? "set by the card's start/end" : undefined}
              onClick={() => { if (!rangeFixed) onPreset(p.label); }}
            >
              {shownAs(p.label)}
            </button>
          ))}
          <button type="button" aria-pressed={preset === "Custom"} aria-expanded={rangeOpen} title="Custom range — pick a start and end" onClick={() => onCustomRange(!rangeOpen)}>Custom…</button>
        </div>
        {/* The chips' mirror for a narrow card (spec §15 criterion 10); CSS shows one or the other.
            The select only ever PICKS a preset: "Custom" and the no-range
            placeholder are disabled options, there to show the state the
            chips show by lighting a chip. A select cannot reopen a popover
            it is already showing as its value, so Custom… is the button
            beside it instead. */}
        <select
          className="chart-range-select" aria-label="Range" value={preset ?? ""}
          disabled={rangeFixed}
          title={rangeFixed ? "set by the card's start/end" : undefined}
          onChange={(e) => onPreset(e.target.value as "1D" | "5D" | "1M")}
        >
          <option value="" disabled>Range…</option>
          {RANGE_PRESETS.map((p) => <option key={p.label} value={p.label}>{shownAs(p.label)}</option>)}
          <option value="Custom" disabled>Custom</option>
        </select>
        <button type="button" className="chart-range-custom" aria-label="Custom range…" aria-expanded={rangeOpen} title="Custom range — pick a start and end" onClick={() => onCustomRange(!rangeOpen)}>…</button>
      </span>
      </span>
      {/* J closeout (2026-09-26, item 4): the range Custom… box is a native modal
          <dialog> now (RangePopover), not an anchored <Popover>, so it is mounted
          directly here while `rangeOpen` -- exactly as the interval Custom… box is
          mounted above. It centres and dims itself via showModal(), so it lives
          outside the `.chart-popover-anchor` the old popover needed for its
          outside-click boundary. */}
      {rangeOpen ? rangeChildren : null}
      </div>
      {/* ponytail: no narrow-card mirror for this control -- two short words
          fit where the three range chips did not. Upgrade path: the same
          select-and-button pattern as the range, if a narrow card wraps. */}
      {exchange === null ? null : (
        <div className="chart-field">
          {/* Reference layout (reference-css/toolbar-and-widget.css `.field`):
              the "Session" caption stacks ON TOP of the pill, the same as
              Interval and Range. It previously rode INSIDE the pill's border
              (`.chart-session-key`) so the two-word toggle read as one control;
              the reference is the layout authority for this task and moves it
              out to a caption above, so that inline-key placement is
              superseded. The span stays aria-hidden -- the group's own
              aria-label="Session" already names it, so a visible name would
              double it (same reason as Interval and Range). */}
          <span className="chart-header-label" aria-hidden="true">Session</span>
          {/* J closeout (2026-09-26, point 3 addendum; user: "session choice
              should look like interval"): Session is the SAME `.chart-segmented`
              control Interval and Range use, not the `.chart-session` inset pill
              it was -- one bordered block with the active mode filled in the
              accent. The three buttons keep their dynamic "Regular · {exchange}"
              label and their per-mode `title` explanations (the only place those
              live), and their `aria-pressed` semantics are untouched: only the
              container's visual language changed. Session has no narrow-card
              mirror (the ponytail note above the field), so nothing else moves. */}
          {/* The Session group chip leads the control row, exactly as Interval's
              does (user, 2026-10-01: group interval, range, session and Macro). */}
          <span className="chart-control-row">
          {card ? (
            <ChartGroupChip
              card={card}
              groups={groups}
              groupsDisabled={groupsDisabled ?? false}
              paramName={CHART_SESSION}
              label="Session"
              value={session}
            />
          ) : null}
          <div className="chart-segmented" role="group" aria-label="Session">
            {/* Regular first (user ruling 2026-09-24): narrowest window to
                widest, left to right. */}
            <button type="button" aria-pressed={session === "regular"} title={`Only the bars inside ${exchange}'s regular session, with every study computed on it`} onClick={() => onSession("regular")}>Regular · {exchange}</button>
            <button type="button" aria-pressed={session === "extended"} title="Every bar the tick plane has, pre-market and after-hours included" onClick={() => onSession("extended")}>Extended</button>
            {/* v12.4.0. Distinct from Extended, which is still a SESSION --
                the venue's pre/after window. 24hr is the calendar day itself,
                which is the right reading where trading never stops: crypto,
                FX, and any venue whose extended window the calendar does not
                know. Nothing is filtered, because the filter keys off
                `session === "regular"` alone.

                It is also what @SOD / @EOD read as midnight-to-midnight. */}
            <button type="button" aria-pressed={session === "24hr"} title="The whole calendar day: nothing filtered" onClick={() => onSession("24hr")}>24hr</button>
          </div>
          </span>
        </div>
      )}
      </div>
      <div className="chart-params-line">
      {/* The Layout list (spec 2026-09-24, D9): Default and every saved layout,
          plus a Custom option shown as the value when the card matches none.
          A select, like the narrow-card Range mirror: choosing a name applies
          that layout; Custom is a disabled value, there only to show the state
          the control is in, never a thing to choose. */}
      {/* Layout as a `.chart-field` (reference `.field`): its "Layout" caption
          stacks above the select, like the other groups. Moved ahead of the
          chart tools (spec 2026-09-25, J17): grouping ADJ / { } / Snapshot /
          Left toolbar under one "Chart tools" caption needs them contiguous,
          and the reference orders the Layout group before the Chart-tools group
          anyway.
          J closeout (2026-09-26, item 1; reference-css/toolbar-and-widget.css
          `.field`, screenshots 01/04): the Series and Panels openers now live
          IN this Layout field, in Series-then-Panels order -- the reference
          captions them "Layout" and lists Series first, where the build had them
          under "Chart tools" in Panels-then-Series order. Line 2's button order
          is therefore Series, Panels (here), then ADJ, { }, Snapshot (Chart
          tools). Their J18 count badges move with them and stay real
          aria-hidden spans, so the accessible names stay "Series"/"Panels". */}
      {/* This is a `<div>`, not a `<label>` (item 1): a <label>'s implicit
          target is a single form control, so a label that wrapped the select AND
          two buttons was invalid and a real a11y hazard -- the buttons are not
          the caption's control. The select names itself with aria-label="Layout"
          below, so dropping the label wrapper costs it no accessible name. */}
      <div className="chart-field chart-layout-pick">
        {/* The "/ Macro" hint: the reference captions the Layout field
            "/ Optional saved macro" (spec 2026-09-25, J18); the user shortened it
            to "/ Macro" (2026-09-26). It rides INSIDE the aria-hidden
            caption span as a lighter <em>, so it adds no accessible name of its
            own (the select names itself with aria-label="Layout" below). */}
        <span className="chart-header-label chart-layout-caption" aria-hidden="true">
          <span>Layout <em className="chart-field-hint">/ Macro</em></span>
          {/* This is the GROUP CHIP, not a drag grip (user, 2026-09-26: "those
              vertical bars are supposed to be the group chip"). I had read the
              glyph in the reference crop as a decorative handle and rendered a
              dead span; it is the same operable link Interval, Range and Symbol
              carry, and its vertical bars are just how the chain glyph draws.
              It also restores what omitting `macro` from the generic parameter
              row took away: the macro CAN still be grouped across cards, from
              here, which is where the reference puts the control anyway. */}
        </span>
        {/* The macro select and the two openers sit on ONE row under the caption
            (reference screenshot 01: the "Layout" caption tops a row of [Default ▾]
            · Series · Panels). `.chart-field` stacks its children in a column, so
            the row needs its own flex wrapper -- without it the select and the two
            buttons would stack vertically instead of reading left-to-right. */}
        <span className="chart-control-row">
        {/* The Layout chip (user, 2026-10-01: "the macro is supposed to be the
            DJIA macro"): groups the SAVED LAYOUT this select shows, so a pick on
            any member switches them all. Offered only when the card's arrangement
            IS a saved layout (or the card is already in a Layout group) -- a
            "<Chart Specific>" arrangement has no name to group by. */}
        {card && (layouts.includes(layoutMatch) || groupFor(card, groups, CHART_LAYOUT)) ? (
          <ChartGroupChip
            card={card}
            groups={groups}
            groupsDisabled={groupsDisabled ?? false}
            paramName={CHART_LAYOUT}
            label="Layout"
            value={layoutMatch}
          />
        ) : null}
        {/* The backend Macro parameter's chip, kept only for a card already in a
            Macro group: a macro applies once and resets to "none", so grouping it
            moved nothing, and the Layout chip above is what this control groups. */}
        {card && macroParam && groupFor(card, groups, macroParam.paramName) ? (
          <GroupLink
            card={card}
            param={macroParam}
            groups={groups}
            groupsDisabled={groupsDisabled ?? false}
            value={macroValue ?? ""}
          />
        ) : null}
        <div className="chart-layout-controls">
        {/* ONE dropdown, carrying both kinds of macro (user, 2026-09-26). The
            reference has a single control here -- `<select id="macro">`, "Load a
            saved macro" -- and the build had the backend's Macro parameter as a
            SECOND select in the generic parameter row, which is the duplicate
            the user reported.

            The two lists are genuinely different things and both have to stay
            reachable: a saved LAYOUT is this app's own library entry, applied
            straight onto the card; a MACRO is a pane layout the backend ships,
            applied by writing the `macro` parameter and letting the server
            expand it. They also share a namespace -- nothing stops a saved
            layout being called "Classic Momentum" too -- so the values are
            prefixed and the groups labelled, rather than flattened into one
            list where the same word would mean two different actions. With
            only one list populated the <optgroup> is dropped and it reads as
            the plain list it is.

            `layoutMatch` ("<Chart Specific>" when the card matches nothing)
            stays the shown value and stays `disabled`: it is the state the card
            is in, never an action. */}
        <select
          className="chart-layout-select"
          aria-label="Layout"
          value={layouts.includes(layoutMatch) ? `layout:${layoutMatch}` : layoutMatch}
          onChange={(e) => {
            const picked = e.target.value;
            if (picked.startsWith("macro:")) onApplyMacro?.(picked.slice("macro:".length));
            else if (picked.startsWith("layout:")) onApplyLayout(picked.slice("layout:".length));
          }}
        >
          {!layouts.includes(layoutMatch) && <option value={layoutMatch} disabled>{layoutMatch}</option>}
          {macros.length === 0
            ? layouts.map((name) => <option key={name} value={`layout:${name}`}>{name}</option>)
            : (
              <>
                {layouts.length > 0 && (
                  <optgroup label="Saved layouts">
                    {layouts.map((name) => <option key={name} value={`layout:${name}`}>{name}</option>)}
                  </optgroup>
                )}
                <optgroup label="Macros">
                  {macros.map((o) => <option key={o.value} value={`macro:${o.value}`}>{o.label}</option>)}
                </optgroup>
              </>
            )}
        </select>
        {/* "Edit layout" (reference crop, user 2026-09-26). Previously declined as
            redundant with the Series and Panels openers; the user overruled that
            with "we should be looking like the screenshot". No invented
            behaviour: it opens the same editor on its default tab, where Series
            and Panels open it on theirs. */}
        <button type="button" className="chart-editlayout-button" disabled={layoutLockedBy !== undefined} title={layoutLockedBy ? `The layout comes from group ${layoutLockedBy} — unlink to edit` : "Edit this card's layout"} onClick={() => onOpenLayout("panels")}>Edit layout</button>
        {/* The Series opener (moved here in item 1), FIRST -- the reference lists
            Series before Panels. Both this and Panels open the one Layout editor
            (spec 2026-09-24, C/Task 6): no popover of their own, just the opener,
            the editor is mounted once at the renderer's top level. */}
        <span className="chart-popover-anchor">
          {/* The icon and the key badge are both decorative: the button's
              accessible name stays the single word "Series" -- what the
              palette places has not been studies alone since v12.4.0. The
              title and the `I` shortcut are unchanged. */}
          {/* Plain text + count, matching the reference crop the user supplied
              (2026-09-26): no leading icon and no `I` key badge -- the reference
              row is `[Default v] Edit layout  Series 4  Panels 2`. The `I`
              shortcut itself is unchanged and still named in the title.
              The count stays an aria-hidden DOM span, never CSS ::before:
              AccName counts generated content and jsdom does not evaluate it, so
              the accessible name stays exactly "Series". */}
          <button type="button" className="chart-studies-button" aria-expanded={layoutTab === "series"} disabled={layoutLockedBy !== undefined} title={layoutLockedBy ? `The layout comes from group ${layoutLockedBy} — unlink to edit` : "Studies — I. Add, order and edit the indicators on this card"} onClick={() => onOpenLayout("series")}>
            Series
            {seriesCount !== undefined && <span className="chart-count" aria-hidden="true">{seriesCount}</span>}
          </button>
        </span>
        {/* The Panels opener (moved here in item 1), SECOND. */}
        <span className="chart-popover-anchor">
          {/* aria-hidden so the name stays "Series"/"Panels" (spec J18; audit
              constraint) while the count shows the live figure. AccName includes
              generated content, so this is a real DOM span, never a CSS ::before. */}
          <button type="button" className="chart-panels-button" aria-expanded={layoutTab === "panels"} disabled={layoutLockedBy !== undefined} title={layoutLockedBy ? `The layout comes from group ${layoutLockedBy} — unlink to edit` : "Panels — this card's panel layout"} onClick={() => onOpenLayout("panels")}>Panels{panelCount !== undefined && <span className="chart-count" aria-hidden="true">{panelCount}</span>}</button>
        </span>
        </div>
        </span>
      </div>
      {/* J closeout (2026-09-26, point 2): the Symbol field moved OUT of here (it
          was line 2, column 1 area) to the far left of line 1 -- see the deviation
          note at the top of line 1. This keeps the two-line grouping otherwise
          intact: line 2 is now Layout then Chart tools. */}
      {/* Chart tools (spec 2026-09-25, J17): ADJ, the { } spec button, Snapshot
          and the Left toolbar switch, grouped under a stacked aria-hidden
          caption the way Interval / Range / Session already caption their
          groups. Layout only -- no control's role, name or aria changes.
          J closeout (2026-09-26, item 1): the Series and Panels openers moved
          OUT of this group into the Layout field above -- the reference captions
          them "Layout", not "Chart tools" -- so this group is ADJ, { }, Snapshot
          (and the Left toolbar switch) now. The D3 order test was retargeted to
          match (item 3): Series before Panels inside the Layout field, and
          [ADJ, { }, Snapshot] here. */}
      <div className="chart-field">
      <span className="chart-header-label" aria-hidden="true">Chart tools</span>
      <div className="chart-tools-row">
      {/* J closeout (2026-09-26, point 6; user: ADJ / { } / Snapshot "are not the
          same size or layout as the screenshot"): ADJ moved INTO `.chart-actions`
          with the { } spec button and Snapshot, so all three share the ONE rule
          that sizes and fills them. ADJ was a bare `.chart-tools-row` button with
          no sizing rule -- it rendered at the browser default height while the
          other two were fixed squares -- which is the mismatch the user reported.
          They are one padded, soft-filled set now (reference `.tools button`). ADJ
          is still a direct toggle (no settings gear), and the { } popover keeps its
          leftward `right: 0` anchor scoped to `.chart-actions`. */}
      <div className="chart-actions">
      {/* ADJ (v12.2's header control, later the settings gear's) is a direct
          toggle now -- there is no gear any more, only the strip. */}
      <button type="button" aria-pressed={adjusted} aria-describedby={adjHint} data-tip={ADJ_HINT} onClick={() => onAdjusted(!adjusted)}>ADJ</button>
      {/* Final review fix, 2026-09-24: this hint used to sit inside the
          Settings popover, where `.chart-popover-preview`'s visible muted
          text was fine. It is now a bare child of the always-open strip, so
          it needs `.chart-sr-only` to stay out of the visible layout while
          `aria-describedby` still reaches it for screen readers. */}
      <span id={adjHint} className="chart-popover-preview chart-sr-only">{ADJ_HINT}</span>
      <span className="chart-popover-anchor">
        {/* A plain toggle: Popover treats the whole `.chart-popover-anchor`
            as inside, so the press on this button no longer closes the
            popover behind our back before the click reopens it. */}
        <button type="button" className="chart-mono" aria-expanded={specOpen} {...hint("spec", "The chart as a JSON spec").props} onClick={() => setSpecOpen((o) => !o)}>{"{ }"}</button>{hint("spec", "The chart as a JSON spec").node}
        <Popover open={specOpen} label="Chart spec" onClose={() => setSpecOpen(false)}>
          <SpecPopover json={specJson} onApply={onApplySpec} onClose={() => setSpecOpen(false)} />
        </Popover>
      </span>
      {/* Icon button (the mockup's camera); the name is the aria-label. */}
      <button type="button" aria-label="Snapshot" {...hint("snapshot", "Snapshot — Ctrl+S. Save the chart as a PNG").props} onClick={onSnapshot}>
        <svg className="chart-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3.5" width="12" height="9.5" rx="1.5" /><circle cx="8" cy="8.2" r="2.4" /><path d="M5.5 3.5l.8-1.5h3.4l.8 1.5" /></svg>
      </button>{hint("snapshot", "Snapshot — Ctrl+S. Save the chart as a PNG").node}
      {/* The Left toolbar toggle (spec 2026-09-24, D8).
          J closeout (2026-09-26, point 6 addendum): DELIBERATE DEVIATION from the
          reference mockup, on the user's instruction ("replace the left toolbar
          checkbox with a toggle like ADJ, try to find a toolbox icon ... like the
          camera icon for snapshot"). The reference shows a real switch with a
          visible "Left toolbar" label (`.toolbar-visibility`, with knob styling);
          the user wants a fourth icon button in the same uniform set as ADJ / { } /
          Snapshot. A later reader comparing against the mockup should not revert it.
          `aria-pressed` tracks the SAME state the checkbox's `checked` did -- pressed
          means the rail is SHOWN, so it reads `!railHidden` and a press flips
          `railHidden`. The name moves from the visible text to `aria-label` (the
          icon carries no text), and a `title` keeps the pointer affordance. The
          icon is authored here in the camera's hand-drawn 16x16 style -- original
          geometry, not copied from any icon set, so its licensing is unambiguous.

          It is a LEFT-PANEL glyph (a frame, a divider near the left edge, two
          ticks for the rail's tools), not the toolbox the user first asked for.
          The toolbox was built and rejected on sight: at 16px a box with a handle
          arc over it reads as a WRAPPED PRESENT, and adding a latch only made the
          bow more convincing. This shape says what the control does -- show or
          hide the panel down the left side -- and it is the convention a reader
          already knows from editors, so it survives being 16 pixels tall in a way
          a literal toolbox cannot. */}
      <button type="button" aria-pressed={!railHidden} aria-label="Left toolbar" {...hint("rail", "Left toolbar — show or hide the drawing rail").props} onClick={() => onRailHidden(!railHidden)}>
        <svg className="chart-icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path d="M6 3v10" />
          <path d="M3.4 6.3h1.3" />
          <path d="M3.4 9.7h1.3" />
        </svg>
      </button>{hint("rail", "Left toolbar — show or hide the drawing rail").node}
      {/* What the chart shows above the plot (user, 2026-09-27: "we need to
          change the display study values and Display series pills to icons like
          chart tools"). These were two ticked checkboxes in the actions column,
          where Keep open used to sit; they are icon toggles in this group now,
          beside the Left toolbar switch they belong with -- all three answer
          "what is on screen", and all three carry `aria-pressed`, so pressed
          means SHOWN exactly as a ticked box did. The visible words move into
          `aria-label`, which keeps each control's accessible name the same
          string the checkbox had, and a `title` gives the pointer the same
          sentence.

          Both glyphs are authored here in the pack's 16x16 line style --
          original geometry, not traced from any icon set, so their licensing
          is unambiguous the way the Snapshot and Left-toolbar icons already
          are. (Material Symbols' `legend_toggle` is Apache-2.0 and would have
          been usable with a NOTICE entry; drawing two shapes was cheaper than
          taking on an attribution obligation for them.)

          Study values: the dashed crosshair line, a dot where it meets a
          series, and the value box that reading fills -- which is what the
          readout IS. Series pills: two rounded pills of unequal length, each
          with its series' colour dot, which is literally what the legend above
          the plot is. Both were drawn twice: the first study-values glyph put
          the box ON the line and read as a capsule, and the first pills glyph
          was a 2x2 grid of four pills that merged into an "88" at 16px. Checked
          at size before shipping, which is the only way these are judged.
          Neither borrows the rail's crosshair glyph, so no two icons in the
          card read alike. */}
      <button type="button" aria-pressed={studyValues} aria-label="Display study values" {...hint("values", "Display study values — the crosshair readout under the header").props} onClick={() => onStudyValues(!studyValues)}>
        <svg className="chart-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5.5 1.5v13" strokeDasharray="2 2" opacity=".65" />
          <circle cx="5.5" cy="7" r="1.3" fill="currentColor" stroke="none" />
          <rect x="8.3" y="4.8" width="6.2" height="4.4" rx="1.2" />
        </svg>
      </button>{hint("values", "Display study values — the crosshair readout under the header").node}
      <button type="button" aria-pressed={seriesPills} aria-label="Display series pills" {...hint("pills", "Display series pills — the legend of series above the plot").props} onClick={() => onSeriesPills(!seriesPills)}>
        <svg className="chart-icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1.5" y="3.4" width="13" height="3.6" rx="1.8" />
          <circle cx="3.9" cy="5.2" r=".85" fill="currentColor" stroke="none" />
          <rect x="1.5" y="9" width="9.4" height="3.6" rx="1.8" />
          <circle cx="3.9" cy="10.8" r=".85" fill="currentColor" stroke="none" />
        </svg>
      </button>{hint("pills", "Display series pills — the legend of series above the plot").node}
      {/* Whether Snapshot puts the card's header on the PNG (owner,
          2026-09-27: "we need an option to include the chart header in the
          screenshot"). It sits beside Snapshot because it is about Snapshot
          and nothing else -- the header on screen is unaffected either way.
          The glyph is the export's own shape: a framed image with a caption
          bar across its top, which is exactly what the band is. */}
      <button type="button" aria-pressed={snapshotHeader} aria-label="Header in snapshot" {...hint("header", "Header in snapshot — put the symbol, price and change above the chart in the PNG").props} onClick={() => onSnapshotHeader(!snapshotHeader)}>
        <svg className="chart-icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
          <path d="M2 6.2h12" />
          <path d="M4.2 4.35h3.2" />
        </svg>
      </button>{hint("header", "Header in snapshot — put the symbol, price and change above the chart in the PNG").node}
      </div>
      </div>
      </div>
      {/* J closeout (2026-09-26, point 5): the detached `.chart-group-links` strip
          that held the Range and Interval chips (spec 2026-09-25, F) is gone. Those
          two chips were the "random group chips" the user reported as not being near
          what they group -- they now sit beside the Interval and Range captions
          above (chips-beside-labels deviation), each still the same GroupMenu-backed
          control that moves its whole group when clicked (F6). Symbol's chip already
          lived in its own caption (J16). Nothing here to render any more. */}
      </div>
      </div>
      {/* The actions column (reference-css/toolbar-and-widget.css `.actions`):
          the reference lifts the transaction out of the parameter lines into a
          fixed second grid column with a rule down its left edge, bottom-
          aligned. Its order is the status line, then Keep open, then the
          Cancel/OK pair -- no longer interleaved among the chart tools. */}
      <div className="chart-params-actions">
        {/* Keep open is GONE (2026-09-27): it decided whether this row came up
            showing on the next load, which the parameters control in the card's
            own title bar already governs, and the user called it redundant. The
            two display toggles that replaced it here have since moved again,
            into the Chart tools group as icon toggles (user, same day), so this
            column now holds only the transaction: the status line, then
            Cancel/OK. */}
        {/* The Parameters transaction's end (spec 2026-09-24, D9): a quiet line
            that says only whether Cancel has anything to undo -- not "unsaved",
            since D1 applies every change at once. Escape and the card's chevron
            do what Cancel does (D5); those live in the renderer and the card.
            It sits directly above Cancel/OK now (user, 2026-09-27: "move the
            changes to undo on the parameter bar close to the ok and cancel
            buttons"), where it reads as their caption. */}
        <span className="chart-params-status" aria-live="polite">
          {(paramsDirty ?? false) ? "Changes to undo" : "No changes to undo"}
        </span>
        {/* Reference `.action-buttons`: Cancel and OK share the column width,
            flex:1 each. */}
        <div className="chart-action-buttons">
          <button type="button" className="chart-params-cancel" onClick={() => onCancel?.()}>
            Cancel
          </button>
          {/* OK is the row's primary action (spec 2026-09-25, J19): the same
              accent fill the Layout editor footer's OK carries. `.primary` is
              scoped per-surface in styles.css, so `.chart-params-ok.primary`
              declares its own accent rule rather than inheriting a global one. */}
          <button type="button" className="chart-params-ok primary" onClick={() => onOk?.()}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
