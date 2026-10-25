// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * One item. Everything past `label`/`onSelect` exists because one of the
 * app's four menus needs it: the table header's pin items disable the side
 * the column already has, the rail's grouping row is a checkbox, its Move to
 * row owns a flyout, its Exchange flyout is searchable, and the help menu's Canny row carries a tooltip.
 */
export type MenuItem = {
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** Native tooltip. */
  title?: string;
  /** Draws a separator immediately above this item. */
  separatorBefore?: boolean;
  /** Present ⇒ `role="menuitemcheckbox"`, with a ☑/☐ glyph before the label. */
  checked?: boolean;
  /** Present ⇒ the item toggles a flyout of its own instead of selecting. */
  submenu?: MenuItem[];
  /** Indent inside a flyout, one step per level. */
  depth?: number;
  /**
   * Present on an item with a `submenu` ⇒ its flyout opens with a search box of this name that filters the flyout's
   * items by label, case-insensitively (the dashboard's Exchange menu: 71 calendars, 2026-10-24).
   */
  search?: string;
};

/** Ties a submenu trigger to the flyout it owns. A constant, not a generated
 * id: only one context menu is ever mounted at a time. */
const SUBMENU_ID = "row-context-submenu";

/** The items the keyboard may land on. `:not(:disabled)` is the whole point:
 * a disabled item takes no focus in a browser, so both mount focus and the
 * arrow keys would otherwise stall on it — the pin menu disables the side the
 * column already has, and that item can be first in the list. */
const FOCUSABLE_ITEMS = "[role^='menuitem']:not(:disabled)";

/** The keys that open a context menu from the keyboard: Enter, Space, the Menu key and Shift+F10. */
export function isMenuKey(e: { key: string; shiftKey: boolean }): boolean {
  return e.key === "Enter" || e.key === " " || e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey);
}

/**
 * The panel every popup menu in the app floats in: arrow keys move, Escape
 * closes, an outside press dismisses, and it clamps itself into the
 * viewport. RowContextMenu fills it from a list of items; the card's ⋯ menu
 * fills it with its own sections, which open in place and can stay open
 * across a choice — something an item list does not describe. Keyboard
 * reachability lives with the caller: the caller's trigger must itself be
 * focusable (Tab reaches it) and must open this menu on Enter, Space, the
 * Context-Menu key, or Shift+F10 — this component doesn't know or care how it
 * was opened, only that `x`/`y` name where.
 *
 * On the dismiss paths (Escape, an outside press) focus moves to
 * `returnFocusTo` before `onClose` runs, so a keyboard user who opened the
 * menu lands back where they started instead of losing their place to
 * <body>.
 */
export function MenuPanel({
  x,
  y,
  onClose,
  returnFocusTo,
  anchor,
  openUp,
  openLeft,
  portal,
  className,
  layoutKey,
  children,
  "aria-label": ariaLabel,
}: {
  x: number;
  y: number;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
  /** A trigger that toggles this menu: a press on it must not dismiss here,
   * or the trigger's own click would immediately reopen what it closed. */
  anchor?: HTMLElement | null;
  /** `y` names the menu's BOTTOM edge, for a menu opened from a row pinned to
   * the bottom of the window. */
  openUp?: boolean;
  /** `x` names the menu's RIGHT edge, for a menu that hangs leftward from a
   * trigger at the right end of a card header. */
  openLeft?: boolean;
  /** Render into <body>. Needed inside a scroll container: `overflow: auto`
   * clips an in-tree menu, and a local stacking context traps it under a
   * neighbouring card. Never from inside a `showModal()` dialog: the portal
   * lands in <body>, which the dialog makes inert, so the menu would render
   * unclickable. */
  portal?: boolean;
  className: string;
  /** Changes whenever the menu's content changes size (a section opening),
   * so the clamp below runs again against the new height. */
  layoutKey?: unknown;
  children: ReactNode;
  /** The menu's accessible name, for a menu whose trigger does not already
   * say what it lists (the group menu's "Groups"). */
  "aria-label"?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    // Focus the first item so the keyboard works without a further click.
    ref.current?.querySelector<HTMLButtonElement>(FOCUSABLE_ITEMS)?.focus();
  }, []);

  // Clamp into the viewport once the menu's real size is known: a
  // right-click near the window's right or bottom edge must not leave part
  // of the menu somewhere it can't be clicked.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - rect.width);
    const maxTop = Math.max(0, window.innerHeight - rect.height);
    const top = openUp ? y - rect.height : y;
    const left = openLeft ? x - rect.width : x;
    setPos({ left: Math.min(Math.max(left, 0), maxLeft), top: Math.min(Math.max(top, 0), maxTop) });
  }, [x, y, openUp, openLeft, layoutKey]);

  function close() {
    returnFocusTo?.focus();
    onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Capture-phase + stopImmediatePropagation, not just close(): a menu
        // can be open over something with its own bubble-phase window Escape
        // listener registered first — the SettingsDialog that dismisses
        // itself, a maximized card that restores itself. Without this, one
        // Escape press closes the menu AND that thing underneath it.
        // Registering on the capture phase means this handler runs before the
        // bubble-phase listener ever sees the event; stopImmediatePropagation
        // stops it from being dispatched to that listener at all, so the menu
        // takes precedence and the dialog stays open.
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      }
    };
    // mousedown, not click: the menu must be gone before the press lands on
    // whatever is underneath it. The right-click that OPENS a menu is safe
    // from this — the browser fires its mousedown before the contextmenu
    // event that mounts this component.
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      const control = (target as Element | null)?.closest<HTMLElement>(
        "a[href], button, input, select, textarea, [tabindex]",
      );
      const focusable = !!control && control.tabIndex >= 0;
      // A draggable element — the table's header cells, which are focusable
      // too — owns a native drag, and preventDefault on the mousedown cancels
      // it before dragstart is ever dispatched. Reordering a column outranks
      // putting focus back on the trigger. Either test alone sends a header
      // down the same branch; both are kept because a draggable target need
      // not be focusable, and a focusable one need not be draggable.
      const draggable = !!(target as Element | null)?.closest?.("[draggable='true']");
      if (focusable || draggable) {
        // The user is deliberately redirecting attention to a real
        // control (or something inside one, like an icon or label), or
        // starting a drag. Let the browser's default mousedown behaviour
        // stand — don't preventDefault, and don't steal focus back to the
        // trigger.
        onClose();
      } else {
        // Nothing focusable here (a blank area, a table cell, plain
        // text): the default action would blur to <body> and lose the
        // user's place for nothing, so suppress it and restore focus to
        // the trigger ourselves.
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose, returnFocusTo, anchor]);

  function move(delta: number) {
    const nodes = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>(FOCUSABLE_ITEMS) ?? [],
    );
    if (nodes.length === 0) return;
    const at = nodes.findIndex((n) => n === document.activeElement);
    // Wraps: a menu this short is quicker to cycle than to bound.
    nodes[(at + delta + nodes.length) % nodes.length].focus();
  }

  const menu = (
    <div
      ref={ref}
      className={className}
      role="menu"
      aria-label={ariaLabel}
      // Focus lives on the items (see the mount effect); -1 only makes the
      // container a valid focus target, never a Tab stop.
      tabIndex={-1}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {children}
    </div>
  );

  return portal ? createPortal(menu, document.body) : menu;
}

