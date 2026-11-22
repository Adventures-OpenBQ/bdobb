// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import type { ComponentType } from "react";
import type { HostDates } from "./dates";
import type { BackendConfig, DashboardCard, Granularity, ParamGroup, WidgetDef, WidgetParam } from "../lib/types";

/**
 * What the Relative tab is handed -- bdobb-v2 RelativeTab's own type, with
 * `presets` narrowed to `never[]`: the chart saves none (RangePopover,
 * SeriesPalette pass `[]`), and `never[]` is assignable to a host's preset type.
 */
export type RelativeContext = {
  preview: (expr: string) => { text: string; fallback: boolean; reason?: string } | null;
  presets: never[];
  onSavePreset?: (name: string, expr: string) => void;
  onDeletePreset?: (name: string) => void;
};
export type RelativeType = "date" | "date_range" | "datetime" | "week" | "quarter" | "fiscal_year" | "quarter_range";

export type DatetimePickerProps = {
  label: string; value: string; granularity?: Granularity; disabled?: boolean;
  onChange: (value: string) => void; relative?: RelativeContext; stored?: string;
};
export type RelativeTabProps = {
  type: RelativeType; label: string; value: string; context: RelativeContext;
  onApply: (expr: string) => void; anchorPresets?: boolean;
};
export type AnchorChipsProps = { onPick: (expr: string) => void; accepts?: (expr: string) => boolean };
export type GroupLinkProps = {
  card: DashboardCard; param: Pick<WidgetParam, "paramName" | "type" | "groupType" | "label">;
  groups: ParamGroup[] | undefined; groupsDisabled: boolean; value: string; fiscalYearEnd?: number;
};

/**
 * The file system, Tauri plugin-fs shaped. A relative path resolves under
 * the host's app-data directory; an absolute one (a picked import file) is
 * used as given. Options the chart passes are `{}` or `{ append }` /
 * `{ recursive }` only -- the chart never names a directory.
 */
export type HostFs = {
  exists: (path: string, options?: object) => Promise<boolean>;
  readTextFile: (path: string, options?: object) => Promise<string>;
  writeTextFile: (path: string, data: string, options?: { append?: boolean }) => Promise<void>;
  readDir: (path: string, options?: object) => Promise<{ name: string; isFile: boolean; isDirectory: boolean }[]>;
  rename: (oldPath: string, newPath: string, options?: object) => Promise<void>;
  remove: (path: string, options?: object) => Promise<void>;
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  stat: (path: string, options?: object) => Promise<{ size: number }>;
};

/** Tauri plugin-dialog shaped: the two calls the chart makes. */
export type HostDialog = {
  open: (options: { multiple?: boolean; filters?: { name: string; extensions: string[] }[] }) => Promise<string | string[] | null>;
  confirm: (message: string, options?: { title?: string; kind?: "info" | "warning" | "error"; okLabel?: string; cancelLabel?: string }) => Promise<boolean>;
};

/** The three dashboard-store actions ChartGroupChip takes (bdobb-v2 dashboardStore signatures). */
export type GroupActions = {
  createGroup: (cardId: string, paramName: string, groupType: string, value: string) => Promise<string | null>;
  joinGroup: (groupId: string, cardId: string, paramName: string) => Promise<void>;
  dropUngroupable: (cardId: string, paramNames: string[]) => Promise<void>;
};

/**
 * One request to the arts-charts server: `path` is server-relative
 * (`/charts`, `/charts/<id>`, `/charts/events`), and the host adds the
 * server's address and credentials -- fetch-shaped, so the change feed's
 * stream can carry the same auth headers as every other call.
 */
