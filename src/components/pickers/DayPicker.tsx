// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useContext, useRef, useState } from "react";
import { Button, Calendar, Dialog, DialogTrigger, I18nProvider, Popover } from "react-aria-components";
import { isExpression, parseWireDate } from "../../lib/dateExpressions";
import { CalendarBody } from "./CalendarBody";
import { PeriodPanels, PopupWidthContext } from "./PeriodPopover";
import type { RelativeContext } from "./RelativeTab";

type Props = {
  /** The param's label: the control's accessible name, through aria-label. */
  label: string;
  /**
   * What is STORED: a wire date (`2026-09-14`), an expression (`T-1bd`), or
   * "". The box shows this verbatim, so an expression stays readable and
   * editable instead of being resolved away the moment it is typed. A date
   * typed here by hand is the same literal a pick would have written.
   */
  value: string;
  /**
   * What `value` resolves to right now, from the caller's resolver. Read
   * beneath the box when `value` is an expression, and used as the CALENDAR's
   * position so the picker opens on the month the expression names rather
   * than on today.
   */
  resolved?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  /** Focus left the WHOLE control, or its calendar closed: the caller commits its draft. */
  onBlur?: () => void;
  /** The Relative tab's context (v5.3.0); absent means the calendar popover has no tabs. */
  relative?: RelativeContext;
  /** The STORED value: an expression seeds the Relative tab. */
  stored?: string;
  /**
   * Apply on the Relative tab. Separate from onChange, which carries wire
   * dates the caller drafts and commits on blur: an expression is committed
   * at once, by the caller, through the normal path.
   */
  onExpression?: (expr: string) => void;
};

/**
 * The day control as an EXPRESSION field: a free-text box holding whatever is
 * stored, a calendar chip beside it, and the resolution read underneath when
 * the box holds an expression.
 *
 * It replaces the segmented `DateInput` of v5.1–v5.4. A box that has to hold
 * `T-1bd` cannot also be three spinbuttons, so arrow-key editing of a
 * literal's parts is gone and the chip is how a date is chosen without
 * typing. A date typed by hand is validated and used exactly as a picked one
 * is -- both end up the same wire literal.
 *
 * Built on `DialogTrigger` and a standalone `Calendar` rather than on
 * react-aria's `DatePicker`. `DatePicker` wants its own `Group`, which is
 * marked pressable and swallows pointer and keyboard interaction with
 * anything inside it -- a free-text input in there could not be clicked into
 * or typed in at all (fireEvent reached it; a real user would not have).
 *
 * A pick REPLACES the expression: choosing a date is an explicit choice of a
 * literal and supersedes whatever was in the box. Cancelling, or closing with
 * Escape, never reaches onChange, so it leaves the expression alone.
 */
export function DayPicker({
  label, value, resolved, disabled = false, onChange, onBlur, relative, stored: storedValue, onExpression,
}: Props) {
  const width = useContext(PopupWidthContext);
  // Whether the popover is open, so a blur can tell "the user left the
  // control" from "focus went into the picker".
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;

  // The box holds the stored text; the CALENDAR is positioned on the resolved
  // date. An expression has no wire date of its own, so without this the
  // calendar would open on today and a pick would be a month from what the
  // field says.
  const picked = parseWireDate(resolved ?? value);
  // Only an expression earns the line underneath: a literal is already the
  // answer, and repeating it there is noise.
  const showResolved = isExpression("date", value) && (resolved ?? "") !== "";

  const calendarFor = (close: () => void) => (
    <Calendar
      aria-label={`${label} calendar`}
      firstDayOfWeek="mon"
      value={picked}
      onChange={(date) => {
        onChange(date.toString());
        close();
      }}
    >
      <CalendarBody />
    </Calendar>
  );

  return (
    <I18nProvider locale="en-CA">
      <div
        className="param-expr-field"
        onBlur={(event) => {
          // Focus-WITHIN, the contract the segmented control had: moving
          // between the box and the chip is not leaving the control, and
          // opening the picker is not either. Without both guards, clicking
          // the chip blurred the box, which committed a half-typed literal
          // BEFORE the picker's expression -- two writes, and a refetch for
          // a value nobody asked for.
          if (openRef.current) return;
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          onBlur?.();
        }}
      >
        <div className="param-expr-row" role="group" aria-label={label}>
          <input
            type="text"
            aria-label={label}
            className="param-expr-input"
            value={value}
            disabled={disabled}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
          />
          {/* The right chip. A calendar for a date field; the datetime
              control shows a clock for an instant.

              The glyph is aria-hidden: a visible emoji would land in the
              button's accessible name, and "Calendar" is what a screen
              reader should hear. */}
          <DialogTrigger
            isOpen={open}
            onOpenChange={(next) => {
              setOpen(next);
              openRef.current = next;
              // The close is a finished edit, reported as a blur so the
              // caller commits its draft -- the same contract the segmented
              // control had. One blur for the whole control, from here.
              if (!next) onBlur?.();
            }}
          >
            <Button aria-label="Calendar" className="param-chip" data-testid="param-picker-chip" isDisabled={disabled}>
              <span aria-hidden="true">{"\u{1F5D3}"}</span>
            </Button>
            <Popover placement="bottom start" style={width === undefined ? undefined : { width }}>
              <Dialog aria-label={`${label} calendar`}>
                {({ close }) => (
                  <PeriodPanels
                    label={label}
                    absolute={calendarFor(close)}
                    relative={relative && { type: "date", context: relative, value: storedValue ?? value }}
                    // The expression goes first: close() reports a blur,
                    // which the caller reads as "commit the draft". Handing
                    // the expression over before that lets the caller drop
                    // the draft, so Apply is one write -- the expression --
                    // and never an abandoned literal followed by it.
                    onApply={(expr) => {
                      onExpression?.(expr);
                      close();
                    }}
                  />
                )}
              </Dialog>
            </Popover>
          </DialogTrigger>
        </div>
        {showResolved ? (
          <p className="param-resolved" data-testid="param-resolved">{resolved}</p>
        ) : null}
      </div>
    </I18nProvider>
  );
}
