// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { PendingEdit } from "./LayoutEditor";
import { getHost } from "../../../host";
import { STUDY_SWATCHES } from "../../../lib/chart/createChartTheme";
import {
  PERFORMANCE_SELF,
  panelLabel,
  parseBarSeries,
  performanceSymbol,
  SERIES_TYPE_LABELS,
  parsePerformance,
  parseStudy,
  seriesFromStudy,
  seriesId,
  seriesLabel,
  studyExpr,
  symbolAllowed,
} from "../../../lib/chart/series";
import type { PanelDef } from "../../../lib/chart/panels";
import {
  argText,
  catalogGroup,
  catalogTitle,
  defaultColor,
  instanceFromParse,
  isBusinessDays,
  normalizeExpression,
  referenceLabel,
  safeWiki,
  unifyWindows,
  type CatalogEntry,
} from "../../../lib/chart/studyExpression";
import { entryOutputs } from "../../../lib/chart/outputs";
import { FILL_PATTERNS, type FillPattern, isFillPattern, isPen, PENS, type Pen } from "../../../lib/chart/pen";
import type { ChartFavorite } from "../../../lib/chartFavoritesFile";
import type { TaRegistry } from "../../../hooks/useTaRegistry";
import type { Series, SeriesType } from "../../../lib/types";
import { anchorPreview } from "../../../lib/chart/wireAnchor";
// The item-list reuses the chip strip's reorder idiom rather than inventing a
// second one: the same drag TYPE (so a chip and an item row are the same
// payload) and the same `moveBefore` arithmetic the strip, tabs and the rail
// all share (J6, spec 2026-09-25).
import { moveBefore } from "../../../lib/dragDrop";
import { STUDY_REORDER_DRAG_TYPE } from "./StudiesStrip";

type Props = {
  catalog: CatalogEntry[];
  status: TaRegistry["status"];
  /** Everything the card already draws: the on-chart mark, and the duplicate guard. */
  active: Series[];
  /**
   * The chip under edit (the strip's double-click / Enter), or null for a
   * fresh pick. Non-null opens the palette staged on that series with its
   * params, colour, shade, width, panel and side loaded, and turns the
   * primary button from `onAdd` into `onApply`.
   */
  editing: Series | null;
  /** The card's panels, in order: what the Panel picker offers (1..n). */
  panels: PanelDef[];
  /** The card's symbol, shown as the Performance row's `$ymbol` reading. */
  symbol: string;
  /** The card's symbol list (spec 2026-11-13): the picker offers list:2 … list:n for it. Defaults to [symbol]. */
  symbols?: string[];
  /** The dashboard's symbol groups, by name: the picker offers each as $group:<Name>. */
  symbolGroups?: string[];
  onAdd: (series: Series) => void;
  onApply: (series: Series) => void;
  /** The adapter's `drawings.study` -- a token value, passed in, never a literal here. */
  fallbackColor: string;
  /**
   * v12.3.0 (slice 4): whether `SMA(50bd)` may be typed here -- true when
   * the symbol has an exchange to count sessions on, false for crypto and
   * forex, where the parser refuses it like any other non-number.
   */
  allowBusinessDays: boolean;
  /**
   * The CHART's source (v12.3.1: one source per widget, fixed by the
   * manifest entry the card was created from). An EODHD chart can only draw
   * what EODHD serves, so the list hides every catalog entry the registry
   * has no EODHD mapping for rather than offering a study that would come
   * back empty. The Price & volume group is drawn from the card's own bars
   * and is listed on both widgets.
   */
  source: "local" | "eodhd";
  onClose: () => void;
  /**
   * The "Refresh studies" control (docs/custom-studies.md, Refetch): fetch
   * the registry's catalog again, for the operator who has just uploaded a
   * study. Optional so a host with no registry to refresh shows no control.
   */
  onRefresh?: () => void;
  /**
   * Item-list select-to-edit (J6, spec 2026-09-25): the left column lists the
   * card's series, and clicking one edits it. The palette cannot edit an
   * arbitrary series on its own -- the parent's apply resolves the target by
   * ITS `editing` id (ArtsChartsRenderer's applySeries keys on `editing`, not
   * on the built series' id), so a locally-picked row would either be dropped
   * (parent editing null) or overwrite the WRONG series (parent editing set).
   * So a row click hands the id UP: the parent sets `editing`, the editor
   * remounts on it (the same channel the chip strip's double-click already
   * uses), and `build`/`commit`/`duplicate` keep reading the `editing` prop
   * unchanged. `null` is "add a fresh series" (the "+ Add series" bar).
   * Optional: any other mount of this component keeps working without it.
   */
  onEditSeries?: (id: string | null) => void;
  /**
   * Item-list drag-to-reorder (J6): the grips reorder the card's series, the
   * same within-panel reorder the chip strip does. Wired to the parent's
   * existing `reorderSeries`. Optional for the same reason.
   */
  onReorderSeries?: (ids: string[]) => void;
  /**
   * Master-detail (2026-09-26): the selected panel (1-based) the Layout editor's
   * sidebar has highlighted. When set, the item-list is SCOPED to that panel and
   * a freshly picked series defaults to it -- the pane is the detail of the panel
   * chosen on the left. The Placement > Panel dropdown is NOT scoped: it is how a
   * series is MOVED to another panel, so it keeps offering every panel. Absent
   * (any caller that does not scope, and the palette's own tests) leaves the list
   * unfiltered and the registry's default placement unchanged.
   */
  panelFilter?: number;
  /**
   * Where the Layout editor's OK reads an edit staged here but not yet
   * Updated (hand check 2026-11-14): this pane registers a reader that
   * returns the rebuilt series, or null when nothing was changed or the
   * staged edit would not commit. Optional: any other mount ignores it.
   */
  pendingEdit?: PendingEdit;
  /**
   * Favorites (spec 2026-09-26, PART C): the user's saved one-click series,
   * each ONE configured study/line with its parameters and appearance -- not a
   * bundle (that is the `Saved series…` select below). Listed as the FIRST
   * group; the checkbox beside the primary button adds the just-built series;
   * a staged favorite gets a Remove button in the checkbox's place. All three
   * are optional so every existing mount and test keeps working with none of
   * them supplied -- with no `onAddFavorite` the checkbox is hidden, with no
   * `onRemoveFavorite` the Remove button is, and with no `favorites` there is
   * no Favorites group at all.
   */
  favorites?: ChartFavorite[];
  onAddFavorite?: (series: Series) => void;
  onRemoveFavorite?: (name: string) => void;
};

/**
 * The field's placeholder when nothing is staged at all -- which the list
 * only leaves when a search matches nothing. Showing the grammar is the
 * placeholder's whole job; see `placeholder` below, which says it in terms of
 * whatever IS staged. No swatch is spelled in either (user, 2026-09-27: "dont
 * show colors as hex"): the expression parser takes a trailing one, but a raw
 * hex beside a pane that shows the colour as a swatch was read as leftover
 * state rather than as an example of the syntax.
 */
const PLACEHOLDER = "AVWAP(T@14:00)";

/**
 * The group ORDER (the layout pack's nine, replacing v12.3.0's six), not the
 * group list: which group an indicator belongs to is the registry's to say,
 * and the headers are the groups the catalog actually populates. A group the
 * registry invents that this list does not know still gets a header, after
 * the nine; "Other" -- the degraded reading for a backend that projects no
 * group at all -- is always last.
 */
const GROUP_ORDER: readonly string[] = [
  "Moving averages", "Bands & channels", "Trend", "Anchored & volume", "Session levels",
  "Momentum", "Trend strength", "Volume", "Volatility",
];

/**
 * The first group (v12.4.0, spec: Series), ahead of the registry's nine: the
 * price drawings, the volume and a performance line are series like a study
 * is, so they are picked from the same list rather than being implicit.
 */
const PRICE_GROUP = "Price & volume";
type PriceType = Exclude<SeriesType, "study">;
const PRICE_TYPES: readonly PriceType[] = ["candlestick", "ohlc", "line", "area", "volume", "performance"];
const PRICE_LABELS: Record<PriceType, string> = { ...SERIES_TYPE_LABELS, performance: "Performance" };
/** The one-line reading each row shows in the config pane, as the registry gives studies one. */
const PRICE_DESC: Record<PriceType, string> = {
  candlestick: "Open, high, low and close, as candles.",
  ohlc: "Open, high, low and close, as black-and-white bars.",
  line: "The close, as a line.",
  area: "The close, as a line over a fill.",
  volume: "Volume, as a histogram tinted by each bar's direction.",
  performance: "Percent change of the close, rebased at an anchor.",
};
/** Only these three draw in a colour of their own; the rest are the theme's. */
const COLOURED: readonly PriceType[] = ["line", "area", "performance"];
/** A performance series' defaults: the card's own symbol, three months back. */
const DEFAULT_ANCHOR = "T-3m";
/**
 * A series the THEME colours (candlesticks, OHLC bars, volume) saves no
 * colour of its own -- empty rather than a literal, which is also what
 * `migrateChart` writes and what the colour-grep guard requires.
 */
const THEME_COLOR = "";

function ordered(groups: string[]): string[] {
  return [
    ...GROUP_ORDER.filter((g) => groups.includes(g)),
    ...groups.filter((g) => g !== "Other" && !GROUP_ORDER.includes(g)).sort(),
    ...(groups.includes("Other") ? ["Other"] : []),
  ];
}

/** The registry's defaults for an entry; a param with no default (an anchor) has none to seed. */
function defaults(entry: CatalogEntry): Record<string, number | string> {
  const params: Record<string, number | string> = {};
  for (const p of entry.params) if (p.default !== null) params[p.name] = p.default;
  return params;
}

/**
 * The muted `(20, 2.0)` after a row's name: the registry's defaults, in order,
 * through `argText` -- the SAME formatter the expression pill uses, so the row
 * and the pill cannot disagree about whether BBANDS' k is `2` or `2.0`.
 */
function defaultsText(entry: CatalogEntry): string {
  const seeded = entry.params.flatMap((p) => (p.default === null ? [] : [argText(p, p.default)]));
  return seeded.length === 0 ? "" : `(${seeded.join(", ")})`;
}

/**
 * Whether one field's value is something the wire can carry (task brief,
 * §3). Everything the field accepts goes out as an expression argument, and
 * live-grid's `_coerce` raises on anything `float()` refuses -- ta_series_ws
 * then closes the socket and EVERY study on the card disappears with
 * nothing said. So the grammar is checked here rather than trusted:
 *
 * - a window param is a whole number of bars, with the `bd` unit spellable
 *   only on a card whose symbol has an exchange to count sessions on;
 * - any other integer param is a whole number -- `-5` and `1.5` are not;
 * - a float param is any finite number;
 * - a text param (an anchor) is the parser's to judge, but may not be empty;
 * - a CLEARED field is invalid in every case, which is what keeps an emptied
 *   numeric field off the wire as a `0` it never was.
 */
