// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { Component, type ReactNode } from "react";
import { useModalDialog } from "../hooks/useModalDialog";
import { logError } from "../lib/logger";
import { clampLogName } from "../lib/logNames";

type Props = {
  /**
   * Named as it reads inside the sentence — "the widget library", "the app" —
   * because it is interpolated into it, and into the one log line below.
   */
  label: string;
  /**
   * Any value whose CHANGE means "this region is starting over": a dialog's
   * open state, a card's view. A boundary that caught a crash stays caught
   * until someone clears it, so without this a dialog reopened after a throw
   * would come back to its fallback rather than to itself.
   */
  resetKey?: unknown;
  /**
   * How this region is closed, for the regions that CAN be closed — every
   * dialog passes its own `onClose`. Supplying it adds a Dismiss beside
   * Retry, and it has to exist: each dialog's boundary sits inside its own
   * `open ? ... : null`, so a deterministic crash leaves the dialog's open
   * state true with its own Close button never rendered, and Retry only
   * re-runs the render that just threw. Omitted by the panes (rail, grid,
   * drop zone), which have nothing to be dismissed to.
   */
  onDismiss?: () => void;
  children: ReactNode;
};

type State = { message: string | null };

/** The same shape every catch site in this app uses for a thrown unknown. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A class, and the only one in the app: `getDerivedStateFromError` and
 * `componentDidCatch` have no hook equivalent, and a render error can be
 * caught nowhere else.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: messageOf(error) };
  }

  /**
   * One parameter deliberately: React's second argument is the ErrorInfo, and
   * its componentStack names every component between the boundary and the
   * throw. That is a shape of the tree, and this log is read on a user's
   * machine — so the line carries the region's own label and the error's
   * message, and nothing else. No prop is reachable from here on purpose
   * either: a card's parameters or a backend's header would otherwise ride
   * out on a crash.
   *
   * The label is clamped because a card's boundary is labelled with its
   * widget's `name`, which came from whatever backend the user added: a
   * newline in it would end this line early and write a second one of the
   * backend's choosing. Only the LOG line -- on screen the label is text in a
   * paragraph, where a control character forges nothing and a truncated
   * widget name would only be harder to read.
   */
  componentDidCatch(error: unknown): void {
    void logError(`unhandled error in ${clampLogName(this.props.label)}: ${messageOf(error)}`);
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.message !== null) {
      this.setState({ message: null });
    }
  }

  /** Dismiss, from its button or from Escape: clear the caught state AND close. */
  private dismiss = (): void => {
    this.setState({ message: null });
    this.props.onDismiss?.();
  };

  render(): ReactNode {
    if (this.state.message === null) return this.props.children;
    // No wrapper while nothing is caught (above) and .error-box when
    // something is: the fallback is the app's existing error card -- the same
    // --error text and outlined Retry as ErrorState, which is what a card
    // body already shows when a fetch fails.
    const box = (
      <div className="error-box" role="alert">
        <p>Something went wrong in {this.props.label}.</p>
        <p className="error-box-message">{this.state.message}</p>
        <button type="button" onClick={() => this.setState({ message: null })}>
          Retry
        </button>
        {/* Clearing the caught state as well as closing: the region is being
            unmounted here, but a boundary hoisted outside its conditional
            would otherwise come back to this fallback on the next open. */}
        {this.props.onDismiss ? (
          <button type="button" onClick={this.dismiss}>
            Dismiss
          </button>
        ) : null}
      </div>
    );
    // A pane's fallback is plain markup in the layout it replaced, and that
    // is right: the rail, the grid and the drop zone are not modal, and a
    // dialog over the whole window for one third of it failing -- with no
    // Dismiss to leave it by -- would be worse than the crash.
    if (!this.props.onDismiss) return box;
    // A DIALOG's fallback, though, replaces a showModal() dialog, so it has
    // to be one too. The plain box is ordinary markup in the dashboard area:
    // with another modal already open (Connections, say) the UA's top layer
    // puts that dialog and its backdrop above it and makes everything
    // underneath inert -- so the Dismiss that exists precisely to escape a
    // deterministic crash could not be clicked until the OTHER dialog was
    // closed. The same idiom HelpLoadFailed uses, and for the same reason.
    //
    // On the shared modal stack, through FallbackDialog below: Escape
    // closes whichever dialog is on top, so it Dismisses this fallback rather
    // than reaching a dialog underneath and closing THAT one. The hook also
    // prevents the UA's own Escape close request, which would close the
    // element without telling React, leaving the parent's open state true
    // with nothing on screen.
    return (
      <FallbackDialog label={this.props.label} onClose={this.dismiss}>
        {box}
      </FallbackDialog>
    );
  }
}

/**
 * A function component only so the fallback can use useModalDialog, which a
 * class cannot. Mounted when the fallback appears, so the hook's showModal()
 * and modalStack push happen exactly then, and its cleanup when it goes.
 */
function FallbackDialog({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useModalDialog(onClose);
  return (
    <dialog ref={dialogRef} className="modal-backdrop" aria-label={`Something went wrong in ${label}`}>
      {children}
    </dialog>
  );
}