/**
 * The app's one context menu: a MenuPanel holding a list of items. Choosing
 * an item closes it the way the panel's dismiss paths do, focus first.
 */
export function RowContextMenu({
  items,
  onClose,
  returnFocusTo,
  ...panel
}: Omit<Parameters<typeof MenuPanel>[0], "className" | "layoutKey" | "children"> & {
  items: MenuItem[];
}) {
  /** The open flyout's trigger label. Local: it dies with the menu. */
  const [openSub, setOpenSub] = useState<string | null>(null);
  /** The open flyout's search text, when it has a search box. Cleared whenever a flyout opens or closes. */
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // A searchable flyout takes the keyboard as it opens, so typing filters at once.
  useEffect(() => {
    searchRef.current?.focus();
  }, [openSub]);

  function close() {
    returnFocusTo?.focus();
    onClose();
  }

  /**
   * The flyout under an open submenu trigger. A searchable one puts its search box and status in a plain wrapper
   * before the `role="menu"` list, since a menu may hold only items, groups and separators.
   */
  function renderFlyout(item: MenuItem, sub: MenuItem[]) {
    if (!item.search) {
      return (
        <div id={SUBMENU_ID} role="menu" className="rail-submenu">
          {sub.map(renderItem)}
        </div>
      );
    }
    const shown = sub.filter((s) => s.label.toLowerCase().includes(query.trim().toLowerCase()));
    return (
      <div className="rail-submenu rail-submenu-search">
        <input
          ref={searchRef}
          type="search"
          aria-label={item.search}
          placeholder={item.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            // Into the matches -- the first, or the last going up -- not wherever the panel's own arrows would go.
            e.preventDefault();
            e.stopPropagation();
            const matches = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(FOCUSABLE_ITEMS);
            matches?.[e.key === "ArrowDown" ? 0 : matches.length - 1]?.focus();
          }}
        />
        <span className="sr-only" role="status">
          {shown.length === 0 ? "No exchanges match" : `${shown.length} ${shown.length === 1 ? "exchange" : "exchanges"}`}
        </span>
        <div id={SUBMENU_ID} role="menu">
          {shown.map(renderItem)}
        </div>
      </div>
    );
  }

  function renderItem(item: MenuItem) {
    const sub = item.submenu;
    const subOpen = sub !== undefined && openSub === item.label;
    return (
      <Fragment key={item.label}>
        {item.separatorBefore ? <div role="separator" /> : null}
        <button
          type="button"
          role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
          aria-checked={item.checked}
          aria-haspopup={sub ? "menu" : undefined}
          aria-expanded={sub ? subOpen : undefined}
          // Only while open: aria-controls must name an element that exists,
          // and the flyout is unmounted the rest of the time.
          aria-controls={subOpen ? SUBMENU_ID : undefined}
          disabled={item.disabled}
          title={item.title}
          // Indentation is the only thing that shows nesting in a flyout;
          // the accessible name stays the item's own name.
          style={item.depth === undefined ? undefined : { paddingLeft: 10 + item.depth * 12 }}
          onClick={() => {
            if (sub) {
              setOpenSub((cur) => (cur === item.label ? null : item.label));
              setQuery("");
              return;
            }
            item.onSelect?.();
            close();
          }}
        >
          {item.checked === undefined ? null : (
            <span aria-hidden="true">{item.checked ? "☑" : "☐"} </span>
          )}
          {item.label}
          {sub ? <span aria-hidden="true"> ▸</span> : null}
        </button>
        {subOpen ? renderFlyout(item, sub) : null}
      </Fragment>
    );
  }

  return (
    <MenuPanel
      {...panel}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      className="row-context-menu"
      layoutKey={openSub}
    >
      {items.map(renderItem)}
    </MenuPanel>
  );
}
