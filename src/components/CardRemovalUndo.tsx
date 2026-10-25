// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from 'react';
import { useDashboardStore } from '../stores/dashboardStore';

/** One bounded, session-only recovery control. Never mounted as a viewer mutation. */
export function CardRemovalUndo() {
  const entry = useDashboardStore(s => s.pendingCardRemoval);
  const viewer = useDashboardStore(s => s.viewer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setError(''); }, [entry]);
  if (!entry || viewer) return null;
  const run = async (undo: boolean) => {
    setBusy(true); setError('');
    try {
      if (undo) await useDashboardStore.getState().undoCardRemoval();
      else await useDashboardStore.getState().dismissCardRemoval();
    } catch {
      setError(undo ? 'Could not undo removal. Try again.' : 'Could not dismiss removal. Try again.');
    } finally { setBusy(false); }
  };
  return <div className="card-removal-undo" role="status" aria-live="polite">
    <span>Card removed.</span>
    <button type="button" disabled={busy} onClick={() => void run(true)}>Undo</button>
    <button type="button" disabled={busy} onClick={() => void run(false)}>Dismiss</button>
    {error && <span role="alert">{error}</span>}
  </div>;
}
