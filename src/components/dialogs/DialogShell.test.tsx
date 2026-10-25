// src/components/dialogs/DialogShell.test.tsx
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useModalDialog } from "../../hooks/useModalDialog";
import { DialogShell } from "./DialogShell";

function Harness(props: { onClose: () => void; withNav?: boolean }) {
  const dialogRef = useModalDialog(props.onClose);
  return (
    <DialogShell
      dialogRef={dialogRef}
      ariaLabel="Settings"
      title="Settings"
      subtitle="Make the workspace your own"
      headerActions={<button type="button">Export…</button>}
      nav={props.withNav ? <div data-testid="nav" role="tablist" aria-label="Preferences" /> : undefined}
      bodyId="settings-panel"
      bodyLabelledBy="settings-tab-general"
      note={<>A footer note.</>}
      footerActions={<button type="button">Done</button>}
      onClose={props.onClose}
    >
      <p>Body content</p>
    </DialogShell>
  );
}

describe("DialogShell", () => {
  it("renders the header, body and footer with aria wiring", () => {
    render(<Harness onClose={vi.fn()} withNav />);
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog).toHaveClass("bd-dialog-backdrop");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Make the workspace your own")).toBeInTheDocument();
    const body = screen.getByRole("tabpanel");
    expect(body).toHaveAttribute("id", "settings-panel");
    expect(body).toHaveAttribute("aria-labelledby", "settings-tab-general");
    expect(body).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("Body content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.getByTestId("nav")).toBeInTheDocument();
  });

  it("calls onClose from the Close button", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} withNav />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses bd-content--full and renders no tablist when nav is omitted", () => {
    render(<Harness onClose={vi.fn()} />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
    // The .bd-content--full class lives on the wrapper around the body.
    expect(document.querySelector(".bd-content--full")).not.toBeNull();
  });
});
