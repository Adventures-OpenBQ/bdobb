// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { createContext, useContext, useState, type ReactNode } from "react";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";
import { isExpression } from "../../lib/dateExpressions";
import type { RelativeType } from "../../lib/presets";
import { PeriodTabs } from "./PeriodTabs";
import { RelativeTab, type RelativeContext } from "./RelativeTab";

/**
 * v5.4.0 (spec §4.8; ruling 18): a param's `style.popupWidth`, provided by
 * ParamControls around each control and read by every popover the app draws
 * — this one and the day picker's — instead of a prop through seven pickers.
 * Absent means the popover sizes to its content, as before.
 */
export const PopupWidthContext = createContext<number | undefined>(undefined);

/**
 * The Absolute | Relative tabs around a picker's absolute panel, landing on
 * Relative when the stored value is an expression; without a `relative`, the
 * absolute panel alone. Shared by PeriodPopover and the day picker.
 */
export function PeriodPanels({ label, absolute, relative, onApply }: {
  label: string;
  absolute: ReactNode;
  relative?: { type: RelativeType; context: RelativeContext; value: string };
  onApply: (expr: string) => void;
}) {
  if (!relative) return <>{absolute}</>;
  return (
    <PeriodTabs
      initial={isExpression(relative.type, relative.value) ? "relative" : "absolute"}
      absolute={absolute}
      relative={<RelativeTab type={relative.type} label={label} value={relative.value} context={relative.context} onApply={onApply} />}
    />
  );
}

type Props = {
  /** The param's label: the trigger's AND the dialog's accessible name. */
  label: string;
  /** What the trigger shows — the current value, formatted by labels.ts. */
  trigger: string;
  disabled?: boolean;
  /** Called as the popover opens: where a picker resets its draft. */
  onOpen?: () => void;
  /** The Absolute contents, handed `close` for a pick that has to close the popover. */
  children: (close: () => void) => ReactNode;
  /**
   * The Relative tab, when the control has one (v5.3.0); absent means no tabs
   * at all. `value` is the STORED value: the tabs land on Relative when it is
   * an expression, and it seeds the tab's rows. `onApply` is the picker's own
   * onChange — Apply commits through the same path a pick uses, so a grouped
   * control moves its group (splitParamEdit) exactly as an absolute pick
   * would.
   */
  relative?: { type: RelativeType; context: RelativeContext; value: string; onApply: (expr: string) => void };
};

/**
 * The compact trigger every period control but the day picker and the time
 * field uses: a button showing the value, a popover holding the picker. The
 * button is named by the param's label rather than by its text, so a test
 * or a screen reader finds "Quarter" whatever quarter it currently shows.
 * Escape closes without writing — the popover's own contents decide when
 * something is committed, and they only do so on a pick.
 *
 * Owns its open state: a pick inside has to close the popover itself, which
 * it does through the `close` its children are handed, and reopening must
 * reset the popover's local draft to the committed value, which the picker
 * does in `onOpen`.
 *
 * `aria-haspopup="dialog"` is set here rather than left to DialogTrigger,
 * which only fills it in for menus and listboxes; design §6 requires it on
 * every popover trigger.
 *
 * With a `relative` panel the dialog holds the Absolute | Relative tabs (spec §4); the Absolute panel is exactly what the popover held before, so every v5.2.0 pick behaves as it did.
 */
export function PeriodPopover({ label, trigger, disabled = false, onOpen, children, relative }: Props) {
  const [isOpen, setOpen] = useState(false);
  const onOpenChange = (next: boolean) => {
    if (next) onOpen?.();
    setOpen(next);
  };
  const close = () => setOpen(false);
  const width = useContext(PopupWidthContext);
  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
      <Button className="react-aria-Button period-trigger" aria-label={label} aria-haspopup="dialog" isDisabled={disabled}>
        {trigger}
      </Button>
      <Popover placement="bottom start" style={width === undefined ? undefined : { width }}>
        <Dialog aria-label={label}>
          <PeriodPanels
            label={label}
            absolute={children(close)}
            relative={relative}
            onApply={(expr) => {
              close();
              relative?.onApply(expr);
            }}
          />
          {/* The only visible way out. Escape and click-outside already
              dismissed this popover, but neither is discoverable, and Apply
              being the one button on screen made the popover read as
              something you had to commit to. Popover-level rather than beside
              Apply so the Absolute tab -- which has no action row at all,
              committing on pick -- gets an exit too.

              Named Close, not Cancel: RelativeTab already uses Cancel for
              its preset-naming sub-flow, and two buttons reading Cancel in one
              dialog is ambiguous to a screen reader and to a person.

              It closes and writes nothing. The draft dies with the Dialog,
              which react-aria unmounts on close, so the next open re-seeds
              from the stored value through `onOpen`. */}
          <div className="period-popover-actions">
            <button type="button" className="period-cancel" onClick={close}>Close</button>
          </div>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
