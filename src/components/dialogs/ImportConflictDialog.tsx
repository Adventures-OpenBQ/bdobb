// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef } from "react";
import { useModalDialog } from "../../hooks/useModalDialog";
import type { ImportConflict, ImportDecision } from "../../lib/appsJson";
import { ask } from "./WorkspaceDialogs";

type Choice = ImportDecision | "cancel";

function counts({ tabs, cards }: { tabs: number; cards: number }): string {
  return `${tabs} tab${tabs === 1 ? "" : "s"}, ${cards} card${cards === 1 ? "" : "s"}`;
}

/**
 * One conflicting dashboard, one answer. Built on the shared .modal-backdrop
 * shell and useModalDialog, which refuses the native close request, handles
 * Escape and hands focus back to the opener on unmount.
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
  const dialogRef = useModalDialog(() => onDecide("cancel"));
  const keepRef = useRef<HTMLButtonElement>(null);
  const name = conflict.imported.name;
  const owners = conflict.existingIds.length;
  const title = `A dashboard named "${name}" already exists`;

  useEffect(() => {
    // After showModal(): its focusing steps would otherwise land on Replace,
    // the first button, and one Enter would overwrite a dashboard.
    keepRef.current?.focus();
  }, []);

  return (
    <dialog ref={dialogRef} className="modal-backdrop" aria-label={title}>
      <div className="modal modal-import-conflict">
        <header className="modal-header">
          <h2>{title}</h2>
        </header>
        {total > 1 ? (
          <p className="import-conflict-count">{`Conflict ${index + 1} of ${total}`}</p>
        ) : null}
        <p>{`Yours: ${counts(conflict.yours)}`}</p>
        <p>{`In the file: ${counts(conflict.incoming)}`}</p>
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
 * its own root (ask) so the rail and the drop zone share one loop without either
 * holding dialog state. `keepBothName` gets the answers so far, because an
 * earlier Keep both can take the name a later one would have had.
 */
export async function decideImportConflicts(
  conflicts: ImportConflict[],
  keepBothName: (index: number, prior: ImportDecision[]) => string,
): Promise<ImportDecision[] | "cancelled"> {
  const decisions: ImportDecision[] = [];
  for (const [index, conflict] of conflicts.entries()) {
    // A fresh root per conflict, so showModal() and the focus run again.
    const choice = await ask<Choice>((answer) => (
      <ImportConflictDialog
        conflict={conflict}
        index={index}
        total={conflicts.length}
        // A copy: the array goes on growing after this call.
        keepBothName={keepBothName(index, [...decisions])}
        onDecide={answer}
      />
    ));
    if (choice === "cancel") return "cancelled";
    decisions.push(choice);
  }
  return decisions;
}
