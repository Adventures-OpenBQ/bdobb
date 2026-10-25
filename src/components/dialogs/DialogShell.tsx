// src/components/dialogs/DialogShell.tsx
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode, RefObject } from "react";

/**
 * The header/body/footer chrome every bd-* dialog shares. It is deliberately
 * dumb: it opens nothing, listens for nothing, and owns no state. The caller
 * passes the ref from its OWN useModalDialog call, because Escape ownership
 * differs per dialog — Settings discards its draft, Connections closes a
 * nested editor first — and a listener here could not tell them apart.
 *
 * `nav` omitted means a navless dialog: the body grid collapses to a single
 * column via .bd-content--full and no tab column is rendered. The body is
 * then no tabpanel either (there is no tablist to label it) and takes no tab
 * stop of its own.
 *
 * `plain` is for the child editor dialogs (BackendEditForm,
 * ProviderDetailsDialog): the body is a bare .bd-body with no tab grid and no
 * tabpanel role, and `note` sits in the footer as-is rather than in a <p>, so
 * it can be the dialog's leftmost button.
 */
export function DialogShell({
  dialogRef,
  ariaLabel,
  title,
  subtitle,
  headerActions,
  nav,
  bodyId,
  bodyLabelledBy,
  note,
  footerActions,
  onClose,
  modifier,
  plain,
  children,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  ariaLabel: string;
  title: string;
  subtitle?: string;
  headerActions?: ReactNode;
  nav?: ReactNode;
  bodyId?: string;
  bodyLabelledBy?: string;
  note?: ReactNode;
  footerActions?: ReactNode;
  onClose: () => void;
  modifier?: string;
  plain?: boolean;
  children: ReactNode;
}) {
  return (
    <dialog ref={dialogRef} className="bd-dialog-backdrop" aria-label={ariaLabel}>
      <div className={modifier ? `bd-dialog ${modifier}` : "bd-dialog"}>
        <header className="bd-header">
          <div className="bd-heading">
            <h2 className="bd-title">{title}</h2>
            {subtitle !== undefined ? <p className="bd-subtitle">{subtitle}</p> : null}
          </div>
          {headerActions !== undefined ? <div className="bd-actions">{headerActions}</div> : null}
          <button type="button" className="bd-button bd-button--icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        {plain ? (
          <div className="bd-body">{children}</div>
        ) : (
          <div className={nav !== undefined ? "bd-content" : "bd-content bd-content--full"}>
            {nav}
            <section
              className="bd-body"
              role={nav !== undefined ? "tabpanel" : undefined}
              id={bodyId}
              aria-labelledby={bodyLabelledBy}
              tabIndex={nav !== undefined ? 0 : undefined}
            >
              {children}
            </section>
          </div>
        )}

        <footer className="bd-footer">
          {plain ? note : <p>{note}</p>}
          {footerActions !== undefined ? <div className="bd-actions">{footerActions}</div> : null}
        </footer>
      </div>
    </dialog>
  );
}
