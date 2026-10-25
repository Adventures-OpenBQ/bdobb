// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { confirm } from "@tauri-apps/plugin-dialog";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useModalDialog } from "../../hooks/useModalDialog";
import { useScreenSize } from "../../hooks/useScreenSize";
import { DASHBOARD_REORDER_DRAG_TYPE } from "../../lib/dragDrop";
import { buildTree, type FolderNode, type FolderTree } from "../../lib/folderTree";
import type { SavedLayout } from "../../lib/layoutsFile";
import { nextUntitledName } from "../../lib/naming";
import type { Dashboard } from "../../lib/types";
import {
  COMMON_SIZES,
  MIN_RES_LIMITS,
  type MinResolution,
  type ScreenInfo,
  type ScreenSize,
  describeMinResolution,
  isMinResolution,
  listScreens,
  pickLaunchWorkspace,
  screenChoices,
  zoomFor,
} from "../../lib/screenFit";
import { arrangementOf, type Workspace } from "../../lib/workspacesFile";
import {
  GRID_SIZE,
  PRESETS,
  type PresetId,
  type TilePlacement,
  type TileRect,
  hiddenEntries,
  hiddenNote,
  placeTiles,
  readingOrder,
  reseat,
  tileLetter,
} from "../../lib/workspacePresets";
import { useDashboardStore } from "../../stores/dashboardStore";
import { useFoldersStore } from "../../stores/foldersStore";
import {
  assignDraftSlot,
  type DraftSlot,
  effectiveWorkspace,
  overlayDraft,
  useWorkspacesStore,
} from "../../stores/workspacesStore";
import { InlineRename } from "../InlineRename";
import { RowContextMenu } from "../RowContextMenu";
import { DialogShell } from "./DialogShell";

/** The body's id, which DialogShell puts on its section. Nothing else refers to it. */
const BODY_ID = "workspace-dialog-body";

/** Dashboard id -> name: everything here that has to say what a tile holds reads this. */
type Names = ReadonlyMap<string, string>;

/**
 * The miniatures and the preview are drawn from an arrangement's own tiles
 * on the same 12 × 12 grid the workspace uses -- no hand-made icons -- so a
 * saved layout or a hand-arranged workspace is drawn with no change here
 * (spec 2026-10-01 §4). `minmax(0, 1fr)`, not plain `1fr`, so a long
 * dashboard name cannot widen its column.
 */
const GRID_STYLE: CSSProperties = {
  gridTemplateColumns: `repeat(${GRID_SIZE}, minmax(0, 1fr))`,
  gridTemplateRows: `repeat(${GRID_SIZE}, minmax(0, 1fr))`,
};

/** One tile's cells on that grid. */
function tileArea(t: TileRect): CSSProperties {
  return { gridColumn: `${t.x + 1} / span ${t.w}`, gridRow: `${t.y + 1} / span ${t.h}` };
}

/**
 * What a tile shows: a dashboard's name, the "New dashboard" placeholder, or
 * null for an empty tile. A slot naming a dashboard that no longer exists is
 * EMPTY here, exactly as WorkspaceTile treats it on the grid: it reads
 * "Empty", counts as empty for selection, and its id is never shown.
 */
function tileLabel(slots: DraftSlot[], slot: string, names: Names): string | null {
  const entry = slots.find((s) => s.slot === slot);
  if (entry === undefined) return null;
  if ("newDashboard" in entry) return "New dashboard";
  return names.get(entry.dashboardId) ?? null;
}

/**
 * The on-open rule (spec §1 "Assigning"): the first empty tile, else the
 * first tile -- in reading order, the order the letters run (spec 2026-10-01
 * §1).
 */
function firstEmpty(order: readonly string[], slots: DraftSlot[], names: Names): string {
  return order.find((slot) => tileLabel(slots, slot, names) === null) ?? order[0];
}

/** Case-insensitive substring: `includes`, never a RegExp, so "S&P (500)" and "[" are just text. */
function matches(name: string, query: string): boolean {
  return name.toLowerCase().includes(query);
}

/** One folder cut down to its matching dashboards and the folders above them; null when nothing under it matches. */
function filterNode(node: FolderNode, query: string): FolderNode | null {
  const children = node.children.flatMap((child) => filterNode(child, query) ?? []);
  const dashboards = node.dashboards.filter((d) => matches(d.name, query));
  return children.length > 0 || dashboards.length > 0 ? { ...node, children, dashboards } : null;
}

/** The tree with only what matches `query`. Same shape as buildTree's, so it renders through the same rows. */
function filterTree(tree: FolderTree, query: string): FolderTree {
  return {
    folders: tree.folders.flatMap((node) => filterNode(node, query) ?? []),
    dashboards: tree.dashboards.filter((d) => matches(d.name, query)),
  };
}

/**
 * Indent by depth. Inline geometry is fine here, unlike in the rail (see
 * LeftRail's rowIndent): the dialog has no collapsed state for it to fight.
 */
function indent(depth: number): CSSProperties {
  return { paddingLeft: `calc(var(--bd-s2) + ${depth * 16}px)` };
}

