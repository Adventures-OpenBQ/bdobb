// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { CURRENT_DATE_TOKEN } from "./params";
import { DEFAULT_ZONES } from "./zones";
import type { WidgetDef } from "./types";

/**
 * Reserved: no BackendConfig may carry this id. That is what keeps the
 * built-ins safe in the registry without special-casing — applyDiscovery only
 * replaces widgets belonging to backends that came back online, and no
 * discovery result can name this one.
 */
export const BUILTIN_BACKEND_ID = "builtin";

/**
 * The one built-in a file drop creates. Named here because three other files
 * have to agree on it: the drop zone that adds the card, the store that
 * deletes the card's stored file, and the library that hides the widget.
 */
export const LOCAL_TABLE_ID = "local_table";

/**
 * The RSS built-in's default item count. Named because RssRenderer falls back
 * to the same number when a persisted card's `limit` is missing or unusable,
 * and a second literal there would eventually disagree with this one.
 */
export const RSS_DEFAULT_LIMIT = 20;

const base: Pick<WidgetDef, "backendId" | "category" | "subCategory" | "endpoint" | "source"> = {
  backendId: BUILTIN_BACKEND_ID,
  category: "Built-in",
  subCategory: "",
  endpoint: "",
  source: [],
};

export const BUILTIN_WIDGETS: WidgetDef[] = [
  {
    ...base,
    id: "note",
    name: "Note",
    description: "A free-text markdown note.",
    type: "note",
    gridData: { w: 15, h: 8 },
    // Hidden from the parameter panel: a single-line text control is the
    // wrong shape for prose, so the note is edited in the card body instead.
    // It stays a param so it persists with the dashboard like anything else.
    params: [{ paramName: "text", label: "Text", type: "text", show: false }],
  },
  {
    ...base,
    id: "markdown",
    name: "Markdown",
    description: "A rich-text markdown note with a formatting toolbar.",
    // Not `markdown`: that type is the backend-payload renderer's. The text
    // is the same hidden param the note uses, for the same reason -- prose
    // is edited in the card body, and persists like any other param.
    type: "markdown_editor",
    gridData: { w: 20, h: 14 },
    params: [{ paramName: "text", label: "Text", type: "text", show: false }],
  },
  {
    ...base,
    id: "website",
    name: "Website",
    description: "Frames any web page.",
    type: "iframe",
    gridData: { w: 24, h: 16 },
    params: [
      {
        paramName: "url",
        label: "URL",
        type: "text",
        description:
          "Many sites refuse to be embedded — Google, most banks and most webmail send X-Frame-Options and will show blank. Use Open externally for those.",
      },
    ],
  },
  {
    ...base,
    id: "clock",
    name: "Clock",
    description: "Current time across several markets.",
    type: "clock",
    gridData: { w: 22, h: 16 },
    params: [
      {
        paramName: "zones",
        label: "Time zones",
        type: "text",
        value: DEFAULT_ZONES,
        description: "Comma-separated IANA zone names, in display order.",
      },
      {
        paramName: "layout",
        label: "Layout",
        value: "vertical",
        options: [
          { label: "Vertical", value: "vertical" },
          { label: "Horizontal", value: "horizontal" },
        ],
      },
      {
        paramName: "hourCycle",
        label: "Hour format",
        value: "24",
        options: [
          { label: "24-hour", value: "24" },
          { label: "12-hour", value: "12" },
        ],
      },
      {
        paramName: "face",
        label: "Face",
        value: "dots",
        options: [
          { label: "Dot matrix", value: "dots" },
          { label: "Solid", value: "solid" },
        ],
        // The trailing sentence is required: WidgetParam has no conditional
        // visibility, so this control stays visible but inert under the
        // horizontal layout and the description has to say so.
        description: "Only applies to the Vertical layout.",
      },
    ],
  },
  {
    ...base,
    id: "rss",
    name: "RSS feed",
    description: "Headlines from any RSS or Atom feed.",
    type: "rss",
    gridData: { w: 20, h: 12 },
    params: [
      { paramName: "url", label: "Feed URL", type: "text", show: true },
      {
        paramName: "limit",
        label: "Items",
        type: "number",
        value: String(RSS_DEFAULT_LIMIT),
        show: true,
      },
    ],
  },
  {
    ...base,
    id: "param_echo",
    name: "Parameter echo",
    description: "Shows the parameter values a widget would send. For trying out parameter groups.",
    type: "param_echo",
    gridData: { w: 14, h: 6 },
    // `ticker` declares groupType so it can join a `symbol` group on a card
    // whose control is named differently — the one cross-name join the
    // reference backend can demonstrate. `date` infers `date`; `year` infers
    // its own name and so joins the reference app's Group 2 (`year`).
    params: [
      { paramName: "ticker", label: "Ticker", type: "text", value: "AAPL", groupType: "symbol" },
      { paramName: "date", label: "Date", type: "date", value: CURRENT_DATE_TOKEN },
      {
        paramName: "year",
        label: "Year",
        value: "2024",
        options: [
          { label: "2024", value: "2024" },
          { label: "2023", value: "2023" },
          { label: "2022", value: "2022" },
        ],
      },
    ],
  },
  {
    ...base,
    id: LOCAL_TABLE_ID,
    name: "Local file",
    description: "A table from a file on this computer.",
    type: LOCAL_TABLE_ID,
    gridData: { w: 24, h: 14 },
    // Hidden from the parameter panel for the same reason the note's text is:
    // the stored file name is a uuid the user never typed and cannot usefully
    // edit. It stays a param so it persists with the dashboard like anything
    // else. The widget itself is hidden from the library (WidgetLibrary.tsx) --
    // a card only makes sense created by a drop, which is what puts a file
    // behind this param.
    params: [{ paramName: "file", label: "File", type: "text", show: false }],
  },
];

