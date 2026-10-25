// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { modalStack } from "../../hooks/modalStack";
import type { ImportConflict, ImportDecision } from "../../lib/appsJson";

type Choice = ImportDecision | "cancel";

/**
 * One conflicting dashboard, one answer. Built on the shared .modal-backdrop
 * shell and the HelpDialog idiom: a real <dialog> opened with showModal(),
 * Escape handled on document with the native close request refused.
 */
export function ImportConflictDialog({
  conflict,
  index,
  total,
  keepBothName,
  onDecide,
}: {
  conflict: ImportConflict;
  index: number;
  total: number;
  keepBothName: string;
  onDecide: (choice: Choice) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const name = conflict.imported.name;
  const owners = conflict.existingIds.length;
  const title = `A dashboard named "${name}" already exists`;

  useEffect(() => {
    dialogRef.current?.showModal();
    // After showModal(): its focusing steps would otherwise land on Replace,
    // the first button, and one Enter would overwrite a dashboard.
    keepRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onDecide("cancel");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDecide]);

  // On the shared modal stack as well, for when this opens over a dialog
  // that is on it (the Apps dialog's Open, v4.0.5). That dialog's Escape
  // listener (useModalDialog) was added first, so it runs first and closes
  // modalStack.top() -- this entry -- which cancels the import and leaves
  // the dialog underneath open, instead of closing that dialog under a
  // question still waiting for its answer. Over nothing else, the listener
  // above is the only one and handles Escape itself.
  useEffect(() => {
    const entry = { close: () => onDecide("cancel") };
    modalStack.push(entry);
    return () => modalStack.remove(entry);
  }, [onDecide]);

  return (
    <dialog
      ref={dialogRef}
      className="modal-backdrop"
      aria-label={title}
      onCancel={(e) => e.preventDefault()}
    >
      <div className="modal modal-import-conflict">
        <header className="modal-header">
          <h2>{title}</h2>
        </header>
        {total > 1 ? (
          <p className="import-conflict-count">{`Conflict ${index + 1} of ${total}`}</p>
        ) : null}
        <p>{`Yours: ${conflict.yours.tabs} tabs, ${conflict.yours.cards} cards`}</p>
        <p>{`In the file: ${conflict.incoming.tabs} tabs, ${conflict.incoming.cards} cards`}</p>
        <div className="import-conflict-actions">
          <button
            type="button"
            className="import-conflict-replace"
            disabled={owners > 1}
            onClick={() => onDecide("replace")}
          >
            Replace
            <span className="import-conflict-caption">
              {owners > 1
                ? `You have ${owners === 2 ? "two" : owners} dashboards named "${name}"; rename one to replace it.`
                : "Replaces yours, including anything added since"}
            </span>
          </button>
          <button type="button" ref={keepRef} onClick={() => onDecide("keep")}>
            Keep both
            <span className="import-conflict-caption">{`Adds it as "${keepBothName}"`}</span>
          </button>
          <button type="button" onClick={() => onDecide("skip")}>
            Skip
            <span className="import-conflict-caption">This dashboard is not imported</span>
          </button>
          <button type="button" onClick={() => onDecide("cancel")}>
            Cancel import
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Asks about every conflict, in file order, and writes nothing. Rendered into
 * its own root so the rail and the drop zone share one loop without either
 * holding dialog state. `keepBothName` gets the answers so far, because an
 * earlier Keep both can take the name a later one would have had.
 */
export async function decideImportConflicts(
  conflicts: ImportConflict[],
  keepBothName: (index: number, prior: ImportDecision[]) => string,
): Promise<ImportDecision[] | "cancelled"> {
  const decisions: ImportDecision[] = [];
  if (conflicts.length === 0) return decisions;
  // unmount() removes the open modal, which would leave focus on <body>.
  const opener = document.activeElement;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    for (const [index, conflict] of conflicts.entries()) {
      const choice = await new Promise<Choice>((resolve) => {
        root.render(
          <ImportConflictDialog
            // A fresh mount per conflict, so showModal() and the focus run again.
            key={index}
            conflict={conflict}
            index={index}
            total={conflicts.length}
            // A copy: the array goes on growing after this call.
            keepBothName={keepBothName(index, [...decisions])}
            onDecide={resolve}
          />,
        );
      });
      if (choice === "cancel") return "cancelled";
      decisions.push(choice);
    }
    return decisions;
  } finally {
    root.unmount();
    host.remove();
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }
}