/** An arrangement in miniature: one cell per tile, drawn from the tiles themselves. */
function ThumbGrid({
  tiles,
  className = "bd-ws-thumb-grid",
  style = GRID_STYLE,
}: {
  tiles: readonly TileRect[];
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={className} style={style} aria-hidden="true">
      {tiles.map((t, n) => (
        <span key={n} style={tileArea(t)} />
      ))}
    </span>
  );
}

/** One layout in the strip: a preset, a saved layout, or Custom. */
function LayoutThumb({
  name,
  tiles,
  selected,
  onSelect,
  onContextMenu,
}: {
  name: string;
  tiles: readonly TileRect[];
  selected: boolean;
  onSelect: () => void;
  onContextMenu?: (e: ReactMouseEvent) => void;
}) {
  return (
    <button
      type="button"
      className="bd-ws-thumb"
      aria-label={name}
      aria-pressed={selected}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      <ThumbGrid tiles={tiles} />
      <span className="bd-ws-thumb-name">{name}</span>
    </button>
  );
}

/** A workspace card's thumbnail size: 72px wide, as tall as its minimum's aspect says (16:9 for Any size). */
function cardThumbStyle(min: MinResolution | undefined): CSSProperties {
  const ratio = min === undefined ? 9 / 16 : min.height / min.width;
  return { ...GRID_STYLE, width: "72px", height: `${Math.round(Math.min(56, Math.max(24, 72 * ratio)))}px` };
}

/** "Fits" or "Zoom 50%": what opening `min` on `screen` does (spec 2026-10-12 §3). */
function fitLabel(screen: ScreenSize, min: MinResolution | undefined): string {
  const zoom = zoomFor(screen, min);
  return zoom === 1 ? "Fits" : `Zoom ${Math.round(zoom * 100)}%`;
}

/** The notice strip's sentence (spec 2026-10-12 §7). */
function fitSentence(screen: ScreenSize, min: MinResolution | undefined): string {
  if (min === undefined) return "Any size fits every screen.";
  const zoom = zoomFor(screen, min);
  const size = describeMinResolution(min);
  return zoom === 1
    ? `Minimum ${size} fits, so it lays out at full size.`
    : `Minimum ${size} is larger than this screen. Lays out at ${size}, then zooms everything to ${Math.round(zoom * 100)}%.`;
}

const sizeKey = (s: ScreenSize) => `${Math.round(s.width)}x${Math.round(s.height)}`;

/** The id the launch rule sees for a workspace not saved yet. */
const NEW_ID = "";

/** Which workspace the editor is on; `n` begins a fresh draft even for the same id. */
type Session = { id: string | null; n: number };

/**
 * The Minimum resolution field (spec 2026-10-12 §7): Any size, this
 * machine's screens, common sizes, or Custom with W and H inputs.
 */