export type ChartsFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** Everything Art's Charts needs from the app it runs in. */
export type ArtsChartsHost = {
  /** The host's date grammar (spec 2026-11-04 §1, S4): Art's Charts carries none. BDOBB
   *  supplies its own date grammar; a host without one resolves literals only. */
  dates: HostDates;
  /** GET `{backend}/{path}?{params}` with the backend's auth; empty values omitted; the parsed JSON. */
  fetchWidgetPath: (backend: BackendConfig, path: string, params: Record<string, string>) => Promise<unknown>;
  /** The widget's socket URL with its parameters wired (expressions resolved), empty values omitted, auth applied; null when the widget has no wsEndpoint. */
  buildWidgetWsUrl: (backend: BackendConfig, widget: WidgetDef, params?: Record<string, string>) => string | null;
  fs: HostFs;
  dialog: HostDialog;
  /** Save `text` through the platform's save picker; false when cancelled. */
  saveTextFile: (name: string, filterName: string, text: string, extension?: string) => Promise<boolean>;
  saveBinaryFile: (name: string, filterName: string, bytes: Uint8Array, extension: string) => Promise<boolean>;
  openUrl: (url: string) => Promise<void>;
  log: (level: "info" | "error", message: string) => Promise<void> | void;
  /** A hook: the effective theme, re-rendering its caller when it changes. */
  useResolvedTheme: () => "dark" | "light";
  groups: GroupActions;
  /**
   * The arts-charts server holding chart documents (shared chart documents,
   * step 1b). Absent: no server, and every card is the card it always was.
   */
  chartsFetch?: ChartsFetch;
  /** Fresh ticketed accepted-data URL on EVERY reconnect. Never persist its ticket.
   *  Used only after widgets.json advertises live_chart.extra_metadata.chart_stream_v1. */
  chartStreamUrl?: (backend: BackendConfig) => Promise<string>;
  /**
   * The chart server's WebSocket URL (`ws:` or `wss:`, no query) for a
   * server-relative path (`/ta_series_ws`); the card adds its own parameters.
   * A live card (`live: "true"`, below) takes its studies from there, computed
   * over the same composed bars as its `/series` and Rita's describe_chart.
   * The URL carries no credentials: a browser cannot set the Basic header on a
   * WebSocket, so at v12 the gateway in front of the chart server adds the
   * stack's pair to the upgrade request (user ruling 2026-10-26). Absent: a
   * live card's studies come from the backend's study socket, as before.
   */
  chartsSocketUrl?: (path: string) => string;
  /** Show the card bound to this chart document: focus one already open, else open one (the inbox's Open chart). Absent: no Open chart. */
  openChart?: (chartId: string) => void;
  /**
   * Add a chart card to the dashboard in view (spec §4, Add to dashboard). Absent: no Add buttons.
   * Without options: params `{ chart_id }`, as before. With `{ live: true }` (live composed bars
   * §5, Add as live chart): params `{ chart_id, live: "true" }` on the host's live backend -- one
   * with a `tickUrl`, or the managed `/grid` relay, where the card streams the forming bar -- or,
   * with neither, on the chart server's own connection, where the forming bar is `/series`' own at
   * each 5 s poll. Either way it reads its bars from `chartsFetch`'s `/series`. The document does
   * not change (L2).
   */
  addToDashboard?: (chartId: string, options?: { live?: boolean }) => void;
  components: {
    DatetimePicker: ComponentType<DatetimePickerProps>;
    RelativeTab: ComponentType<RelativeTabProps>;
    AnchorChips: ComponentType<AnchorChipsProps>;
    GroupLink: ComponentType<GroupLinkProps>;
  };
};

let current: ArtsChartsHost | null = null;

/** Set the host. Call once at startup (the chart-layouts store may be used before any chart mounts); `<ArtsChartsRenderer host>` calls it too. */
export function configureArtsCharts(host: ArtsChartsHost): void {
  current = host;
}

export function getHost(): ArtsChartsHost {
  if (current === null) {
    throw new Error("Art's Charts has no host: call configureArtsCharts(host) or pass <ArtsChartsRenderer host={…}>");
  }
  return current;
}

export function __resetHostForTests(): void {
  current = null;
}
export type { HostDates } from "./dates";
