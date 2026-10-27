// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import { useEffect, useRef, type ReactNode } from "react";

/**
 * A small anchored popover for the header and rail (spec §4, §9): rendered
 * under its button inside a `.chart-popover-anchor`, closed by Escape or a
 * pointer press outside it. Not a modal: the chart stays live behind it.
 *
 * "Outside" is the ANCHOR, not this div: the opener button is a sibling
 * inside the same `.chart-popover-anchor`, and counting a press on it as
 * outside made the opener unable to close its own popover -- the press
 * closed it and the click that followed reopened it. With the anchor as the
 * boundary the opener is free to be a plain toggle.
 */
export function Popover({ open, label, onClose, children }: { open: boolean; label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const onPress = (event: PointerEvent) => {
      const anchor = ref.current?.closest(".chart-popover-anchor") ?? ref.current;
      if (anchor !== null && !anchor.contains(event.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onPress); };
  }, [open, onClose]);
  if (!open) return null;
  return <div ref={ref} className="chart-popover" role="dialog" aria-label={label}>{children}</div>;
}
