// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A labelled on/off pill switch, for preferences the app actually persists —
 * the follow-up-suggestions toggle and a skill's Enabled flag. Never render it
 * for a preference the app does not store; a passive badge is the right control
 * for a value the app only reports.
 */
export function PreferencePill({
  label,
  checked,
  onChange,
  disabled,
  describedBy,
  ariaLabel,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  describedBy?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className="bd-pill-toggle"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      {label} <span className="pref-state" aria-hidden="true">{checked ? "On" : "Off"}</span>
    </button>
  );
}
