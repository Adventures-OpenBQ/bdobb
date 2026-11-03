// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {useState} from 'react';
import {parseDraft} from '../../lib/temporal/explorer';
import type {DashboardCard} from '../../lib/types';
import {useBackendsStore} from '../../stores/backendsStore';
import {TemporalExplorerDialog} from '../dialogs/TemporalExplorerDialog';

/** The compact explorer card: connection, selection, draft, and Open explorer. Viewers may open it to browse. */
export function TemporalExplorerRenderer({card,readOnly}:{card:DashboardCard;readOnly:boolean}){
 const [open,setOpen]=useState(false);
 const backend=useBackendsStore(s=>s.backends.find(b=>b.id===card.backendId));
 const draft=parseDraft(card.params.draft);
 return <div className="temporal-explorer-card">
  <dl className="temporal-explorer-summary">
   <dt>Connection</dt><dd>{backend?.name??'Unavailable'}</dd>
   <dt>Dataset</dt><dd>{card.params.dataset_id?<><code>{card.params.dataset_id}</code> · {card.params.tier||'silver'}</>:'None chosen'}</dd>
   {draft.title?<><dt>Draft</dt><dd>{draft.title}{draft.revision?` · revision ${draft.revision}`:''}</dd></>:null}
  </dl>
  <button className="bd-button bd-button--primary" type="button" onClick={()=>setOpen(true)}>Open explorer</button>
  {open?<TemporalExplorerDialog card={card} readOnly={readOnly} onClose={()=>setOpen(false)}/>:null}
 </div>;
}