function MinResolutionField({
  value,
  screens,
  current,
  onChange,
}: {
  value: MinResolution | null;
  screens: readonly ScreenInfo[];
  current: ScreenSize;
  onChange: (next: MinResolution | null) => void;
}) {
  const choices = useMemo(() => screenChoices(screens), [screens]);
  const common = COMMON_SIZES.filter((c) => !choices.some((s) => sizeKey(s) === sizeKey(c)));
  const listed = new Set([...choices, ...common].map(sizeKey));
  const [custom, setCustom] = useState(() => value !== null && !listed.has(sizeKey(value)));
  const [width, setWidth] = useState(() => String(value?.width ?? Math.round(current.width)));
  const [height, setHeight] = useState(() => String(value?.height ?? Math.round(current.height)));
  const selected = custom || (value !== null && !listed.has(sizeKey(value))) ? "custom" : value === null ? "any" : sizeKey(value);
  const typed = { width: Number(width), height: Number(height) };
  const valid = isMinResolution(typed);

  function choose(next: string) {
    if (next === "any") {
      setCustom(false);
      onChange(null);
      return;
    }
    if (next === "custom") {
      setCustom(true);
      const start = value ?? {
        width: Math.min(MIN_RES_LIMITS.maxWidth, Math.max(MIN_RES_LIMITS.minWidth, Math.round(current.width))),
        height: Math.min(MIN_RES_LIMITS.maxHeight, Math.max(MIN_RES_LIMITS.minHeight, Math.round(current.height))),
      };
      setWidth(String(start.width));
      setHeight(String(start.height));
      if (isMinResolution(start)) onChange(start);
      return;
    }
    const [w, h] = next.split("x").map(Number);
    setCustom(false);
    onChange({ width: w, height: h });
  }

  function type(nextWidth: string, nextHeight: string) {
    setWidth(nextWidth);
    setHeight(nextHeight);
    const next = { width: Number(nextWidth), height: Number(nextHeight) };
    if (isMinResolution(next)) onChange(next);
  }

  return (
    <div className="bd-field">
      <label htmlFor="workspace-dialog-min">
        Minimum resolution <span className="bd-ws-unit">logical pixels</span>
      </label>
      <select id="workspace-dialog-min" className="bd-input" value={selected} onChange={(e) => choose(e.target.value)}>
        <option value="any">Any size</option>
        {choices.length > 0 ? (
          <optgroup label="Your screens">
            {choices.map((c) => (
              <option key={sizeKey(c)} value={sizeKey(c)}>
                {`${describeMinResolution(c)} — ${c.names.join(", ")}${c.current ? " · this screen" : ""}`}
              </option>
            ))}
          </optgroup>
        ) : null}
        {common.length > 0 ? (
          <optgroup label="Common sizes">
            {common.map((c) => (
              <option key={sizeKey(c)} value={sizeKey(c)}>
                {describeMinResolution(c)}
              </option>
            ))}
          </optgroup>
        ) : null}
        <option value="custom">Custom…</option>
      </select>
      {selected === "custom" ? (
        <div className="bd-ws-custom">
          <input
            className="bd-input"
            type="number"
            inputMode="numeric"
            aria-label="Minimum width"
            min={MIN_RES_LIMITS.minWidth}
            max={MIN_RES_LIMITS.maxWidth}
            value={width}
            aria-invalid={!valid}
            onChange={(e) => type(e.target.value, height)}
          />
          <span aria-hidden="true">×</span>
          <input
            className="bd-input"
            type="number"
            inputMode="numeric"
            aria-label="Minimum height"
            min={MIN_RES_LIMITS.minHeight}
            max={MIN_RES_LIMITS.maxHeight}
            value={height}
            aria-invalid={!valid}
            onChange={(e) => type(width, e.target.value)}
          />
          {valid ? null : (
            <span className="bd-ws-note" role="alert">
              {`${MIN_RES_LIMITS.minWidth}–${MIN_RES_LIMITS.maxWidth} × ${MIN_RES_LIMITS.minHeight}–${MIN_RES_LIMITS.maxHeight}`}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The Workspaces dialog (spec docs/superpowers/specs/2026-10-12-resolution-default-workspace-design.md
 * §7): every workspace down the side, the one being edited on the right.
 * Creates a workspace in one step, or edits one (spec
 * docs/superpowers/specs/2026-09-30-workspace-dialog-design.md). Everything
 * the user changes goes into workspacesStore's draft, never straight to disk:
 * the real grid previews that draft when the workspace being edited is the
 * active one, and Cancel simply discards it.
 *
 * `workspaceId` null is a new workspace. App mounts this only while it is
 * open, and never changes `workspaceId` under a mounted dialog.
 */
export function WorkspaceDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string | null;
  onClose: () => void;
}) {
  // The workspace on the right. Starts as the one asked for and changes as
  // the sidebar's cards are chosen (spec 2026-10-12 §7).
  const [session, setSession] = useState<Session>({ id: workspaceId, n: 0 });
  const isNew = session.id === null;
  const draft = useWorkspacesStore((s) => s.draft);
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const removeWorkspace = useWorkspacesStore((s) => s.removeWorkspace);
  const screenSize = useScreenSize();
  const [screens, setScreens] = useState<ScreenInfo[]>([]);
  // The card a switch is waiting on while the dirty bar asks; undefined when none.
  const [pendingSwitch, setPendingSwitch] = useState<{ id: string | null } | undefined>(undefined);
  // The draft as it was begun, to tell an edited one from an untouched one.
  const baseline = useRef<string | null>(null);
  const beginDraft = useWorkspacesStore((s) => s.beginDraft);
  const stageDraft = useWorkspacesStore((s) => s.stageDraft);
  const discardDraft = useWorkspacesStore((s) => s.discardDraft);
  const commitDraft = useWorkspacesStore((s) => s.commitDraft);
  const setActiveWorkspace = useWorkspacesStore((s) => s.setActiveWorkspace);
  const startArranging = useWorkspacesStore((s) => s.startArranging);
  const layouts = useWorkspacesStore((s) => s.layouts);
  const renameLayout = useWorkspacesStore((s) => s.renameLayout);
  const deleteLayout = useWorkspacesStore((s) => s.deleteLayout);
  const dashboards = useDashboardStore((s) => s.dashboards);
  const addDashboard = useDashboardStore((s) => s.addDashboard);
  // The folder tree is READ only. Open/closed state is copied once into local
  // state below; toggleCollapsed is never called, because it writes to disk
  // and would change the rail behind the dialog.
  const folders = useFoldersStore((s) => s.folders);
  const folderOrder = useFoldersStore((s) => s.folderOrder);
  const placement = useFoldersStore((s) => s.placement);

  // Begun in an effect, never during render: WorkspaceGrid subscribes to the
  // draft, and setting another component's store mid-render is a React error.
  // Declared BEFORE useModalDialog so it runs first, though nothing depends on
  // that: the shell below is rendered from the first commit either way, so
  // showModal() always has its <dialog>. The cleanup is what keeps a draft
  // from ever outliving the dialog, whichever way it closes.
  useEffect(() => {
    const taken = useWorkspacesStore.getState().workspaces.map((w) => w.name);
    alive.current = true;
    beginDraft(session.id, session.id === null ? nextUntitledName(taken) : undefined);
    baseline.current = JSON.stringify(useWorkspacesStore.getState().draft);
    return () => {
      alive.current = false;
      // Not after Arrange… has handed the workspace to Arrange mode: by the
      // time this runs, startArranging has begun Arrange mode's own draft,
      // and discarding it would leave the mode on with nothing to arrange.
      if (useWorkspacesStore.getState().arrangingId === null) discardDraft();
    };
  }, [session, beginDraft, discardDraft]);

  // The machine's screens, once (spec 2026-10-12 §6). listScreens never rejects.
  useEffect(() => {
    let live = true;
    void listScreens().then((found) => {
      if (live) setScreens(found);
    });
    return () => {
      live = false;
    };
  }, []);

  function cancel() {
    // Create/Done's writes are already on their way and cannot be called back:
    // closing now would leave blank dashboards made for a workspace that is
    // never saved, or discard a draft that still lands on disk. So from
    // finish()'s first write until it settles, Cancel, Escape and ✕ do
    // nothing; finish() closes the dialog itself on success.
    if (busy.current) return;
    discardDraft();
    onClose();
  }
  // Escape and the header ✕ are both Cancel.
  const dialogRef = useModalDialog(cancel);

  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Folder ids shown closed. Starts as the rail's `collapsed` and is the
  // dialog's own from then on (spec §1 "Right").
  const [closed, setClosed] = useState<ReadonlySet<string>>(
    () => new Set(useFoldersStore.getState().collapsed),
  );
  const [pending, setPending] = useState(false);
  // A saved layout's right-click menu, and the one being renamed in place.
  const [layoutMenu, setLayoutMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [renamingLayout, setRenamingLayout] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A ref, not `pending`, so the guard holds for two calls that see the same
  // render, and because Enter in the name field is not gated by the Create
  // button's disabled state (finish() never reads `pending`).
  const busy = useRef(false);
  // False once the dialog is gone. Cancel and Escape wait for a Create, but
  // the dialog can still be unmounted mid-flight (its window closing) and
  // then reopened at once: a stale
  // finish() must not make more dashboards, stage into the new dialog's draft
  // or commit it. Set true by the effect that begins the draft, so StrictMode's
  // double-invoked effects leave it true on a mounted dialog.
  const alive = useRef(true);
  const nameRef = useRef<HTMLInputElement>(null);

  // Once, when the draft first exists: the on-open selection, and the name
  // focused and selected so typing replaces it. Read through getState() so
  // this runs on that one transition and not on every edit.
  const ready = draft !== null;
  useEffect(() => {
    if (!ready) return;
    const current = useWorkspacesStore.getState().draft;
    if (current !== null) {
      const known = new Map(useDashboardStore.getState().dashboards.map((d) => [d.id, d.name] as const));
      setSelectedSlot(firstEmpty(readingOrder(arrangementOf(current)).map((t) => t.slot), current.slots, known));
    }
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [ready, session]);

  const names = useMemo<Names>(() => new Map(dashboards.map((d) => [d.id, d.name] as const)), [dashboards]);
  const tree = useMemo(
    () => buildTree(folders, folderOrder, placement, dashboards),
    [folders, folderOrder, placement, dashboards],
  );
  const query = search.trim().toLowerCase();
  const searching = query !== "";
  const visible = useMemo(() => (query === "" ? tree : filterTree(tree, query)), [tree, query]);

  // Non-null stand-ins so the handlers below need no guard of their own;
  // nothing is rendered from them while the draft is still null.
  const slots: DraftSlot[] = draft?.slots ?? [];
  // The draft's own array or the preset table's, so a stable reference.
  const arrangement = draft === null ? PRESETS["full-screen"].tiles : arrangementOf(draft);
  // Slot ids in reading order, and each one's letter (spec 2026-10-01 §1).
  const order = useMemo(() => readingOrder(arrangement).map((t) => t.slot), [arrangement]);
  const letters = useMemo(() => new Map(order.map((slot, n) => [slot, tileLetter(n)] as const)), [order]);
  /** What re-seating counts as a dashboard to carry: a real one that exists, or a "New dashboard" placeholder. */
  const counts = (s: DraftSlot) => "newDashboard" in s || names.has(s.dashboardId);
  const hiddenCount = hiddenEntries(arrangement, slots, (s) => "dashboardId" in s && names.has(s.dashboardId)).length;

  /**
   * Gives the draft a new arrangement and re-seats its tiles' contents into
   * it in reading order (spec 2026-10-01 §4) -- placeholders included, as
   * the user put them there. The selection stays when its slot is still a
   * tile; otherwise it is chosen again by the on-open rule.
   */
  function stageArrangement(tiles: readonly TilePlacement[], patch: { preset?: PresetId; layout: TilePlacement[] | null }) {
    const seated = reseat(arrangement, slots, tiles, counts);
    stageDraft({ ...patch, slots: seated });
    const nextOrder = readingOrder(tiles).map((t) => t.slot);
    setSelectedSlot(
      selectedSlot !== null && nextOrder.includes(selectedSlot) ? selectedSlot : firstEmpty(nextOrder, seated, names),
    );
  }

  /** A preset is applied as `preset` with the layout removed. */
  function chooseLayout(next: PresetId) {
    stageArrangement(PRESETS[next].tiles, { preset: next, layout: null });
  }

  /**
   * A saved layout is applied as a COPY of its tiles in `layout`, slot ids
   * a, b, … in reading order, with `preset` left as it was (spec 2026-10-01
   * §4). Nothing stays linked, so Custom is what is selected afterwards.
   */
  function chooseSavedLayout(layout: SavedLayout) {
    const tiles = placeTiles(layout.tiles);
    stageArrangement(tiles, { layout: tiles });
  }

  /** Rename in place (spec §6): a taken or blank name is refused by the store, and the name stays as it was. */
  async function renameSavedLayout(id: string, next: string) {
    setRenamingLayout(null);
    try {
      await renameLayout(id, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Delete asks first, and changes no workspace: a layout that was applied was copied. */
  async function deleteSavedLayout(id: string) {
    setLayoutMenu(null);
    const layout = useWorkspacesStore.getState().layouts.find((l) => l.id === id);
    if (layout === undefined) return;
    const ok = await confirm(`Delete the layout "${layout.name}"? No workspace is changed.`, {
      title: "Delete layout",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    try {
      await deleteLayout(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function clearTile(slot: string) {
    stageDraft({ slots: slots.filter((s) => s.slot !== slot) });
  }

  /**
   * Puts `entry` -- a dashboard, or a "New dashboard" placeholder -- in
   * `slot` under the move rule (assignDraftSlot). A click then moves the
   * selection to the next empty tile in reading order, wrapping round, and
   * leaves it where it is when no tile is empty; a drop does not move it.
   */
  function assign(slot: string, entry: { dashboardId: string } | { newDashboard: true }, advance: boolean) {
    const next = assignDraftSlot(slots, slot, entry);
    stageDraft({ slots: next });
    if (!advance) return;
    const at = order.indexOf(slot);
    const after = [...order.slice(at + 1), ...order.slice(0, at)];
    setSelectedSlot(after.find((s) => tileLabel(next, s, names) === null) ?? slot);
  }

  function toggleFolder(id: string) {
    // While searching every folder with a match is forced open, so a click
    // there would change state nobody can see until the search is cleared.
    if (searching) return;
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** The letter of the tile a dashboard sits in -- only tiles the arrangement shows. */
  function letterOf(dashboardId: string): string | null {
    const held = slots.find((s) => "dashboardId" in s && s.dashboardId === dashboardId && letters.has(s.slot));
    return held === undefined ? null : (letters.get(held.slot) ?? null);
  }

  /**
   * The dialog's own read-only rows. Not the rail's folderRow/dashboardRow:
   * those carry rename, context menus and drop-to-move, none of which has a
   * place here. A folder row only opens and closes.
   */
  function folderRows(node: FolderNode, depth: number): ReactNode {
    const id = node.folder.id;
    const open = searching || !closed.has(id);
    return (
      <Fragment key={id}>
        <button
          type="button"
          className="bd-ws-row bd-ws-row--folder"
          style={indent(depth)}
          aria-label={node.folder.name}
          aria-expanded={open}
          onClick={() => toggleFolder(id)}
        >
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span className="bd-ws-row-name">{node.folder.name}</span>
        </button>
        {open ? (
          <>
            {node.children.map((child) => folderRows(child, depth + 1))}
            {node.dashboards.map((d) => dashboardRow(d, depth + 1))}
          </>
        ) : null}
      </Fragment>
    );
  }

  function dashboardRow(d: Dashboard, depth: number): ReactNode {
    const letter = letterOf(d.id);
    return (
      <button
        key={d.id}
        type="button"
        className="bd-ws-row"
        style={indent(depth)}
        aria-label={letter === null ? d.name : `${d.name} (tile ${letter})`}
        // HTML drag-and-drop, so mouse only; on touch the click is the route.
        // The rail's own payload type: it already means "this dashboard",
        // and nothing behind the modal can receive a drop while it is open.
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DASHBOARD_REORDER_DRAG_TYPE, d.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={() => {
          if (selectedSlot !== null) assign(selectedSlot, { dashboardId: d.id }, true);
        }}
      >
        <span className="bd-ws-row-name">{d.name}</span>
        {letter === null ? null : (
          <span className="bd-ws-row-letter" aria-hidden="true">
            {letter}
          </span>
        )}
      </button>
    );
  }

  /**
   * Writes the draft. "open" closes and switches to it (the old Create and
   * Done); "arrange" closes into Arrange mode; "save" stays, and goes on to
   * `next` when the dirty bar asked, else re-begins the saved workspace.
   */
  async function finish(mode: "open" | "save" | "arrange" = "open", next?: { id: string | null }) {
    if (busy.current || draft === null || draft.name.trim() === "") return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      // Spec §4 step 1. The store cannot create dashboards (it never imports
      // dashboardStore), so the dialog does, one per placeholder, at the top
      // level as the rail's own New dashboard does. Each real id is STAGED as
      // soon as it exists: if the write below then fails, a retry finds no
      // placeholder left and creates nothing twice. Read through getState()
      // each time, so every name and every stage sees the one before it.
      //
      // First, a placeholder in a tile the chosen layout does not show is
      // DROPPED from the draft (the user ruled that no dashboard is made for
      // one nobody can see). Dropping it from the draft, not just skipping it
      // here, is what lets the store's commitDraft accept the draft, and what
      // keeps a retry from creating it later. Real dashboards in hidden slots
      // stay, as chooseLayout keeps every dashboard it does not show.
      const open = useWorkspacesStore.getState().draft;
      const shown: readonly string[] = open === null ? [] : arrangementOf(open).map((t) => t.slot);
      stageDraft({ slots: (open?.slots ?? []).filter((s) => "dashboardId" in s || shown.includes(s.slot)) });
      const placeholders = (useWorkspacesStore.getState().draft?.slots ?? []).filter(
        (s) => "newDashboard" in s,
      );
      for (const { slot } of placeholders) {
        const id = await addDashboard(nextUntitledName(useDashboardStore.getState().dashboards.map((d) => d.name)));
        // Unmounted while that was in flight: stop, silently.
        if (!alive.current) return;
        // null only in a viewer window, which mounts no rail and so never this dialog.
        if (id === null) throw new Error("this window cannot create dashboards");
        const current = useWorkspacesStore.getState().draft?.slots ?? [];
        stageDraft({ slots: current.map((s) => (s.slot === slot ? { slot, dashboardId: id } : s)) });
      }
      // Step 2: one write, through the store's queue.
      const result = await commitDraft();
      if (!alive.current) return;
      if (!result.ok) {
        // The draft is kept by the store, so the edits stay on screen and
        // Create/Done is usable again for a retry. Dashboards created above
        // stay on disk if the user now cancels -- a known ceiling, accepted
        // in place of rollback (spec §4 "Failure").
        setError(result.error);
        return;
      }
      if (mode === "save") {
        // Stays open: on the card the dirty bar was asked for, else on the
        // workspace just saved -- a new one now has an id.
        goTo(next === undefined ? result.id : next.id);
        return;
      }
      onClose();
      // Closed first, then switched to (spec 2026-10-12 §7: Open is the old
      // Create, and now an edit is opened too). Arrange… (spec 2026-10-01 §3)
      // saved exactly as Open would; it goes on into Arrange mode on that
      // workspace, which also makes it the active one.
      if (mode === "arrange") startArranging(result.id);
      else setActiveWorkspace(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const dirty = draft !== null && baseline.current !== null && JSON.stringify(draft) !== baseline.current;

  /** Opens workspace `id` (null = a new one) as a fresh session, dropping any pending switch. */
  function goTo(id: string | null) {
    setPendingSwitch(undefined);
    setSession((current) => ({ id, n: current.n + 1 }));
  }

  /** A card was chosen: straight there, or through the dirty bar when there are edits. */
  function requestSwitch(id: string | null) {
    if (busy.current || (id !== null && id === session.id)) return;
    if (id === null && isNew) return;
    if (dirty) {
      setPendingSwitch({ id });
      return;
    }
    goTo(id);
  }

  function discardAndSwitch() {
    if (pendingSwitch) goTo(pendingSwitch.id);
  }

  /** Delete asks first; the workspace's dashboards are never deleted with it. */
  async function deleteCurrent() {
    const id = session.id;
    if (busy.current || id === null) return;
    const name = workspaces.find((w) => w.id === id)?.name ?? draft?.name ?? "";
    const ok = await confirm(`Delete the workspace "${name}"? Its dashboards are not deleted.`, {
      title: "Delete workspace",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!ok || !alive.current) return;
    busy.current = true;
    setPending(true);
    try {
      await removeWorkspace(id);
      if (!alive.current) return;
      const rest = useWorkspacesStore.getState().workspaces;
      goTo(rest[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  // The cards: every saved workspace in rail order with the draft laid over
  // its own, and the new one last while it is being made.
  const cards: Workspace[] = workspaces.map((w) => (w.id === session.id ? (effectiveWorkspace(w, draft) ?? w) : w));
  const newCard: Workspace | null =
    isNew && draft !== null
      ? overlayDraft({ id: NEW_ID, name: "", preset: draft.preset, slots: [] }, draft, [])
      : null;
  const launchId = pickLaunchWorkspace(newCard === null ? cards : [...cards, newCard], screenSize)?.id;
  const currentMin = draft?.minResolution ?? undefined;
  const zoomNow = zoomFor(screenSize, currentMin);
  const screenText = `This screen ${Math.round(screenSize.width)}×${Math.round(screenSize.height)}`;

  function card(w: Workspace, selected: boolean, id: string | null) {
    const min = w.minResolution;
    const fit = fitLabel(screenSize, min);
    const launch = launchId === w.id;
    return (
      <button
        key={id ?? "new"}
        type="button"
        className="bd-ws-card"
        aria-current={selected ? "true" : undefined}
        aria-label={`${w.name}, ${min === undefined ? "Any size" : `at least ${describeMinResolution(min)}`}, ${fit}${launch ? ", opens at launch" : ""}${selected && dirty ? ", unsaved" : ""}`}
        onClick={() => requestSwitch(id)}
      >
        <ThumbGrid className="bd-ws-card-thumb" style={cardThumbStyle(min)} tiles={arrangementOf(w)} />
        <span className="bd-ws-card-text" aria-hidden="true">
          <span className="bd-ws-card-name">
            <span className="bd-ws-card-label">{w.name}</span>
            {selected && dirty ? <span className="bd-ws-dot" /> : null}
          </span>
          <span className="bd-ws-card-min">{min === undefined ? "Any size" : `≥ ${describeMinResolution(min)}`}</span>
          <span className="bd-ws-chips">
            <span className={fit === "Fits" ? "bd-ws-chip" : "bd-ws-chip bd-ws-chip--zoom"}>{fit}</span>
            {launch ? <span className="bd-ws-chip bd-ws-chip--launch">Launch</span> : null}
          </span>
        </span>
      </button>
    );
  }

  const blank = draft === null || draft.name.trim() === "";

  return (
    <DialogShell
      dialogRef={dialogRef}
      ariaLabel="Workspaces"
      eyebrow="Workspaces"
      title={draft === null || blank ? (isNew ? "New workspace" : "Workspace") : draft.name}
      subtitle="Pick a workspace to open or edit. Any workspace opens on any screen; larger ones zoom to fit."
      bodyId={BODY_ID}
      modifier="bd-dialog--workspace"
      note={error === null ? "Open switches to this workspace. Nothing is saved until you Save or Open." : `Could not save: ${error}`}
      footerActions={
        <>
          {isNew ? null : (
            <button type="button" className="bd-button bd-button--danger" disabled={pending} onClick={() => void deleteCurrent()}>
              Delete
            </button>
          )}
          <button type="button" className="bd-button" onClick={cancel}>
            Cancel
          </button>
          {/* Offered at every width: this line has no 600px rule and no dock
              editor to gate it on, as Arrange… on a workspace row's menu is
              not gated either (the v5.6.1 plan's ruling R3). */}
          <button type="button" className="bd-button" disabled={pending || blank} onClick={() => void finish("arrange")}>
            Arrange…
          </button>
          <button
            type="button"
            className="bd-button"
            disabled={pending || blank || !(dirty || isNew)}
            onClick={() => void finish("save")}
          >
            Save
          </button>
          <button
            type="button"
            className="bd-button bd-button--primary"
            disabled={pending || blank}
            onClick={() => void finish("open")}
          >
            Open
          </button>
        </>
      }
      onClose={cancel}
    >
      {draft === null ? null : (
        <div className="bd-ws-strip" role="status">
          <span className={zoomNow === 1 ? "bd-ws-chip" : "bd-ws-chip bd-ws-chip--zoom"} data-testid="workspace-dialog-fit">
            {zoomNow === 1 ? "Fits · 100%" : `Zoom ${Math.round(zoomNow * 100)}%`}
          </span>
          <span className="bd-ws-chip bd-ws-chip--plain">{screenText}</span>
          <span className="bd-ws-strip-text">{fitSentence(screenSize, currentMin)}</span>
        </div>
      )}
      <div className="bd-ws-shell">
        <nav className="bd-ws-rail" aria-label="Workspaces">
          <div className="bd-ws-rail-head">
            <span>Workspaces</span>
            <span>{workspaces.length}</span>
          </div>
          {cards.map((w) => card(w, w.id === session.id, w.id))}
          {newCard === null ? null : card(newCard, true, null)}
          <button type="button" className="bd-ws-card-new" onClick={() => requestSwitch(null)}>
            + New workspace
          </button>
          <p className="bd-ws-note">
            Each card is drawn at its minimum resolution&apos;s shape. Launch marks the one this screen opens at startup.
          </p>
        </nav>
        <div className="bd-ws-editor">
      {pendingSwitch === undefined || draft === null ? null : (
        <div className="bd-ws-dirty" role="alert">
          <span>{`Save changes to "${draft.name.trim() || "this workspace"}" before switching?`}</span>
          <span className="bd-ws-dirty-actions">
            <button type="button" className="bd-button" disabled={pending} onClick={discardAndSwitch}>
              Discard
            </button>
            <button
              type="button"
              className="bd-button bd-button--primary"
              disabled={pending || blank}
              onClick={() => void finish("save", pendingSwitch)}
            >
              Save
            </button>
          </span>
        </div>
      )}
      {draft === null ? null : (
        <div className="bd-ws-columns">
          <div className="bd-ws-side">
            <div className="bd-field">
              <label htmlFor="workspace-dialog-name">Name</label>
              <input
                id="workspace-dialog-name"
                ref={nameRef}
                className="bd-input"
                value={draft.name}
                onChange={(e) => stageDraft({ name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  void finish();
                }}
              />
            </div>
            <MinResolutionField
              key={`${session.id ?? "new"}-${session.n}`}
              value={draft.minResolution}
              screens={screens}
              current={screenSize}
              onChange={(next) => stageDraft({ minResolution: next })}
            />
            <label className="bd-ws-check">
              <input
                type="checkbox"
                checked={draft.openAtLaunch}
                onChange={(e) => stageDraft({ openAtLaunch: e.target.checked })}
              />
              Open at launch when this is the best fit for the screen
            </label>
            <div className="bd-ws-thumbs" role="group" aria-label="Layout">
              {/* Presets, then saved layouts by name, then Custom. A preset
                  is selected only while the draft has no layout of its own;
                  a saved layout never is, since applying it copies; Custom,
                  last, is the draft's own arrangement and is there only
                  while it has one (spec 2026-10-01 §4). */}
              {(Object.keys(PRESETS) as PresetId[]).map((id) => (
                <LayoutThumb
                  key={id}
                  name={PRESETS[id].name}
                  tiles={PRESETS[id].tiles}
                  selected={draft.layout === null && draft.preset === id}
                  onSelect={() => chooseLayout(id)}
                />
              ))}
              {layouts.map((l) =>
                renamingLayout === l.id ? (
                  // Not inside the thumbnail's button: an input inside a
                  // button is invalid and the button would steal its clicks.
                  <div key={l.id} className="bd-ws-thumb">
                    <ThumbGrid tiles={l.tiles} />
                    <InlineRename
                      value={l.name}
                      ariaLabel="Rename layout"
                      onCommit={(next) => void renameSavedLayout(l.id, next)}
                      onCancel={() => setRenamingLayout(null)}
                    />
                  </div>
                ) : (
                  <LayoutThumb
                    key={l.id}
                    name={l.name}
                    tiles={l.tiles}
                    // Never selected: nothing stays linked to a saved layout.
                    selected={false}
                    onSelect={() => chooseSavedLayout(l)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setLayoutMenu({ x: e.clientX, y: e.clientY, id: l.id });
                    }}
                  />
                ),
              )}
              {draft.layout === null ? null : (
                <LayoutThumb name="Custom" tiles={draft.layout} selected onSelect={() => {}} />
              )}
            </div>
            {/* Decides whether the GRID's tiles draw their title line. The
                preview below always names its tiles whatever this says: it is
                how the tiles are told apart while assigning. */}
            <label className="bd-ws-check">
              <input
                type="checkbox"
                checked={draft.showTileNames}
                onChange={(e) => stageDraft({ showTileNames: e.target.checked })}
              />
              Show dashboard names
            </label>
            <div className="bd-ws-preview" role="group" aria-label="Tiles" style={GRID_STYLE}>
              {readingOrder(arrangement).map((t) => {
                const slot = t.slot;
                const letter = letters.get(slot) ?? "";
                const label = tileLabel(draft.slots, slot, names);
                return (
                  // A wrapper, not one button: the ✕ is a second control, and
                  // a button inside a button is invalid and steals its clicks.
                  <div
                    key={slot}
                    className="bd-ws-tile"
                    data-testid={`workspace-dialog-tile-${slot}`}
                    style={tileArea(t)}
                    // Without preventDefault the browser never fires drop;
                    // gating it on the type refuses a file or text drag.
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes(DASHBOARD_REORDER_DRAG_TYPE)) e.preventDefault();
                    }}
                    // Any tile, selected or not, under the same move rule. The
                    // selection is left alone: a drag names its own target.
                    onDrop={(e) => {
                      const dropped = e.dataTransfer.getData(DASHBOARD_REORDER_DRAG_TYPE);
                      if (!dropped) return;
                      e.preventDefault();
                      assign(slot, { dashboardId: dropped }, false);
                    }}
                  >
                    <button
                      type="button"
                      className="bd-ws-tile-select"
                      aria-pressed={selectedSlot === slot}
                      aria-label={`Tile ${letter}: ${label ?? "Empty"}`}
                      onClick={() => setSelectedSlot(slot)}
                    >
                      <span className="bd-ws-tile-letter" aria-hidden="true">
                        {letter}
                      </span>
                      <span className="bd-ws-tile-name">{label ?? "Empty"}</span>
                    </button>
                    {label === null ? null : (
                      <button
                        type="button"
                        className="bd-ws-tile-clear"
                        aria-label={`Clear tile ${letter}`}
                        onClick={() => clearTile(slot)}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {hiddenCount > 0 ? <p className="bd-ws-note">{hiddenNote(hiddenCount)}</p> : null}
          </div>
          <div className="bd-ws-side">
            <input
              type="search"
              className="bd-input"
              aria-label="Search dashboards"
              placeholder="Search dashboards"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {/* Pinned above the tree, so a search that matches nothing still
                leaves it. The dashboard is created on Create/Done, not here. */}
            <button
              type="button"
              className="bd-ws-row bd-ws-row--new"
              aria-label="New dashboard"
              onClick={() => {
                if (selectedSlot !== null) assign(selectedSlot, { newDashboard: true }, true);
              }}
            >
              <span aria-hidden="true">＋</span>
              <span className="bd-ws-row-name">New dashboard</span>
            </button>
            {/* Order and nesting are the rail's: buildTree, folders first and
                depth-first, then the dashboards in no folder. */}
            <div className="bd-ws-tree" role="group" aria-label="Dashboards">
              {visible.folders.map((node) => folderRows(node, 0))}
              {visible.dashboards.map((d) => dashboardRow(d, 0))}
            </div>
          </div>
        </div>
      )}
        </div>
      </div>
      {/* In-tree, never portalled: a portal lands in <body>, which this
          modal makes inert (RowContextMenu's own `portal` comment). */}
      {layoutMenu === null ? null : (
        <RowContextMenu
          x={layoutMenu.x}
          y={layoutMenu.y}
          items={[
            {
              label: "Rename",
              onSelect: () => {
                setRenamingLayout(layoutMenu.id);
                setLayoutMenu(null);
              },
            },
            { label: "Delete", onSelect: () => void deleteSavedLayout(layoutMenu.id) },
          ]}
          onClose={() => setLayoutMenu(null)}
        />
      )}
    </DialogShell>
  );
}
