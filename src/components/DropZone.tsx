// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState, type ReactNode, type Ref } from "react";
import { isAppsJson } from "../lib/appsJson";
import { BUILTIN_BACKEND_ID, LOCAL_TABLE_ID } from "../lib/builtins";
import { IMPORT_MAX_BYTES } from "../lib/importLimits";
import { deleteLocalFile, extensionOf, localFileRefusal, saveLocalFile } from "../lib/localFiles";
import { logError } from "../lib/logger";
import { isSettingsBundle, planSettingsImport } from "../lib/settingsBundle";
import type { WidgetDef } from "../lib/types";
import { useDashboardStore } from "../stores/dashboardStore";
import { useFoldersStore } from "../stores/foldersStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { runAppsImport } from "./runAppsImport";

/** What a local table can be built from. Lower-cased extensions, no dot. */
const TABLE_EXTENSIONS = new Set(["csv", "tsv", "json", "xlsx", "xls"]);

function carriesFiles(types: readonly string[] | undefined): boolean {
  return (types ?? []).includes("Files");
}

/**
 * A dragged link navigates the webview exactly as a dropped file does, so the
 * window-level guard has to swallow it too -- but only on drop. Adding it to
 * dragover would make the whole window a link drop target, which it is not.
 */
function carriesLink(types: readonly string[] | undefined): boolean {
  return Array.from(types ?? []).includes("text/uri-list");
}

/**
 * A dialog or the widget library is open over the zone. Their overlays cover
 * the dashboard, so a drop that lands here landed behind one -- processing it
 * would add a card the user cannot see, from a gesture aimed at the overlay.
 *
 * `dialog[open]` rather than a class: the two modals are real <dialog>s, and
 * an open one is exactly the state that covers the dashboard.
 */
function coveredByOverlay(): boolean {
  return document.querySelector("dialog[open], .library-overlay") !== null;
}

/**
 * The dashboard area, and the app's only file drop target. Dropping a data
 * file adds a table card reading it; dropping an apps.json runs the same
 * import the rail's menu does.
 *
 * It renders the `<main>` itself rather than wrapping one: the veil has to
 * cover the area, and the area is the element whose drag events matter.
 */
