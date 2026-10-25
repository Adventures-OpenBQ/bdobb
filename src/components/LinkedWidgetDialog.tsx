// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useId, useState } from 'react';
import { useModalDialog } from '../hooks/useModalDialog';
import { useDashboardStore } from '../stores/dashboardStore';
import { canUseLinkedSource } from '../lib/widgetData/sources';
import { DialogShell } from './dialogs/DialogShell';

export function LinkedWidgetDialog({ dashboardId, tabId, cardId, presentation = 'table', sourceWidgetId, onClose }: {
  dashboardId: string; tabId: string; cardId?: string; presentation?: 'table' | 'chart'; sourceWidgetId?: string; onClose: () => void;
}) {
  const dashboard = useDashboardStore(s => s.dashboards.find(d => d.id === dashboardId));
  const [source, setSource] = useState(sourceWidgetId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const target = useId();
  const selectId = useId();
  const dialogRef = useModalDialog(onClose);
  const choices = dashboard?.tabs.flatMap(tab => tab.cards.filter(card => canUseLinkedSource(dashboard, cardId ?? target, card.id)).map(card => ({ id: card.id, label: `${card.title ?? card.widgetId} — ${tab.name}` }))) ?? [];
  const valid = choices.some(c => c.id === source);
  const label = cardId ? 'Choose source' : `Create linked ${presentation}`;
  async function save() {
    if (!valid || saving) return;
    setSaving(true); setError('');
    try {
      const store = useDashboardStore.getState();
      const result = cardId ? await store.replaceLinkedSource(cardId, source) : await store.addLinkedCard({ dashboardId, tabId, sourceWidgetId: source, presentation });
      if (result) onClose();
      else setError('Source unavailable. Choose a source in this dashboard.');
    } catch { setError('Could not save the linked widget. Try again.'); }
    finally { setSaving(false); }
  }
  return <DialogShell dialogRef={dialogRef} title={label} ariaLabel={label} onClose={onClose} plain
    footerActions={<><button type="button" className="bd-button" onClick={onClose}>Cancel</button><button type="button" className="bd-button bd-button--primary" disabled={!valid || saving} onClick={() => void save()}>{label}</button></>}>
    <label htmlFor={selectId}>Source table</label>
    <select id={selectId} value={valid ? source : ''} onChange={e => setSource(e.target.value)} disabled={saving}>
      <option value="">Choose source</option>
      {choices.map(choice => <option value={choice.id} key={choice.id}>{choice.label}</option>)}
    </select>
    {!choices.length ? <p>No eligible table sources in this dashboard.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </DialogShell>;
}
