// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `secondsLeft` is the provider's retry wait (useWidgetData's `retryIn`): while
 * it runs the button is disabled and says how long, because a press would only
 * be refused again. Callers that have no wait pass nothing and get Retry.
 */
export function ErrorState({
  message,
  onRetry,
  secondsLeft,
}: {
  message: string;
  onRetry: () => void;
  secondsLeft?: number;
}) {
  const waiting = secondsLeft !== undefined && secondsLeft > 0;
  return (
    // The alert is the message alone. The button's label changes every second
    // during a wait, and inside an assertive live region a screen reader would
    // read each new count aloud for as long as the wait runs.
    <div className="error-state">
      <p role="alert">{message}</p>
      <button type="button" onClick={onRetry} disabled={waiting}>
        {waiting ? `Try again in ${secondsLeft} s` : "Retry"}
      </button>
    </div>
  );
}