/**
 * OpenBB's server-side row model table, in both the spellings OpenBB's own
 * documents use. The ssrm_mode page and the official example backend
 * (backend-examples-for-openbb-workspace, widget-examples/ssrm_mode) both say
 * `"ssrm_table"`, while the widgets.json reference page enumerates
 * `"table_ssrm"` — so `"ssrm_table"` is the spelling to trust and the other is
 * matched too. The whole point of recognising the type is that an
 * unrecognised SSRM widget renders as a broken table, and a second string is a
 * set entry rather than a code path. Nothing anywhere treats them differently.
 */
export const SSRM_TYPES = new Set(["ssrm_table", "table_ssrm"]);

/**
 * A card fetches unless its widget frames a URL, the app supplies it, it's the
 * keys surface, its documents are reached by a POST, or it is a server-side
 * row model table.
 *
 * An iframe widget's endpoint IS the URL, used verbatim as the frame src —
 * joining it onto a backend base would produce a nonsense request. A built-in
 * has no backend behind it at all. A keys widget lives in Settings now, not
 * as a card: a persisted card renders a fixed notice (see WidgetCard's body())
 * and must never pull the tier-3 payload, whose rows carry the plaintext
 * credential, just to display nothing with it. A multi_file_viewer's endpoint
 * answers 405 to a GET — its documents come back from a POST that
 * MultiFileRenderer issues once the reader has picked files — so a card-level
 * fetch could only ever produce an error card. An SSRM endpoint answers a POST
 * carrying the row range the grid asked for, so a GET from this app is at best
 * a 405 and at worst an answer this app cannot read — either of which would
 * show as an error card or an empty table rather than as "not supported". A
 * `pdf` widget is deliberately NOT here: it is an ordinary GET. Keeping all
 * five in one predicate is what stops "do not fetch" from spreading into a
 * scatter of type checks. A `settings` widget is a section of the Settings
 * dialog, never a card, and key-maint's points at the very `/keys` endpoint
 * whose tier-3 rows carry plaintext credentials -- a card that named one (an
 * imported dashboard) must not fetch it. (With `live_grid`, `omni` and
 * `settings` the predicate now holds eight checks, not five.)
 */
export function fetchesData(widget: WidgetDef): boolean {
  return (
    widget.type !== "iframe" &&
    widget.type !== "keys" &&
    widget.type !== "settings" &&
    widget.type !== "multi_file_viewer" &&
    // A live_grid fetches its own snapshot and then streams; an omni POSTs on
    // prompt submit. Both own their requests, so the card must not also fetch,
    // and its data===null gate must not preempt the renderer.
    widget.type !== "live_grid" &&
    widget.type !== "omni" &&
    // advanced_charting's renderer asks `{endpoint}/history` itself; the
    // endpoint is a UDF base, and fetching it bare is a 404.
    widget.type !== "advanced_charting" &&
    !SSRM_TYPES.has(widget.type) &&
    widget.backendId !== BUILTIN_BACKEND_ID
  );
}
