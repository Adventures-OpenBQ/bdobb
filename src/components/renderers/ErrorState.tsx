// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="error-state" role="alert">
      <p>{message}</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