function paramInvalid(
  entry: CatalogEntry, p: CatalogEntry["params"][number],
  value: number | string | undefined, allowBusinessDays: boolean,
): boolean {
  const raw = String(value ?? "").trim();
  if (raw === "") return true;
  // A ticker parameter is a series reference (spec 2026-11-13 cross-symbol §5): the Symbol field's rule.
  if (entry.tickers?.includes(p.name)) return !symbolAllowed("study", performanceSymbol(raw));
  if (p.text) return false;
  if (entry.windows.includes(p.name)) return !(allowBusinessDays ? /^\d+(bd)?$/ : /^\d+$/).test(raw);
  if (p.float === true) return !Number.isFinite(Number(raw));
  return !/^\d+$/.test(raw);
}

/** The pack's eight swatches: the registry's own colour first, then the fixed seven. */
function swatchesFor(entry: CatalogEntry | undefined, fallback: string): string[] {
  const seen = new Set<string>();
  const first = entry === undefined ? fallback : defaultColor(entry, fallback);
  return [first, ...STUDY_SWATCHES].filter((color) => {
    const key = color.toLowerCase();
    if (key === "" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * One line of the list: a Price & volume row (no catalog entry) or a
 * registry study. `key` is the row's identity -- prefixed, so a registry
 * indicator called `line` could never be confused with the Line row.
 */
type Row = { key: string; type: SeriesType; name: string; entry?: CatalogEntry; favorite?: ChartFavorite };

const priceRow = (type: PriceType): Row => ({ key: `pv:${type}`, type, name: type });
const studyRow = (entry: CatalogEntry): Row => ({ key: `st:${entry.name}`, type: "study", name: entry.name, entry });
// A favorite row (spec PART C, item 2): keyed `fav:` so it can never collide
// with a `pv:` or `st:` row, with the type and name taken from the STORED
// series -- which is what seed() rebuilds the configured draft from.
const favoriteRow = (fav: ChartFavorite): Row =>
  ({ key: `fav:${fav.name}`, type: fav.series.type, name: fav.series.name ?? fav.series.type, favorite: fav });
const rowKeyOf = (s: Series): string => (s.type === "study" ? `st:${s.name ?? ""}` : `pv:${s.type}`);

/** What a favorite row states it adds -- the search field (item 4) and the
 * config pane's one-line reading when it is staged (item 5, PRICE_DESC's slot). */
const favoriteDesc = "A series you saved to Favorites, added with its parameters and appearance.";

/** The staged series: what the config pane edits, and what the primary button commits. */
/**
 * The entry a seed falls back on when the catalog has not landed, or the row
 * is not a study at all: no outputs, so `entryOutputs` yields an empty list
 * and the draft simply draws everything -- which is what a series with no
 * per-output vocabulary does anyway.
 */
const EMPTY_ENTRY = { colors: {} as Record<string, string | null> };

type Draft = {
  key: string;
  type: SeriesType;
  /** The registry name for a study; the series type's own name otherwise. */
  name: string;
  params: Record<string, number | string>;
  color: string;
  shade: string;
  width: number;
  /** "default" is the registry's own per-output pen (or fill), written to nothing. */
  pen: Pen | "default";
  fillPattern: FillPattern | "default";
  /** Whether this series puts its value on its panel's price axis, in its own colour. */
  axisValue: boolean;
  /**
   * The study OUTPUTS to draw, as the registry names them. Held as the SHOWN
   * set rather than the hidden one so the checkboxes read straight off it;
   * `build` writes it only when it is a strict subset of what the entry has.
   */
  outputs: string[];
  panel: number;
  side: "left" | "right";
  /** Performance only: the ticker (or `$ymbol`, or `$group:<Name>`) and the rebase instant. */
  symbol: string;
  anchor: string;
  /** Set when this draft was staged FROM a favorite: it carries the favorite
   * through the derived `staged`, so the reading slot can describe it and the
   * footer can offer Remove, without a second piece of state to keep in sync.
   * `build` ignores it -- a favorite commits as the plain series it seeded. */
  favorite?: ChartFavorite;
};

/**
 * Where a newly picked series lands (spec, Placement): the volume at the
 * bottom of the card, a study where the registry says it belongs -- panel 1
 * for an overlay, the last panel for one that wants a pane of its own --
 * and everything else on panel 1. Always the right-hand scale; the Side
 * picker is how the user moves it.
 */
function defaultPanel(row: Row, last: number): number {
  if (row.type === "volume") return last;
  if (row.type === "study") return row.entry?.pane === "price" ? 1 : last;
  return 1;
}

/**
 * The Add-series modal (2026-09-27 brief): the catalog and configuration in a
 * centred <dialog>, because the Layout editor's ~444px detail column is far too
 * narrow for them -- the search row was crushed, the expression box shrank to
 * ~40px and the pane grew a horizontal scrollbar. This is the SAME app shell
 * RangePopover / IntervalPopover use: the transparent .modal-backdrop <dialog>
 * opened with showModal() in a `[]`-deps effect (it throws on an already-open
 * dialog), with the inner `.modal` owning the panel look -- widened by
 * `.chart-sel-addmodal` so the catalog gets room, not `.modal`'s narrow default.
 *
 * Escape: the editor beneath is itself a <dialog> whose Escape authority lives
 * on a document-level keydown listener (LayoutEditor). A native modal on top
 * takes the Escape's `cancel`, but its keydown still bubbles to that document
 * listener and would close the EDITOR. So Escape is handled here on the dialog's
 * own onKeyDown -- stopPropagation keeps it off the document listener (React
 * delegates at the app root, below document, so stopping there stops the native
 * event before it reaches document), and it closes only this modal. `onCancel`
 * is preventDefault'd and routed to the same close so a native cancel (jsdom
 * fires none) never closes the element behind React's back.
 */
function AddSeriesModal({ titleId, onClose, children }: {
  titleId: string; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog
      ref={ref}
      className="modal-backdrop"
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}
    >
      <div className="modal chart-sel-addmodal">
        <div className="chart-sel-addmodal-head">
          <h2 id={titleId}>Add series</h2>
          <button type="button" className="bd-button bd-button--icon" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {/* The body is the caller's two panes, side by side -- see
            `.chart-sel-addcols`. It carries no padding or column layout of its
            own any more: each pane owns its own, because they scroll
            separately. */}
        <div className="chart-sel-addmodal-body">{children}</div>
      </div>
    </dialog>
  );
}

/**
 * The series palette (v12.4.0; J6 2026-09-25 reshaped it into the layout
 * pack's reference `study-selector` / `macro-editor` shape). Two columns:
 *
 * - LEFT, an ITEM-LIST of the series the card already draws (grip + name +
 *   "P1 · right scale"), with a "+ Add series" bar above it. Clicking a row
 *   edits that series; the grip reorders. Both route to the parent (see
 *   `onEditSeries` / `onReorderSeries` above) rather than being owned here.
 * - RIGHT, the DETAIL: a "Registry study" / "Price & volume" kind heading
 *   with a **Change** button, then the fields regrouped into three
 *   `<fieldset>`s -- Study parameters / Placement / Line appearance -- a live
 *   expression pill that is the identity the chip and the wire will carry, the
 *   one-line reading, the primary button and the expression/saved-series row.
 *
 * The catalog search + grouped list is no longer the top-level model: it is
 * the **Change** step (the same search, groups, matches and keyboard as
 * before), open by default while ADDING (`editing === null`) and revealed by
 * Change while editing. The commit machinery below (`build` / `commit` /
 * `duplicate` / `seed` / `shapeOf` / `labelOf` / `typedDraft` / `submit`) is
 * unchanged from the search-first palette -- only the JSX shell moved.
 *
 * Shell-less (spec 2026-09-24, D1/Task 6): this component renders only the
 * pane itself -- the item-list, the detail, the Change step, the primary
 * button and the expression row -- with no dialog, veil or Escape of its own.
 * The Layout editor's Series tab is its only caller now and owns all of that
 * chrome (the modal, the focus trap, Escape, its own Cancel): a pane rendered
 * inline into whatever container the caller gives it, no longer a floating
 * window this component positions itself. The caller still mounts this keyed
 * on the edited series, so every open -- including an item-list select that
 * hands a new id up -- starts from a fresh draft.
 */
export function SeriesPalette({
  catalog, status, active, editing, panels, symbol, symbols = [symbol], symbolGroups = [], onAdd, onApply,
  fallbackColor, allowBusinessDays, source, onClose, onRefresh, onEditSeries, onReorderSeries, panelFilter, pendingEdit,
  favorites, onAddFavorite, onRemoveFavorite,
}: Props) {
  const { AnchorChips, RelativeTab } = getHost().components;
  const id = useId();
  const [query, setQuery] = useState("");
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  // The "Add to Favorites" checkbox (item 6): UNTICKED by default, reset after
  // each commit that actually saves. The component remounts on every open, so
  // this also starts fresh each time the palette opens.
  const [addFav, setAddFav] = useState(false);
  // The Change step (J6): the catalog search + grouped list is shown while
  // ADDING (a fresh pick has to start somewhere) and revealed by the Change
  // button while editing an existing series. Seeded from `editing` because the
  // component remounts on every open -- an add opens on the catalog, an edit
  // opens on the fields with Change collapsed.
  const [changeOpen, setChangeOpen] = useState(editing === null);
  // Whether the Add-series modal is open (2026-09-27 brief). Closed until the
  // user presses "+ Add series": opening the Series tab shows the item-list of
  // the card's series and the "+ Add series" bar, NOT the catalog -- a modal on
  // open would cover that list behind its backdrop. Editing an existing series
  // stays in the detail column and opens no modal.
  const [addOpen, setAddOpen] = useState(false);
  /**
   * Close the Add-series modal and give the parent back a cleared selection.
   *
   * The clear lives HERE, on the way out, rather than in the "+ Add series"
   * click: the renderer keys the Layout editor on the edited series, so
   * clearing it remounts this component, and doing that as the modal opened
   * destroyed the very state that opens it.
   */
  const closeAdd = () => { setAddOpen(false); onEditSeries?.(null); };
  /** The item row being dragged, for the .4 dim; cleared on drop or dragend. */
  const [dragging, setDragging] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const cfgRef = useRef<HTMLDivElement>(null);
  // Focus the search when the Add-series modal opens (2026-09-27 brief), not on
  // component mount -- the search lives in the modal now, which mounts only when
  // `addOpen` flips true, after this component. Keyed on `addOpen` so it fires on
  // each open; the modal's own showModal() (a child effect) runs first, so the
  // search is on screen when this focuses it. Done in an effect rather than with
  // autoFocus, which the a11y rule bans. Restoring focus on close is not this
  // component's job -- the native modal returns focus to whatever opened it.
  useEffect(() => {
    if (addOpen) searchRef.current?.focus();
  }, [addOpen]);

  const unavailable = status === "unavailable";
  const lookup = (name: string) => catalog.find((e) => e.name === name);
  const edited = editing === null || editing.type !== "study" ? undefined : lookup(editing.name ?? "");
  /** The panels the card actually has: what Panel offers, and the ceiling a stale number is clamped to. */
  const lastPanel = Math.max(panels.length, 1);
  const panelNumbers = Array.from({ length: lastPanel }, (_v, i) => i + 1);
  /**
   * The selected panel the list is scoped to (master-detail), clamped to a
   * panel the card actually has -- the editor's `at + 1` can name a draft panel
   * this live pane does not yet have. Undefined leaves the list unfiltered.
   */
  const filterPanel = panelFilter === undefined ? undefined : Math.min(Math.max(panelFilter, 1), lastPanel);

  const seed = (row: Row): Draft => {
    // A favorite stages from its STORED series (item 3): its params, colour,
    // shade, width, pen, fillPattern, side, symbol and anchor as saved -- the
    // same fields the `editing` initial draft reads off a series. `panel` is
    // the exception: the card that saved it may have had more panels than this
    // one, so clamp into 1..lastPanel, and let a scoped list's filterPanel win
    // exactly as it does for a fresh pick below.
    if (row.favorite !== undefined) {
      const s = row.favorite.series;
      return {
        key: row.key, type: s.type, name: s.name ?? s.type, params: s.params, color: s.color,
        shade: s.style?.shade ?? lookup(s.name ?? "")?.shade ?? s.color, width: s.style?.width ?? 1,
        pen: isPen(s.style?.pen) ? s.style.pen : "default",
        fillPattern: isFillPattern(s.style?.fillPattern) ? s.style.fillPattern : "default",
        axisValue: s.style?.axisValue !== false,
        outputs: [...(s.style?.outputs ?? entryOutputs(lookup(s.name ?? "") ?? EMPTY_ENTRY))],
        panel: filterPanel ?? Math.min(Math.max(s.panel, 1), lastPanel), side: s.side,
        symbol: s.symbol ?? PERFORMANCE_SELF, anchor: s.anchor ?? DEFAULT_ANCHOR,
        favorite: row.favorite,
      };
    }
    const color = row.entry === undefined
      ? (COLOURED.includes(row.type as PriceType) ? fallbackColor : THEME_COLOR)
      : defaultColor(row.entry, fallbackColor);
    return {
      key: row.key, type: row.type, name: row.name, params: row.entry === undefined ? {} : defaults(row.entry),
      // The registry's shade where the study declares one, else the line's colour.
      color, shade: row.entry?.shade ?? color, width: 1, pen: "default", fillPattern: "default",
      // ON for a fresh pick (user, 2026-09-27: "color the last tick values"):
      // a study's value on the axis, in the study's colour, is the default and
      // the tick is how you turn it OFF.
      axisValue: true,
      // Every output drawn, which is what the study has always done.
      outputs: [...entryOutputs(row.entry ?? EMPTY_ENTRY)],
      // A freshly picked series lands on the SELECTED panel when the list is
      // scoped to one (master-detail: "+ Add series adds here"), else where the
      // registry says it belongs. Either way the Placement picker can move it.
      panel: filterPanel ?? defaultPanel(row, lastPanel), side: "right",
      symbol: PERFORMANCE_SELF, anchor: DEFAULT_ANCHOR,
    };
  };

  // The draft is null until something is staged: the first visible row
  // stands in until then, exactly as the pack opens staged on its first row.
  // Seeded from the SERIES rather than its catalog entry in edit mode, so a
  // catalog that lands after the palette opened does not lose the edit. A
  // panel the card no longer has is clamped to the last one it does: the
  // series draws nowhere until it is placed somewhere real, and Update is
  // what places it.
  const [draft, setDraft] = useState<Draft | null>(
    editing === null ? null : {
      key: rowKeyOf(editing), type: editing.type, name: editing.name ?? editing.type,
      params: editing.params, color: editing.color,
      shade: editing.style?.shade ?? edited?.shade ?? editing.color, width: editing.style?.width ?? 1,
      pen: isPen(editing.style?.pen) ? editing.style.pen : "default",
      fillPattern: isFillPattern(editing.style?.fillPattern) ? editing.style.fillPattern : "default",
      axisValue: editing.style?.axisValue !== false,
      outputs: [...(editing.style?.outputs ?? entryOutputs(edited ?? EMPTY_ENTRY))],
      panel: Math.min(Math.max(editing.panel, 1), lastPanel), side: editing.side,
      symbol: editing.symbol ?? PERFORMANCE_SELF, anchor: editing.anchor ?? DEFAULT_ANCHOR,
    },
  );
  // The draft as mounted: a draft still equal to it is an edit nobody touched,
  // which OK must not write back (the editor remounts this pane per edit).
  const seededDraft = useRef(draft);

  // The pack keeps the highlighted row in view while the arrows walk it --
  // after the render that moved it, not before.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [draft?.key]);
  /** Search matches the short label, the long name and the one-line reading, across groups. */
  const q = query.trim().toLowerCase();
  const matches = (r: Row) => {
    const fields = r.favorite !== undefined
      ? [r.favorite.name, favoriteDesc]
      : r.entry === undefined
        ? [PRICE_LABELS[r.type as PriceType], PRICE_DESC[r.type as PriceType]]
        : [r.entry.name, r.entry.label, catalogTitle(r.entry), r.entry.desc ?? r.entry.description ?? ""];
    return q === "" || fields.some((field) => field.toLowerCase().includes(q));
  };
  // An EODHD chart lists only what EODHD can serve; a local one lists all of
  // it. Kept apart from the query filter because the placeholder counts what
  // this card could ever show, not the whole catalog.
  // `!= null` deliberately: parseCatalog reads the registry leniently, so a
  // backend that omits `eodhd` yields undefined -- and an entry that never
  // said it maps is unmapped, not universally mapped.
  //
  // The Price & volume rows are NOT filtered by source: they are drawn from
  // the bars the card already has, on both widgets (spec, Acceptance 8).
  const sourcedStudies = catalog.filter((e) => (source === "eodhd" ? e.eodhd != null : true));
  const sourced: Row[] = [...PRICE_TYPES.map(priceRow), ...sourcedStudies.map(studyRow)];
  const usable = sourced.filter(matches);
  const priceUsable = usable.filter((r) => r.entry === undefined);
  const studyUsable = usable.filter((r) => r.entry !== undefined);
  // Favorites are NOT in `sourced` (so a staged favorite is never dropped by
  // the filteredOut guard below, exactly like an edited study the registry no
  // longer carries). They are the FIRST group and a STANDING one (user,
  // 2026-09-27: "Favorites should be a category like Price & Volume and Moving
  // Averages. in fact, it should be the first"). It used to be dropped when
  // empty, so a user who had saved none never saw the category existed -- the
  // header stands now and carries a line saying how to fill it.
  //
  // Only while the SEARCH is empty: a query that matches no favorite must not
  // leave a "Favorites" header sitting over another group's results.
  const favUsable = (favorites ?? []).map(favoriteRow).filter(matches);
  const favStands = favUsable.length > 0 || query.trim() === "";
  const groups = [
    ...(favStands ? [{ group: "Favorites", entries: favUsable }] : []),
    ...(priceUsable.length === 0 ? [] : [{ group: PRICE_GROUP, entries: priceUsable }]),
    ...ordered([...new Set(studyUsable.map((r) => catalogGroup(r.entry as CatalogEntry)))])
      .map((group) => ({ group, entries: studyUsable.filter((r) => catalogGroup(r.entry as CatalogEntry) === group) })),
  ];
  /** The list in visual order: what ArrowUp/ArrowDown walk. */
  const rows = groups.flatMap((g) => g.entries);

  // A draft the query has filtered out is UNSTAGED (review P2, finding 6):
  // otherwise the config pane keeps offering -- and Enter keeps committing --
  // a series the list no longer contains. Dropping it falls back to the first
  // visible row, or to nothing at all when the query matches nothing. Only a
  // draft this card COULD list is dropped: an edited study the registry no
  // longer carries is not in `sourced` either, and it has to stay staged for
  // the "not in the registry" reading below to be about the right study.
  const filteredOut = draft !== null
    && sourced.some((r) => r.key === draft.key) && !rows.some((r) => r.key === draft.key);
  const staged = (filteredOut ? null : draft) ?? (rows[0] === undefined ? null : seed(rows[0]));
  const isStudy = staged !== null && staged.type === "study";
  const entry = staged === null || !isStudy ? undefined : lookup(staged.name);
  // A live-grid could in principle project a `javascript:` or `data:` wiki
  // href -- the backend is the thing being trusted here, not React, since
  // React does not sanitise an anchor's href for us.
  const wiki = safeWiki(entry?.wiki);
  const priceType = staged === null || isStudy ? undefined : (staged.type as PriceType);
  const coloured = priceType !== undefined && COLOURED.includes(priceType);

  const invalidParam = (p: CatalogEntry["params"][number]) =>
    entry !== undefined && staged !== null && paramInvalid(entry, p, staged.params[p.name], allowBusinessDays);
  const performanceIncomplete = staged !== null && staged.type === "performance"
    && (staged.symbol.trim() === "" || staged.anchor.trim() === "");
  // A bar series or performance line naming something that is not a reference (spec 2026-11-13 §1).
  const symbolInvalid = staged !== null && !symbolAllowed(staged.type, performanceSymbol(staged.symbol));
  const incomplete = (entry !== undefined && entry.params.some(invalidParam)) || performanceIncomplete || symbolInvalid;
  // OK reads the staged edit through this, so it no longer needs Update first.
  // The same build and duplicate guard Update uses; an add (the modal) is not
  // an edit and stays the modal's own.
  useEffect(() => {
    if (pendingEdit === undefined) return;
    pendingEdit.current = () => {
      if (editing === null || addOpen || staged === null || draft === seededDraft.current) return null;
      const built = build(staged, editing);
      return built === null || duplicate(built, editing) ? null : built;
    };
    return () => { pendingEdit.current = null; };
  });
  /** What the Symbol field's picker offers; free text is the field itself. */
  const symbolOptions = [PERFORMANCE_SELF, ...symbols.slice(1).map((_t, i) => `list:${i + 2}`), ...symbolGroups.map((g) => `$group:${g}`)];
  // One unit per study (unifyWindows): a `bd` in one window field pulls the
  // entry's other windows with it.
  const applied = entry === undefined || staged === null ? {} : unifyWindows(staged.params, entry);
  /**
   * The typed-expression field's example, built from what the list has staged
   * (user, 2026-09-27: "what is the AVWAP(T@14:00) ... still doing there").
   * A fixed AVWAP example sat directly under the staged series' own
   * description and read as that series' field rather than as a separate way
   * in. `normalizeExpression` is the same formatter the picked series commits
   * through, so the example is always something this field would accept.
   *
   * A price type's whole expression IS its label, so the example carries no
   * arguments -- that is the grammar, not a truncation.
   */
  const placeholder = staged === null ? PLACEHOLDER
    : staged.type === "study"
      ? (entry === undefined ? PLACEHOLDER : studyExpr(normalizeExpression(staged.name, applied, entry), performanceSymbol(staged.symbol)))
      : staged.type === "performance"
        ? `Performance(${staged.symbol.trim() === "" ? PERFORMANCE_SELF : staged.symbol}, ${staged.anchor.trim() === "" ? DEFAULT_ANCHOR : staged.anchor})`
        : PRICE_LABELS[staged.type as PriceType];

  // The anchor field (study param or performance) currently focused, by its
  // id -- "anchor" for the study param, "perf" for the performance row -- so
  // the chip row mounts under whichever one the user is in.
  const [anchorFocus, setAnchorFocus] = useState<string | null>(null);
  const patch = (over: Partial<Draft>) => { if (staged !== null) setDraft({ ...staged, ...over }); };

  const stage = (target: Row) => { setDraft(seed(target)); };

  // The item-list of the card's series (J6): panel order, then the card's own
  // order within a panel -- the same reading order StudiesStrip and the legend
  // use, so the list here and the strip behind it agree. Scoped to the selected
  // panel when one is given (master-detail): the list is the detail of the panel
  // picked on the left, so it shows that panel's series only.
  const itemSeries = [...active]
    .filter((s) => filterPanel === undefined || s.panel === filterPanel)
    .sort((a, b) => a.panel - b.panel);
  // Reorder, reusing the chip strip's exact idiom (StudiesStrip.drop): a drop
  // reorders WITHIN a panel only -- a row's panel is a property of the series,
  // changed in Placement, not by dropping it on another panel's row -- and a
  // stale payload (a row removed mid-drag) is a silent no-op.
  function dropItem(event: React.DragEvent, target: Series) {
    event.preventDefault();
    setDragging(null);
    const draggedId = event.dataTransfer.getData(STUDY_REORDER_DRAG_TYPE);
    if (!draggedId || draggedId === target.id) return;
    const ids = active.map((s) => s.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(target.id);
    if (from === -1 || to === -1) return;
    if (active[from]?.panel !== target.panel) return;
    onReorderSeries?.(moveBefore(ids, from, to));
  }
  const carriesItem = (event: React.DragEvent) =>
    Array.from(event.dataTransfer.types).includes(STUDY_REORDER_DRAG_TYPE);
  /**
   * The keyboard half of the reorder (J closeout follow-up), mirroring the
   * LayoutEditor sidebar's grip onKeyDown so the two lists behave the same way.
   * The list-footer hint promises Alt+arrow, and a drag-only list is not
   * keyboard-operable at all, so this is an accessibility requirement rather
   * than a nicety.
   *
   * It deliberately reuses dropItem's EXACT arithmetic and constraint rather
   * than inventing a second reorder path:
   *  - the neighbour is found in `itemSeries` (the panel-sorted VIEW), because
   *    that is the order the user sees and is arrowing through;
   *  - but the move is expressed against `active` (the card's OWN order), which
   *    is the basis onReorderSeries consumes -- indexing the view here would
   *    reorder the wrong series whenever the two orders disagree;
   *  - a move that would cross a panel boundary is a silent no-op, exactly as a
   *    cross-panel DROP is: a row's panel is a property of the series, changed
   *    in Placement, never by reordering.
   * Within one panel the sort is stable, so the neighbour's `active` index is
   * the adjacent slot and the move reads as a swap.
   */
  function moveItem(s: Series, delta: -1 | 1) {
    const neighbour = itemSeries[itemSeries.indexOf(s) + delta];
    if (neighbour === undefined || neighbour.panel !== s.panel) return;
    const ids = active.map((x) => x.id);
    const from = ids.indexOf(s.id);
    const to = ids.indexOf(neighbour.id);
    if (from === -1 || to === -1) return;
    onReorderSeries?.(moveBefore(ids, from, to));
  }

  /**
   * The draft as a series, before its id and colour: the shape `seriesLabel`
   * reads to name it, so the pill, the chip and the saved card all call a
   * series the same thing.
   */
  const shapeOf = (d: Draft): Series => {
    const symbol = performanceSymbol(d.symbol);
    return {
      id: "", type: d.type, params: {}, panel: d.panel, side: d.side, color: "", expr: "",
      ...(d.type === "performance" ? { symbol, anchor: d.anchor.trim() } : {}),
      // A bar series on the card's own symbol stores none, so a one-ticker card saves as before.
      ...(d.type !== "performance" && d.type !== "study" && symbol !== PERFORMANCE_SELF ? { symbol } : {}),
    };
  };

  /** What the pill shows: a study's normalised expression, else the series' own label. */
  const labelOf = (d: Draft): string => {
    if (d.type !== "study") return seriesLabel(shapeOf(d));
    return entry === undefined ? d.name.toUpperCase() : studyExpr(normalizeExpression(entry.name, applied, entry), performanceSymbol(d.symbol));
  };

  /**
   * The draft as the series to commit, or null when it is not one: a study
   * whose registry entry is missing or whose fields the wire would refuse,
   * or a performance line with no symbol or no anchor. `existing` is the
   * series being REPLACED (the palette's edit), which keeps the id and
   * whatever this pane does not edit.
   */
  /** A study series on the staged symbol (spec 2026-11-13 studies §1): none written for $ymbol. */
  const onSymbol = (built: Series, typed: string): Series => {
    const symbol = performanceSymbol(typed);
    return symbol === PERFORMANCE_SELF || symbol === "" ? built : { ...built, symbol, expr: studyExpr(built.expr, symbol) };
  };

  /** A picked study's ticker parameter as a typed one is stored: `msft` -> `MSFT`, `LIST:2` -> `list:2`. */
  const versusNormal = (params: Record<string, number | string>, found: CatalogEntry) =>
    found.tickers === undefined ? params : Object.fromEntries(Object.entries(params).map(
      ([key, value]) => [key, found.tickers?.includes(key) && typeof value === "string" ? performanceSymbol(value) : value]));

  function build(target: Draft, existing: Series | null): Series | null {
    const id = existing?.id ?? seriesId();
    if (target.type === "study") {
      const found = lookup(target.name);
      if (found === undefined) return null;
      if (found.params.some((p) => paramInvalid(found, p, target.params[p.name], allowBusinessDays))) return null;
      // The same path the typed expression takes -- normalizeExpression through
      // instanceFromParse -- so a picked SMA(20) and a typed one are one chip.
      const instance = instanceFromParse(
        { name: found.name, params: unifyWindows(versusNormal(target.params, found), found), color: target.color }, found, fallbackColor,
      );
      // A picked banded study is shaded by default (the swatch seeds from the
      // line colour in seed()); a typed expression stays unshaded, since
      // submit() never writes a style at all -- that split is intentional, not
      // a gap. A `shade` is written only by a banded entry, so switching the
      // pick to one that does not band leaves none behind for the renderer's
      // `band !== true` guard to never draw.
      // Only `width` carries onto a study (the branch-end round): the rest
      // of a coloured series' style means nothing on a study line, and an
      // area's `fillOpacity` rode across an area -> study edit into the
      // card's saved JSON exactly as `shade` used to.
      const style = {
        ...(existing?.style?.width === undefined ? {} : { width: existing.style.width }),
        // Only write a width that actually changed -- otherwise a series that
        // never touched it comes back with a `{ width: 1 }` it never had, which
        // then lands in the card's persisted state.
        ...(target.width === (existing?.style?.width ?? 1) ? {} : { width: target.width }),
        ...(found.band ? { shade: target.shade } : {}),
        // "Default" writes nothing, so the registry's per-output pen (and
        // the band's declared hatch) stays the study's own until overridden.
        ...(target.pen === "default" ? {} : { pen: target.pen }),
        ...(found.band && target.fillPattern !== "default" ? { fillPattern: target.fillPattern } : {}),
        // The inverse of the pen above: absent means SHOWN, so what gets
        // written is the UNTICK. An untouched study still saves no
        // `axisValue` at all and simply takes the default.
        ...(target.axisValue ? {} : { axisValue: false }),
        // Only a STRICT subset is worth writing: a study drawing everything
        // it has is the default, and saving the full list would freeze this
        // card against a registry that later gains an output.
        ...(target.outputs.length > 0 && target.outputs.length < entryOutputs(found).length
          ? { outputs: [...target.outputs] }
          : {}),
      };
      // ONE builder for a study series (T7 review, finding 5): the migration
      // and a v12.3.x bundle's apply go through the same function, and the id
      // is the only thing an edit has that a fresh placement does not.
      // `source` is dead weight on the wire (the chart has one source) but it
      // is part of a pre-12.4.0 bundle's identity, so an edit carries it.
      return onSymbol(seriesFromStudy(
        { ...instance, source: existing?.source, style: Object.keys(style).length === 0 ? undefined : style },
        target.panel, target.side, id,
      ), target.symbol);
    }
    if (!symbolAllowed(target.type, performanceSymbol(target.symbol))) return null;
    if (target.type === "performance" && (target.symbol.trim() === "" || target.anchor.trim() === "")) return null;
    const isColoured = COLOURED.includes(target.type as PriceType);
    // Only what the NEW type can use survives (T7 review, finding 3): staging
    // another row while an edit is open is a supported gesture, and spreading
    // the old style wholesale gave a candlestick the banded study's `shade`
    // and a volume the area's fill. `width` is the one setting every coloured
    // type reads; an area's `fillOpacity` (set through the `{ }` document, not
    // here) is kept only while it stays an area, so editing its colour does
    // not silently throw the fill away.
    const style = {
      ...(target.width === 1 ? {} : { width: target.width }),
      ...(isColoured && target.pen !== "default" ? { pen: target.pen } : {}),
      ...(target.type === "area" && existing?.type === "area" && existing.style?.fillOpacity !== undefined
        ? { fillOpacity: existing.style.fillOpacity }
        : {}),
    };
    const shape = shapeOf(target);
    return {
      ...shape, id, color: isColoured ? target.color : THEME_COLOR,
      ...(Object.keys(style).length === 0 ? {} : { style }),
      expr: seriesLabel(shape),
    };
  }

  /**
   * Identity is the normalised expression (Global Constraints), and for
   * everything but a study its PLACE too: one SMA(20) per card (the socket
   * keys on it), but a Line in panel 1 and a Line in panel 2 are two
   * different readings of the same close. The series under edit is never a
   * collision with itself -- only another chip is.
   */
  const duplicate = (built: Series, existing: Series | null) => active.some((s) =>
    s.id !== existing?.id && s.expr === built.expr
    && (built.type === "study" || (s.panel === built.panel && s.side === built.side)));

  /**
   * Commit the staged series. Takes the draft rather than reading state, so a
   * double-click -- which stages and applies in one gesture -- commits the
   * row it landed on rather than whatever the last render had.
   */
  function commit(target: Draft | null) {
    if (target === null) return;
    /**
     * The Add-series MODAL is the add flow by construction, whatever `editing`
     * still points at (2026-09-27). It used to be cleared on the way in, by
     * calling `onEditSeries(null)` from the "+ Add series" click -- but the
     * renderer keys the Layout editor `editing ?? "layout"`, so that clear
     * remounted the whole editor and took this component's `addOpen` with it:
     * the modal never appeared, and only ever failed when a series happened to
     * be selected. The clear now happens on the way OUT, where a remount costs
     * nothing, and everything that asked "is this an add?" asks the modal.
     */
    const editingNow = addOpen ? null : editing;
    const built = build(target, editingNow);
    if (built === null) return;
    // A commit that returns early (null draft, failed build, duplicate) must
    // not save a favorite either (item 6): the checkbox rides the SAME
    // success path the add/apply does. `upsertFavorite` keys on the name the
    // parent derives (seriesLabel), so ticking it for a configuration already
    // in Favorites replaces in place rather than adding a second entry (item 8).
    // Committing from the modal adds the series and closes the MODAL (brief),
    // leaving the Layout editor open on the Series tab -- not the editor's
    // Cancel. In edit mode `addOpen` is already false, so this is a no-op there.
    if (duplicate(built, editingNow)) { closeAdd(); onClose(); return; }
    if (addFav) onAddFavorite?.(built);
    setAddFav(false);
    if (editingNow === null) onAdd(built); else onApply(built);
    closeAdd();
    onClose();
  }

  /**
   * A typed Price & volume expression: one of the five fixed names
   * (`OHLC`, `Volume`, …), optionally with a symbol (`Candlestick(list:2)`), or the performance notation, which always names
   * the symbol first and reads a one-argument `Performance(T-3m)` as the
   * card's own symbol. The placement is the default one -- the pickers are
   * for the staged row, and a typed line has not been staged.
   */
  function typedDraft(value: string): Draft | null {
    const bar = parseBarSeries(value);
    if (bar !== null) return { ...seed(priceRow(bar.type)), symbol: bar.symbol ?? PERFORMANCE_SELF };
    const perf = parsePerformance(value);
    if (perf === null) return null;
    return { ...seed(priceRow("performance")), symbol: perf.symbol, anchor: perf.anchor };
  }

  function submit() {
    // "Nothing typed" is not a rejected expression -- leave the field alone.
    const typed = text.trim();
    if (typed === "") return;
    const price = typedDraft(typed);
    if (price !== null) {
      // Typed series ADD, always: the field is beside the palette's editor,
      // not part of it.
      const built = build(price, null);
      if (built === null) { setInvalid(true); return; }
      if (!duplicate(built, null)) onAdd(built);
      setText("");
      setInvalid(false);
      return;
    }
    // Resolved against `sourcedStudies`, not the whole catalog: one source per
    // chart holds for the typed field too, so on an EODHD chart a study EODHD
    // cannot serve is refused here exactly as it is absent from the list,
    // rather than slipping in as a locally-computed line.
    const inSource = (name: string) => sourcedStudies.find((e) => e.name === name);
    const parsed = parseStudy(typed, inSource, { allowBusinessDays });
    // Silent rejection (addendum §2): no chip, no request, no dialog -- the
    // field tints and the text stays for the user to fix.
    if (parsed === null) { setInvalid(true); return; }
    const found = inSource(parsed.name);
    if (found === undefined) { setInvalid(true); return; }   // unreachable: the parser resolved the name off this same list
    const instance = instanceFromParse(parsed, found, fallbackColor);
    const row = studyRow(found);
    const built: Series = {
      id: seriesId(), type: "study", name: instance.name, params: instance.params,
      panel: defaultPanel(row, lastPanel), side: "right", color: instance.color, expr: instance.expr,
    };
    const placed = parsed.symbol === undefined ? built : onSymbol(built, parsed.symbol);
    if (!duplicate(placed, null)) onAdd(placed);
    setText("");
    setInvalid(false);
  }

  /**
   * The pack's keyboard (↑↓ move, Enter stages then applies): every key it
   * does not use is stopped here so the chart's own map behind it cannot see
   * it. Escape is the one exception, and deliberately falls through untouched
   * (Task 6): this component no longer owns a modal of its own to close, but
   * the Layout editor wrapping it does, listening on the document itself
   * (`LayoutEditor`'s own effect) -- stopping propagation here would swallow
   * the key before it ever reached that listener and strand the editor open.
   * The footer's two text fields keep their own keys -- Enter there means
   * "take this expression", not "add the staged series".
   */
  function onKey(event: React.KeyboardEvent) {
    if (event.key === "Escape") return;
    if ((event.target as HTMLElement).closest("[data-keys='own']") !== null) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      // Inert while the Change step is collapsed (J6): the catalog list the
      // arrows walk is not on screen, so there is nothing to move through.
      if (!changeOpen || rows.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      const from = rows.findIndex((r) => r.key === staged?.key);
      // Nothing visible is staged (an edited study the list does not carry):
      // the arrows enter the list at its first or last row, not one off the
      // end of it, which is what `(-1 - 1 + len) % len` used to give.
      stage(from === -1
        ? (step === 1 ? rows[0] : rows[rows.length - 1])
        : rows[(from + step + rows.length) % rows.length]);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      // From the search, Enter STAGES: it commits the highlighted row into
      // the draft and drops the cursor on its first field. A second
      // Enter -- now from that field -- applies. `select` is in the query
      // beside `input` because a Candlestick has no fields of its own: the
      // Panel picker is the first thing in its pane, and without it Enter
      // would land nowhere and the second Enter would stage all over again.
      if (event.target === searchRef.current) {
        if (staged !== null) setDraft(staged);
        cfgRef.current?.querySelector<HTMLElement>("input, select")?.focus();
        return;
      }
      commit(staged);
      return;
    }
    event.stopPropagation();
  }

  const title = entry !== undefined ? catalogTitle(entry)
    : priceType !== undefined ? PRICE_LABELS[priceType]
      : "";
  const pane = entry === undefined ? "" : (entry.pane === "price" ? "price overlay" : "own pane");
  const guides = entry === undefined || entry.guides.length === 0 ? "" : ` · guides ${entry.guides.join(" / ")}`;
  const reading = staged?.favorite !== undefined ? favoriteDesc
    : entry !== undefined ? (entry.desc ?? entry.description ?? "")
      : priceType !== undefined ? PRICE_DESC[priceType]
        : "";

  // The palette's own pane (J6, spec 2026-09-25): a section bar with
  // "+ Add series", the item-list of the card's series on the left, and the
  // detail on the right -- kind heading + Change step + the three grouped
  // fieldsets, the primary button and the expression/saved-series row. This is
  // the whole of what this component renders now that Task 6 removed the dialog
  // shell (the veil, the own Escape, the own Cancel). Kept as its own variable
  // rather than folded into the return below only because that is how it read
  // before the shell came off; there is no second caller left to share it with.
  //
  // The catalog search + grouped list (`chart-sel-head` + `chart-sel-list`) is
  // now the CHANGE step, `changeOpen`-gated inside the detail column: open
  // while adding, revealed by Change while editing. It is deliberately OUTSIDE
  // `cfgRef` so Enter-to-stage focuses the first PARAMETER field, not the
  // search box.
  const catalogHead = (
    <div className="chart-sel-head">
      <span className="chart-sel-mag" aria-hidden="true">
        <svg viewBox="0 0 16 16" className="chart-icon"><circle cx="7" cy="7" r="4.6" /><path d="M10.5 10.5L14 14" /></svg>
      </span>
      <input
        ref={searchRef}
        className="chart-sel-search"
        aria-label="Search series"
        // The count is this CARD's list, not the whole catalog: an
        // EODHD chart shows only what EODHD serves, and promising
        // studies the list does not hold is a lie the user can see.
        // Every row the list shows is counted (T7 review, finding 1),
        // the six Price & volume ones included -- they are series to
        // be searched like any other, and a count that left them out
        // promised ten where the list holds sixteen.
        placeholder={`Search ${sourced.length} series — try “band”, “rsi”, “vwap”…`}
        value={query}
        spellCheck={false}
        autoComplete="off"
        // Focus never leaves the search while ↑↓ walk the list, so the
        // highlighted row is announced from here.
        aria-controls={`${id}-list`}
        aria-activedescendant={staged !== null && rows.some((r) => r.key === staged.key) ? `${id}-opt-${staged.key}` : undefined}
        onChange={(event) => setQuery(event.target.value)}
      />
      <kbd className="chart-kbd" aria-hidden="true">↑↓</kbd>
      <kbd className="chart-kbd" aria-hidden="true">⏎</kbd>
      <kbd className="chart-kbd" aria-hidden="true">esc</kbd>
      {/* Not disabled while loading: a refresh that is already in
          flight is joined by the cache, so a second press costs
          nothing and a control that greys out mid-fetch only invites
          the question of whether the first press took. */}
      {onRefresh !== undefined && (
        <button
          type="button"
          className="bd-button bd-button--icon"
          aria-label="Refresh studies"
          title="Fetch the studies catalog again"
          onClick={onRefresh}
        >
          ↻
        </button>
      )}
    </div>
  );
  const catalogList = (
    <div
      className="chart-sel-list"
      id={`${id}-list`}
      role="listbox"
      aria-label="Series"
      // Out of the tab order: the search keeps the focus and walks
      // the rows for it. The attribute is here because an element
      // that names an active descendant has to be focusable at all.
      tabIndex={-1}
      aria-activedescendant={staged !== null && rows.some((r) => r.key === staged.key) ? `${id}-opt-${staged.key}` : undefined}
      ref={listRef}
    >
      {rows.length === 0 && <p className="chart-sel-empty">No series matches.</p>}
      {groups.map(({ group, entries }) => (
        // A real group, not a bare div: the header is its visible
        // label (and `aria-hidden`, so the name is announced once,
        // from the group), and the options are its children.
        <div key={group} role="group" aria-label={group}>
          <div className="chart-sel-grp" aria-hidden="true">{group}</div>
          {/* A standing Favorites header with nothing under it yet. Deliberately
              not a `role="option"` and not in `rows`: `rows` is what the arrow
              keys walk and what Enter commits, and a hint is neither. */}
          {entries.length === 0 && (
            <p className="chart-sel-favhint">Nothing saved yet. Tick “Add to Favorites” when you add a series.</p>
          )}
          {entries.map((r) => {
            const e = r.entry;
            const fav = r.favorite;
            return (
              <button
                key={r.key}
                id={`${id}-opt-${r.key}`}
                type="button"
                role="option"
                // Out of the tab order on purpose: the search input
                // carries aria-activedescendant and IS the keyboard
                // path through the list, so a tabbable row would both
                // walk ~50 stops to reach the config pane and leave
                // the activedescendant pointing at something that no
                // longer has focus. The mouse path is untouched.
                tabIndex={-1}
                aria-selected={r.key === staged?.key}
                className="chart-sel-row"
                // The long name, as a study row's is (T7 review,
                // finding 7) -- not the one-line reading, which the
                // config pane shows for both kinds alike. A favorite's
                // title is its own configured label.
                title={fav !== undefined ? fav.name : e === undefined ? PRICE_LABELS[r.type as PriceType] : catalogTitle(e)}
                onClick={() => stage(r)}
                onDoubleClick={() => commit(seed(r))}
              >
                {/* The on-chart mark leads the row in a slot of its
                    own (user ruling 2026-09-17): empty or not, the
                    names line up under each other. A favorite carries
                    no on-chart mark -- the same configuration may be on
                    the card under a different placement -- but keeps the
                    slot so the column stays aligned. */}
                <span className="chart-sel-check">
                  {fav === undefined && active.some((s) => (e === undefined ? s.type === r.type : s.type === "study" && s.name === r.name)) ? "✓" : ""}
                </span>
                {(fav !== undefined ? fav.series.color !== "" : e === undefined ? COLOURED.includes(r.type as PriceType) : e.pane === "price")
                  ? <span className="chart-sel-dot" style={{ background: fav !== undefined ? fav.series.color : e === undefined ? fallbackColor : defaultColor(e, fallbackColor) }} />
                  : <span className="chart-sel-pane" aria-hidden="true" />}
                {/* The pack's row name is the registry KEY in caps
                    (BBANDS), the long name lives in the title and the
                    config pane. A Price & volume row is named as the
                    legend names it (Candlestick, OHLC), not shouted. A
                    favorite shows its full configured label (BBANDS(20, 2.0)). */}
                <span className="chart-sel-nm">{fav !== undefined ? fav.name : e === undefined ? PRICE_LABELS[r.type as PriceType] : e.name.toUpperCase()}</span>
                <span className="chart-sel-df">{fav === undefined && e !== undefined ? defaultsText(e) : ""}</span>
                {/* No parity badge on the Price & volume or favorite
                    rows: neither is served by anyone. */}
                {fav === undefined && e?.eodhd != null && <span className="chart-sel-parity">◆ EODHD</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );

  // The detail column's CONTENTS (2026-09-27 brief): the kind heading, the
  // Change step (catalog search + grouped list) and the configuration fields,
  // as ONE variable rendered in exactly one place -- the centred Add-series
  // modal while adding (`addOpen`), or the .chart-sel-detail column while
  // editing. Never both: there is one draft and one keyboard. The ~444px detail
  // column was too narrow for the catalog, so adding gets a modal wide enough.
  const detail = (
    <>
              {unavailable && (
                <p className="chart-popover-error">
                  The registry is unreachable; the card&apos;s current studies are listed, and no study can be
                  added. The price and volume series are drawn from the card&apos;s own bars and still can.
                </p>
              )}
              {/* A study under edit whose indicator the catalog does not
                  carry (a card saved against another backend, or one the
                  registry has since dropped): the primary button is already
                  disabled by `entry === undefined` -- guarded on
                  `status === "ready"` so this cannot flash while the catalog
                  is still in flight. */}
              {status === "ready" && editing !== null && editing.type === "study" && edited === undefined && (
                <p className="chart-popover-error">
                  {seriesLabel(editing)} is not in the registry, so its fields cannot be shown.
                </p>
              )}
              {/* The kind heading (J6, reference `.series-kind`): "Registry
                  study" / "Price & volume", the title, its pane/guides reading,
                  and the Change button that reveals the catalog step. */}
              {staged !== null && (entry !== undefined || priceType !== undefined) && (
                <div className="chart-sel-kind">
                  <div>
                    <span className="chart-sel-kindlabel">{isStudy ? "Registry study" : "Price & volume"}</span>
                    <b>{title}</b>
                    <span>{pane}{guides}</span>
                  </div>
                  <button
                    type="button"
                    className="bd-button"
                    aria-expanded={changeOpen}
                    onClick={() => setChangeOpen((o) => !o)}
                  >
                    Change
                  </button>
                </div>
              )}
              {/* The Change step: the catalog search + grouped list, shown
                  while adding or when Change is pressed. */}
              {/* While the modal is open the catalog is its LEFT PANE, not a
                  step inside this column (user, 2026-09-27: the dialog "had a
                  left scroll panel with the categories and a right panel for
                  the parameters"). Editing in the column still reveals it here
                  behind Change, which is where it has always been. */}
              {changeOpen && !addOpen && (
                <div className="chart-sel-change">
                  {catalogHead}
                  {catalogList}
                </div>
              )}
              <div className="chart-sel-cfg" ref={cfgRef}>
                {/* Everything ABOVE the commit row scrolls; the expression box
                    and the buttons below it do not (user, 2026-09-27: "when
                    the parameters are too long the buttons fall off the
                    screen. lock the button placement and enable a scroll for
                    the arguments region"). A study with three sections --
                    parameters, placement, appearance -- outgrew the modal, and
                    because the whole pane scrolled as one the primary button
                    went with it. Outside the modal this is a plain flex column
                    carrying the same gap, so the inline palette is unchanged. */}
                <div className="chart-sel-scroll">
                {staged !== null && (entry !== undefined || priceType !== undefined) && (
                  <>
                    {/* The identity the chip and the wire will carry, live as
                        the fields change: config and chart can never disagree
                        about what was added. */}
                    <div className="chart-sel-pill">
                      <span className="chart-sel-sw" style={{ background: staged.color === THEME_COLOR ? fallbackColor : staged.color }} />
                      <span>{labelOf(staged)}</span>
                    </div>
                    {/* Study parameters (J6, reference `.parameter-group`): the
                        registry's fields for a study, or a performance line's
                        symbol and anchor. Grouped in a native <fieldset> whose
                        <legend> is the group's accessible name. */}
                    {(entry !== undefined || staged.type !== "study") && (
                    <fieldset className="chart-sel-group">
                    <legend>Study parameters</legend>
                    {/* The study's formula/reading as the group intro (J closeout,
                        item 6; reference 05 shows the study's math -- "Mid =
                        SMA(N); bands = mid ± k · population σ." for BBANDS -- under
                        this legend, the way Placement and Line appearance carry an
                        intro line). It is the study's own `desc`, so it is DEDUPED
                        from the bottom one-line reading below, which now skips a
                        study that has parameters. Shown for a study only; a
                        performance line carries no registry formula. */}
                    {entry !== undefined && reading !== "" && (
                      <p className="chart-sel-grouphint">
                        {reading}
                        {wiki !== undefined && <> <a href={wiki} target="_blank" rel="noopener noreferrer">{referenceLabel(wiki)}</a></>}
                      </p>
                    )}
                    {entry?.params.map((p) => {
                      const held = staged.params[p.name];
                      // A window param is a TEXT field wherever `bd` is spellable: a
                      // number input takes no letters, so `SMA(50bd)` could only ever be
                      // typed in the expression field otherwise. It is also text while
                      // it HOLDS a non-empty string -- the "50b" a `50bd` passes through
                      // while being backspaced -- so the field keeps what was typed
                      // rather than blanking it (the disabled button, and the mark on
                      // the field, are how the user sees why).
                      const asText = p.text
                        || (allowBusinessDays && entry.windows.includes(p.name))
                        || (typeof held === "string" && held !== "");
                      return (
                        <div
                          key={p.name}
                          className="chart-sel-frow"
                          onFocus={() => setAnchorFocus(p.name)}
                          // The row (input + chip group) is one focus region: a
                          // blur that lands back inside it -- Tab from the field
                          // onto a chip -- must not unmount the chips out from
                          // under the focus that is about to land there.
                          onBlur={(event) => {
                            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                              setAnchorFocus(null);
                            }
                          }}
                        >
                          <label htmlFor={`${id}-${p.name}`}>{p.label ?? p.name}</label>
                          <input
                            id={`${id}-${p.name}`}
                            type={asText ? "text" : "number"}
                            list={entry.tickers?.includes(p.name) ? `${id}-symbols` : undefined}
                            step={asText ? undefined : (p.step ?? (p.float === true ? "any" : 1))}
                            value={held ?? ""}
                            data-invalid={invalidParam(p) ? "true" : undefined}
                            // ponytail: the state holds the COERCED number, not the
                            // typed text, so a field cleared to "" is an empty string
                            // sitting in a numeric param -- paramInvalid's "" case is
                            // the whole reason it never reaches the wire as the `0`
                            // that `Number("")` would have made of it. Upgrade path: a
                            // parallel string draft per field, if a numeric field ever
                            // has to show something the coercion cannot round-trip.
                            onChange={(event) => {
                              const v = event.target.value;
                              const n = Number(v);
                              patch({
                                params: {
                                  ...staged.params,
                                  [p.name]: p.text || isBusinessDays(v) || v === "" ? v : (Number.isNaN(n) ? v : n),
                                },
                              });
                            }}
                          />
                          {p.step !== undefined && !asText && <div className="chart-sel-help">steps of {p.step}</div>}
                          {/* The v5 relative-row editor, not a bare box with
                              chips (owner, 2026-09-27: "what you actually want
                              is the richer picker the v5 date params get, the
                              relative-row editor with anchor, offset and unit
                              controls"). The same `RelativeTab` every datetime
                              parameter in the app opens, so an anchor is built
                              the one way the grammar is built everywhere else.

                              `anchorPresets` keeps the Trades chips (OBS-100,
                              OBS-1000) with it: a trade count is not an
                              anchor-plus-offset, so no dropdown can reach it,
                              and the editor without them would have lost the
                              form the owner named first.

                              `preview` is `anchorPreview`, which answers for
                              OBS-n -- `previewExpression` returns null there,
                              correctly, because which trade was n-th most
                              recent is the server's fact, not a calculation.
                              `presets: []` because a study palette has no
                              handle on the dashboard's saved presets, which is
                              what AnchorChips already said. */}
                          {p.name === "anchor" && anchorFocus === p.name ? (
                            <RelativeTab
                              type="datetime"
                              label="Anchor"
                              value={String(staged.params[p.name] ?? "")}
                              anchorPresets
                              context={{ preview: (expr) => anchorPreview(expr), presets: [] }}
                              onApply={(expr) => patch({ params: { ...staged.params, [p.name]: expr } })}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                    {/* A bar or study series' symbol (spec 2026-11-13: a ticker, `$ymbol`, `list:<n>` or `$group:<Name>`, picked or typed), then a performance line's anchor. */}
                    <div className="chart-sel-frow">
                        <label htmlFor={`${id}-symbol`}>Symbol</label>
                        <input
                          id={`${id}-symbol`}
                          type="text"
                          spellCheck={false}
                          list={`${id}-symbols`}
                          value={staged.symbol}
                          data-invalid={(staged.type === "performance" && staged.symbol.trim() === "") || symbolInvalid ? "true" : undefined}
                          onChange={(event) => patch({ symbol: event.target.value })}
                        />
                        <datalist id={`${id}-symbols`}>
                          {symbolOptions.map((option) => <option key={option} value={option} />)}
                        </datalist>
                        <div className="chart-sel-help">{PERFORMANCE_SELF} is this card&apos;s symbol ({symbol})</div>
                      </div>
                    {staged.type === "performance" && (
                      <div
                        className="chart-sel-frow"
                        onFocus={() => setAnchorFocus("perf")}
                        onBlur={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                            setAnchorFocus(null);
                          }
                        }}
                      >
                        <label htmlFor={`${id}-anchor`}>Anchor</label>
                        <input
                          id={`${id}-anchor`}
                          type="text"
                          spellCheck={false}
                          value={staged.anchor}
                          data-invalid={staged.anchor.trim() === "" ? "true" : undefined}
                          onChange={(event) => patch({ anchor: event.target.value })}
                        />
                        {anchorFocus === "perf" ? <AnchorChips onPick={(expr) => patch({ anchor: expr })} /> : null}
                      </div>
                    )}
                    </fieldset>
                    )}
                    {/* Placement (J6, reference `.parameter-group`): where the
                        series draws (spec, Placement) -- which panel of the
                        card's `panels`, and which of that panel's two scales.
                        Above the colour, because a series' place is read before
                        its paint. */}
                    <fieldset className="chart-sel-group">
                    <legend>Placement</legend>
                    <p className="chart-sel-grouphint">Choose the panel and which scale it uses.</p>
                    <div className="chart-sel-frow">
                      <label htmlFor={`${id}-panel`}>Panel</label>
                      <select
                        id={`${id}-panel`}
                        value={staged.panel}
                        onChange={(event) => patch({ panel: Number(event.target.value) })}
                      >
                        {/* "P<n> · <label>", the reference wording (screenshot
                            05: "P1 · Price"), not a bare number. The label comes
                            from the card's own series via panelLabel -- the same
                            helper the Layout editor's sidebar and reorder list
                            use -- so a price panel reads "Price" and a volume
                            panel "Volume". An EMPTY panel's panelLabel is already
                            "P<n>", so it shows just "P2" rather than "P2 · P2". */}
                        {panelNumbers.map((n) => {
                          const label = panelLabel(active, n);
                          return <option key={n} value={n}>{label === `P${n}` ? label : `P${n} · ${label}`}</option>;
                        })}
                      </select>
                    </div>
                    <div className="chart-sel-frow">
                      {/* "Scale side" (J closeout 2026-09-26 item 6 kept the
                          wording; screenshot 05): it names the price scale the
                          series draws against. A native <select>, matching the
                          reference's control (a `.detail-fields select` reading
                          "right"), not the segmented Left/Right toggle the build
                          used -- the reference wins, and a two-option select is
                          no less accessible than the button group it replaces. */}
                      <label htmlFor={`${id}-side`}>Scale side</label>
                      <select
                        id={`${id}-side`}
                        value={staged.side}
                        onChange={(event) => patch({ side: event.target.value as Draft["side"] })}
                      >
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                    </fieldset>
                    {/* Line appearance (J6, reference `.parameter-group`):
                        colour, band shade and hatch, width and pen. The whole
                        group is offered only where the series has a colour of
                        its own -- candlesticks, OHLC bars and the volume are
                        coloured by the THEME (up/down tokens, the text colour),
                        so there is nothing here to pick for them. */}
                    {(entry !== undefined || coloured) && (
                    <fieldset className="chart-sel-group">
                    <legend>Line appearance</legend>
                    <p className="chart-sel-grouphint">Default pen keeps the renderer or registry setting.</p>
                    {(entry !== undefined || coloured) && (
                      <div className="chart-sel-frow">
                        <span id={`${id}-color`}>Color</span>
                        <span className="chart-sel-sws" role="group" aria-labelledby={`${id}-color`}>
                          {swatchesFor(entry, fallbackColor).map((c) => (
                            <button
                              key={c}
                              type="button"
                              aria-label={`Color ${c}`}
                              aria-pressed={c.toLowerCase() === staged.color.toLowerCase()}
                              className="chart-sel-swatch"
                              style={{ background: c }}
                              onClick={() => patch({ color: c })}
                            />
                          ))}
                        </span>
                      </div>
                    )}
                    {/* Shade is the fill between a banded study's two outputs:
                        offered only where the registry says the study bands. */}
                    {entry?.band === true && (
                      <div className="chart-sel-frow">
                        <span id={`${id}-shade`}>Shade</span>
                        <span className="chart-sel-sws" role="group" aria-labelledby={`${id}-shade`}>
                          {swatchesFor(entry, fallbackColor).map((c) => (
                            <button
                              key={c}
                              type="button"
                              aria-label={`Shade ${c}`}
                              aria-pressed={c.toLowerCase() === staged.shade.toLowerCase()}
                              className="chart-sel-swatch"
                              style={{ background: c }}
                              onClick={() => patch({ shade: c })}
                            />
                          ))}
                        </span>
                      </div>
                    )}
                    {/* The band's hatch, offered where Shade is. Beside the
                        select is a live hatch swatch (reference .fill-sample,
                        macro-editor.css:75-78): it draws the chosen hatch in the
                        band's shade colour, so the reader sees the pattern, not
                        just its name. --sample-color is the shade; the swatch is
                        aria-hidden because the select already names the choice. */}
                    {entry?.band === true && (
                      <div className="chart-sel-frow">
                        <label htmlFor={`${id}-pattern`}>Pattern</label>
                        <div className="chart-sel-visual">
                          <select
                            id={`${id}-pattern`}
                            value={staged.fillPattern}
                            onChange={(event) => patch({ fillPattern: event.target.value as Draft["fillPattern"] })}
                          >
                            <option value="default">Default</option>
                            {FILL_PATTERNS.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                          <span className="chart-sel-sample chart-sel-fill" data-value={staged.fillPattern} style={{ ["--sample-color"]: staged.shade } as CSSProperties} aria-hidden="true" />
                        </div>
                      </div>
                    )}
                    {(entry !== undefined || coloured) && (
                      <div className="chart-sel-frow">
                        <label htmlFor={`${id}-width`}>Width</label>
                        <input
                          id={`${id}-width`}
                          type="number"
                          min={1}
                          max={4}
                          step={1}
                          value={staged.width}
                          // Clamped rather than validated: a cleared or absurd
                          // width is not a wire error the way a param is, and a
                          // `0` would simply draw nothing.
                          onChange={(event) => patch({ width: Math.min(4, Math.max(1, Number(event.target.value) || 1)) })}
                        />
                      </div>
                    )}
                    {/* "Show value on the price axis" (user, 2026-09-27: "when
                        the user chooses a study, they should have the option to
                        either display or not display and that would be defined
                        in the study setup"). It draws this series' value on its
                        panel's axis in the series' OWN colour -- one label per
                        output line, so a banded study puts up three.

                        It does NOT replace the parameters row's "Display study
                        values": that governs the crosshair readout above the
                        plot and stays whole-card, which is what the user asked
                        for. This is per study, and the two are independent.

                        Same `entry !== undefined || coloured` gate as Width and
                        Pen rather than a study-only one: the label means exactly
                        the same thing on a line or area series, and inventing a
                        third gate for one checkbox would be the odd one out. */}
                    {(entry !== undefined || coloured) && (
                      <div className="chart-sel-frow">
                        <span>Price axis</span>
                        <label className="chart-sel-tick">
                          <input
                            id={`${id}-axisvalue`}
                            type="checkbox"
                            checked={staged.axisValue}
                            onChange={(event) => patch({ axisValue: event.target.checked })}
                          />
                          Show value
                        </label>
                      </div>
                    )}
                    {/* Which of a study's OUTPUT lines are drawn (spec
                        2026-09-27; user: "for series that return bands is
                        there an option to only display the actual level and
                        not all three?"). One tick per output, named as the
                        registry names it.

                        Only for a study with MORE THAN ONE output: a single
                        output has nothing to choose between, and most of the
                        catalog is single-output, so this row would otherwise
                        be a permanent no-op on nearly every study.

                        The last tick cannot be cleared. A study drawing none
                        of its outputs still costs a request and still warms
                        up, and on screen it is indistinguishable from a broken
                        feed -- so the refusal is here, and the renderer reads
                        an empty list as "all" for anything hand-edited. */}
                    {entry !== undefined && entryOutputs(entry).length > 1 && (
                      <div className="chart-sel-frow chart-sel-outputs">
                        <span>Lines</span>
                        <div>
                          {entryOutputs(entry).map((name) => {
                            const on = staged.outputs.includes(name);
                            const last = on && staged.outputs.length === 1;
                            return (
                              <label key={name} className="chart-sel-tick">
                                <input
                                  type="checkbox"
                                  checked={on}
                                  disabled={last}
                                  onChange={() => patch({
                                    outputs: on
                                      ? staged.outputs.filter((k) => k !== name)
                                      // Re-ticked in the ENTRY's order, not in
                                      // click order, so the saved list reads
                                      // the way the registry declares it.
                                      : entryOutputs(entry).filter((k) => k === name || staged.outputs.includes(k)),
                                  })}
                                />
                                {name}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {/* The pen (lib/chart/pen.ts): the library's five line
                        styles. The select names the choice; beside it a live
                        line swatch draws it (reference .pen-sample,
                        macro-editor.css:70-74). The old comment here claimed
                        there was "nothing to draw a preview of" -- that is what
                        audit S6/R3 (2026-09-26) reversed: the reference CSS DOES
                        draw dotted/dashed/large-dashed/sparse-dotted line
                        samples, so the build now does too. --sample-color is the
                        series colour; the swatch is aria-hidden because the
                        select already carries the accessible name. */}
                    {(entry !== undefined || coloured) && (
                      <div className="chart-sel-frow">
                        <label htmlFor={`${id}-pen`}>Pen</label>
                        <div className="chart-sel-visual">
                          <select
                            id={`${id}-pen`}
                            value={staged.pen}
                            onChange={(event) => patch({ pen: event.target.value as Draft["pen"] })}
                          >
                            <option value="default">Default</option>
                            {PENS.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                          <span className="chart-sel-sample chart-sel-pen" data-value={staged.pen} style={{ ["--sample-color"]: staged.color } as CSSProperties} aria-hidden="true" />
                        </div>
                      </div>
                    )}
                    </fieldset>
                    )}
                  </>
                )}
                {/* The one-line reading -- the registry's for a study, ours for
                    a price row -- above the footer's rule (user ruling
                    2026-09-17): only the buttons sit below it.
                    J closeout (2026-09-26, item 6): a study WITH parameters now
                    shows this reading as the Study-parameters group intro instead
                    (reference 05), so it is skipped here to avoid doubling. A
                    price row, a performance line and a no-param study (which has no
                    Study-parameters group) still read it here. */}
                {reading !== "" && !(entry !== undefined && entry.params.length > 0) && (
                  <p className="chart-sel-desc">
                    {reading}
                    {wiki !== undefined && <> <a href={wiki} target="_blank" rel="noopener noreferrer">{referenceLabel(wiki)}</a></>}
                  </p>
                )}
                </div>
                {/* The expression box reads ABOVE the commit row (user,
                    2026-09-27: "Add to chart and add to favorites should be on
                    the bottom"). Typing a series by hand is another way to fill
                    the SAME staged pick the list fills, so it belongs with the
                    fields, and the commit row is what closes the pane -- it
                    reads last, where a footer is looked for. */}
                {/* The saved-BUNDLE controls are gone (user, 2026-09-27:
                    "remove the bottom row for favorite management"). `Saved
                    series…`, `Apply` and `Save as…` recalled and wrote a
                    snapshot of the WHOLE card's series list -- a third
                    save-and-recall concept beside macros and, now, Favorites.
                    Macros already carry panels AND series, so the bundle was
                    the redundant one; Favorites covers the "keep this one
                    series" case it was being used for.

                    Nothing on disk is deleted: chart-presets.json keeps every
                    bundle, the renderer still reads it for the strip's
                    "saved series" note, and an older build still lists them.
                    This removes the way IN from here, not the data.

                    The expression box stays -- typing a series by hand is not
                    favourite management and has no replacement. (No hex
                    example here: the colour audit greps this file's comments
                    too, and rightly.) */}
                <div className="chart-sel-expr" data-keys="own">
                  <input
                    aria-label="Add a series expression"
                    placeholder={placeholder}
                    value={text}
                    disabled={unavailable}
                    spellCheck={false}
                    data-invalid={invalid ? "true" : undefined}
                    onChange={(e) => { setText(e.target.value); setInvalid(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
                  />
                </div>
                <div className="chart-sel-foot">
                  {/* Favorites (item 6/7): when the STAGED row is a favorite,
                      the checkbox's place holds a Remove button instead -- the
                      list rows are already interactive, so removal lives here,
                      not nested inside a row. The checkbox commits the
                      just-built series to Favorites; both are hidden when the
                      matching callback is not supplied.
                      It reads BEFORE the primary button (user, 2026-09-27):
                      the tick is a decision you make about the commit, so it
                      belongs on the way to the button, not past it. */}
                  {staged?.favorite !== undefined
                    ? (onRemoveFavorite !== undefined && (
                        <button
                          type="button"
                          className="bd-button"
                          onClick={() => { if (staged?.favorite) { onRemoveFavorite(staged.favorite.name); setDraft(null); } }}
                        >
                          Remove from Favorites
                        </button>
                      ))
                    : (onAddFavorite !== undefined && (
                        <label className="chart-sel-fav">
                          <input type="checkbox" checked={addFav} onChange={(e) => setAddFav(e.target.checked)} />
                          Add to Favorites
                        </label>
                      ))}
                  {/* No Cancel of this pane's own (Task 6): the Layout editor's
                      footer carries the one Cancel that abandons the whole
                      edit, and a series pick still applies at once (D2) --
                      there is nothing left for a second Cancel here to undo. */}
                  <button
                    type="button"
                    className="bd-button bd-button--primary"
                    disabled={staged === null || (isStudy && entry === undefined) || incomplete}
                    onClick={() => commit(staged)}
                  >
                    {editing === null ? "Add to chart" : "Update"}
                  </button>
                </div>
              </div>
    </>
  );

  const body = (
    <>
      {/* The section bar (J6, reference `.section-bar`): the "Series
          configuration" header, and "+ Add series" on the right. The "+" is an
          aria-hidden span so the button's accessible name stays "Add series"
          (generated/visible glyphs otherwise fold into the accessible name). */}
      <div className="chart-sel-bar">
        <div>
          <h3 className="chart-sel-bartitle">Series configuration</h3>
          <p className="chart-sel-barhint">Drag to reorder. Select a series to edit.</p>
        </div>
        <button
          type="button"
          className="bd-button"
          // A fresh pick: hand `null` UP so the parent clears its `editing` and
          // the editor remounts in add mode (Change open). The local resets
          // cover the already-adding case, where nothing changes upstream and
          // so nothing remounts.
          // ...and open the catalog in the wide modal (2026-09-27 brief): the
          // detail column is too narrow for it.
          //
          // It does NOT clear the edited series on the way in any more. That
          // call is what broke this for the owner: the renderer keys the Layout
          // editor `editing ?? "layout"`, so clearing a selection remounted the
          // editor, this component with it, and `addOpen` went back to false
          // before the modal could render. Nothing happened, and only when a
          // series was selected -- which is why it looked intermittent. The
          // clear moved to `closeAdd`, and `commit` treats an open modal as an
          // add regardless of what `editing` still holds.
          onClick={() => { setChangeOpen(true); setDraft(null); setAddOpen(true); }}
        >
          <span aria-hidden="true">+ </span>Add series
        </button>
      </div>
      <div className="chart-sel-body">
        {/* LEFT: the item-list of the card's series (J6). Clicking a row hands
            its id UP (onEditSeries); the grip reorders (onReorderSeries),
            reusing the chip strip's within-panel drag idiom. */}
        {/* "Card series", not "Series": the chip strip behind the editor
            already owns the accessible name "Series", and two same-named lists
            in one tree is an ambiguity a screen reader cannot resolve. */}
        {/* The left column wraps the scrolling item-list AND the reorder hint
            below it, so the hint stays pinned under the list rather than becoming
            a third cell of the two-column `.chart-sel-body` grid (J closeout,
            item 6). The column owns the divider border the list used to carry. */}
        <div className="chart-sel-itemcol">
        <ul className="chart-sel-itemlist" aria-label="Card series">
          {/* Empty state (master-detail 2026-09-26): a scoped list with no
              series on the selected panel says so rather than showing a bare
              void. Only when the list IS scoped -- an unfiltered mount with no
              series (a fresh card, the palette's own tests) keeps its empty
              <ul> unchanged. */}
          {filterPanel !== undefined && itemSeries.length === 0 && (
            <li className="chart-sel-item-empty">No series on this panel yet. Use “+ Add series”.</li>
          )}
          {itemSeries.map((s) => (
            // The row is the drag handle (the grip is its affordance); the
            // click-to-edit lives on the button inside it, as StudiesStrip's
            // chip does.
            <li
              key={s.id}
              className="chart-sel-item"
              data-selected={editing?.id === s.id ? "true" : undefined}
              data-dragging={dragging === s.id ? "true" : undefined}
              draggable={onReorderSeries !== undefined}
              onDragStart={(event) => {
                event.dataTransfer.setData(STUDY_REORDER_DRAG_TYPE, s.id);
                // Without effectAllowed the cursor shows a copy badge.
                event.dataTransfer.effectAllowed = "move";
                setDragging(s.id);
              }}
              onDragEnd={() => setDragging(null)}
              // Without preventDefault the browser fires no drop at all;
              // gating on the type refuses everything else.
              onDragOver={(event) => { if (carriesItem(event)) event.preventDefault(); }}
              onDrop={(event) => { if (carriesItem(event)) dropItem(event, s); }}
            >
              <span className="chart-sel-grip" aria-hidden="true">⠿</span>
              <button
                type="button"
                className="chart-sel-item-choice"
                aria-pressed={editing?.id === s.id}
                onClick={() => onEditSeries?.(s.id)}
                // The row's button is what takes focus, so the keyboard reorder
                // lives here rather than on the <li> (which is not focusable).
                // Alt is required, so plain arrows keep their normal meaning.
                onKeyDown={(e) => {
                  if (onReorderSeries === undefined || !e.altKey) return;
                  if (e.key === "ArrowUp") { e.preventDefault(); moveItem(s, -1); }
                  if (e.key === "ArrowDown") { e.preventDefault(); moveItem(s, 1); }
                }}
              >
                <strong>{seriesLabel(s)}</strong>
                <small>P{s.panel} · {s.side} scale</small>
              </button>
            </li>
          ))}
        </ul>
        {/* The list-footer reorder hint (J closeout, item 6; reference 05 shows
            it under the "Series configuration" list). The same verbatim copy the
            LayoutEditor sidebar uses for its grips. Both halves of it are real:
            drag goes through onDrop/dropItem, and Alt+arrow through the row
            button's onKeyDown (see moveItem). They share one arithmetic and one
            cross-panel constraint, so the two cannot drift apart. */}
        <p className="chart-sel-listhint">Drag the grip to reorder. Keyboard: Alt + ↑ / ↓.</p>
        </div>
        {/* RIGHT: the detail. */}
        <div className="chart-sel-detail">
              {/* The detail column's heading (J closeout, item 6; reference 05
                  captions the detail "Series parameters", above the kind block).
                  Distinct from the "Study parameters" fieldset legend below -- this
                  names the whole column, that names one group of fields. */}
              <h3 className="chart-sel-detailtitle">Series parameters</h3>
              {/* The detail belongs in the column only while EDITING an existing
                  series (2026-09-27 brief). Adding puts it in the wide modal, and
                  when neither is happening -- add mode with the modal closed, e.g.
                  just after a commit -- the column shows its heading and nothing
                  else, never the catalog crushed into ~444px again. Gated on
                  `!addOpen` too so a mocked open (editing set AND addOpen, which
                  only the tests reach; production remounts to editing===null)
                  still renders `detail` in exactly one place. */}
              {editing !== null && !addOpen ? detail : null}
            </div>
          </div>
      {/* + Add series (2026-09-27 brief): the catalog and configuration open in
          a CENTRED modal, wide enough to hold them. The detail is rendered here
          while adding and in the .chart-sel-detail column while editing, never
          both. The modal lives INSIDE .chart-sel so this component's onKey (the
          up/down/Enter list keyboard) still reaches the catalog within it, and
          does not also reach the list behind it -- there is no list behind it,
          the column shows only its heading while the modal is open. */}
      {addOpen && (
        <AddSeriesModal titleId={`${id}-addtitle`} onClose={closeAdd}>
          <div className="chart-sel-addcols">
            {/* LEFT: the categories, scrolling on their own -- Favorites
                first, then Price & volume, then the registry's own groups. */}
            <div className="chart-sel-addcat">
              {catalogHead}
              {catalogList}
            </div>
            {/* RIGHT: the parameters for whatever is staged, scrolling on
                their own. `.chart-sel-detail` is what gives this pane the
                column layout and padding the modal body used to carry. */}
            <div className="chart-sel-detail chart-sel-addcfg">{detail}</div>
          </div>
        </AddSeriesModal>
      )}
    </>
  );

  // The modal owns the dialog, the veil, the focus trap and Escape (Task 6,
  // spec 2026-09-24, D1): this pane renders in place, keeping its own
  // keyboard for the list (↑↓, and Enter to stage then apply) but not the
  // Escape that would close a modal that is not this component's to close.
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- no role="dialog" here; the modal owns that semantics
    <div className="chart-sel chart-sel-inline" onKeyDown={onKey}>
      {body}
    </div>
  );
}
