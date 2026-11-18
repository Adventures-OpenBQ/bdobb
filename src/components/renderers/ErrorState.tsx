// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";

/** `children` are further actions, drawn after Retry. */
export function ErrorState({
  message,
  onRetry,
  children,
}: {
  message: string;
  onRetry: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="error-state" role="alert">
      <p>{message}</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
      {children}
    </div>
  );
}