export function DropZone({
  children,
  mainRef,
  viewer = false,
}: {
  children: ReactNode;
  /** App measures this element for --dashboard-top. */
  mainRef?: Ref<HTMLElement>;
  /** The "Open in new window" window: no veil, and every drop is ignored. */
  viewer?: boolean;
}) {
  const [over, setOver] = useState(false);
  /**
   * The one line a drop leaves behind, in the same voice as the rail's.
   * Transient: replaced by the next drop, and never persisted.
   */
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * A file or a link dropped anywhere this app does NOT handle -- the rail,
   * the tab bar, a dialog, the viewer window -- navigates the webview to it,
   * and there is no way back to the dashboard from there short of a restart.
   * Registered on window so it covers every such place at once, and gated on
   * the drag's types so a widget or dashboard-reorder drag (both custom
   * types) is untouched. It never stops propagation: the zone's own React
   * handlers below have already run by the time this sees the event.
   */
  useEffect(() => {
    const allow = (e: DragEvent) => {
      if (carriesFiles(e.dataTransfer?.types)) e.preventDefault();
    };
    const swallow = (e: DragEvent) => {
      if (carriesFiles(e.dataTransfer?.types) || carriesLink(e.dataTransfer?.types)) {
        e.preventDefault();
      }
    };
    window.addEventListener("dragover", allow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", allow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  /**
   * The bdobb-settings.json half. Returns the line to show, as
   * runAppsImport does. A drop applies directly, with no review step, so it
   * builds its own notice from the plan's shape rather than the review-UI's
   * per-field lines
   * -- the older-format notice from planSettingsImport still wins when a
   * legacy file was dropped, since that message already says enough.
   */
  async function runSettingsImport(text: string, bytes: number): Promise<string> {
    const plan = planSettingsImport(text, bytes, useSettingsStore.getState().settings);
    if (!plan.ok) return plan.refusal;
    await useSettingsStore.getState().save(plan.patch);
    if (plan.folders !== null) await useFoldersStore.getState().replaceAll(plan.folders);
    if (plan.notice !== "") return plan.notice;
    if (plan.folders === null) return "Imported settings.";
    const n = plan.folders.folders.length;
    if (n === 0) return "Imported settings and cleared the folder tree.";
    return `Imported settings and ${n} ${n === 1 ? "folder" : "folders"}.`;
  }

  /** The local-table half: store the bytes, then add a card that reads them. */
  async function addFileCard(file: File, widget: WidgetDef): Promise<string | null> {
    const stored = await saveLocalFile(file);
    const { addCard, patchCardField } = useDashboardStore.getState();
    const cardId = await addCard(widget, { file: stored });
    if (cardId === null) {
      // No dashboard or tab to add to. The stored copy is deleted rather
      // than left behind: nothing would ever reach it again, and removeCard
      // -- the only other thing that deletes one -- has no card to run for.
      await deleteLocalFile(stored);
      return `Could not add ${file.name}`;
    }
    // The original name becomes the card's title. A second write: a card is
    // created with the widget's name and renamed after, which is the same
    // two steps a rename from the card menu takes.
    await patchCardField(cardId, "title", file.name);
    return null;
  }

  /**
   * One message per file that had something to say, joined into the single
   * notice line -- a drop of ten files must not leave ten of them.
   */
  async function handleFiles(files: File[]): Promise<void> {
    const messages: string[] = [];
    const widget = useWidgetRegistryStore.getState().find(BUILTIN_BACKEND_ID, LOCAL_TABLE_ID);
    if (!widget) {
      // Only reachable before bootstrap has seeded the built-ins, which is
      // before the dashboard this zone wraps has rendered at all.
      await logError(`the ${LOCAL_TABLE_ID} built-in is not in the registry`);
      return;
    }

    for (const file of files) {
      // The size is checked against File.size, BEFORE a byte is read.
      const refusal = localFileRefusal(file.name, file.size);
      if (refusal !== null) {
        messages.push(refusal);
        continue;
      }
      const ext = extensionOf(file.name);
      if (!TABLE_EXTENSIONS.has(ext)) {
        messages.push(`Unsupported file: ${file.name}`);
        continue;
      }

      try {
        // Only a .json small enough to BE an import is sniffed: the sniff
        // reads and parses the whole file, and doing that above the import
        // ceiling is the freeze importRefusal exists to prevent. A larger
        // .json is data as far as this zone is concerned, and takes the
        // table path with its own, larger ceiling.
        if (ext === "json" && file.size <= IMPORT_MAX_BYTES) {
          const text = await file.text();
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            messages.push(`Unsupported file: ${file.name}`);
            continue;
          }
          // A settings bundle is an OBJECT; an apps.json is an array. The two
          // sniffs cannot both answer yes, so the order is for readability
          // rather than precedence.
          if (isSettingsBundle(parsed)) {
            messages.push(await runSettingsImport(text, file.size));
            continue;
          }
          // An apps.json is a set of dashboards, not data. planAppsImport
          // parses the text again rather than taking this value: the parse
          // belongs with the limits, and this one exists only to tell the
          // two kinds of .json apart.
          if (isAppsJson(parsed)) {
            messages.push(await runAppsImport(text, file.size));
            continue;
          }
        }
        // Below everything already on the tab, like every other add path --
        // and each further file below the last, because the card the previous
        // pass added is already there when nextY runs again.
        const failure = await addFileCard(file, widget);
        if (failure !== null) messages.push(failure);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        messages.push(`Could not add ${file.name}: ${message}`);
        // The name and the error only. The file's CONTENTS are the user's
        // own data and never reach the log.
        await logError(`failed to handle a dropped file: ${message}`);
      }
    }
    setNotice(messages.length > 0 ? messages.join(" ") : null);
  }

  return (
    <main
      role="main"
      className={viewer ? "dashboard-area dashboard-area-viewer" : "dashboard-area"}
      ref={mainRef}
      onDragOver={(e) => {
        // Without preventDefault the browser never fires drop. Gated on the
        // type, so a widget, column or dashboard drag (all custom types)
        // passes straight through to the surfaces that own it.
        if (viewer || coveredByOverlay() || !carriesFiles(e.dataTransfer.types)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        // The veil is pointer-events: none, so the only dragleaves that
        // reach here are real ones -- except when the pointer crosses onto a
        // card, which is still inside the zone.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        if (viewer || coveredByOverlay() || !carriesFiles(e.dataTransfer.types)) return;
        e.preventDefault();
        setOver(false);
        // Read NOW: dataTransfer.files is empty once the handler returns.
        void handleFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {children}
      {over ? <div className="drop-veil">Drop files to add widgets</div> : null}
      {notice ? (
        <p className="drop-notice" role="status">
          {notice}
        </p>
      ) : null}
    </main>
  );
}
