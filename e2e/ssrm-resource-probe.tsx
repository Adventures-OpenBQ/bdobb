// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {createRoot} from 'react-dom/client';
import {useTableResult} from '../src/hooks/useTableResult';
/** Test-only observer of the production hook; never replaces its provider or rows. */
export let result:ReturnType<typeof useTableResult>;
function Probe(){result=useTableResult('d1','resource');return <output id="native-cache-count" title={JSON.stringify({status:result.view.status,error:result.view.error,active:result.view.active})}>{result.blocks.length}</output>;}
export function mount(){const el=document.createElement('aside');document.body.append(el);const root=createRoot(el);root.render(<Probe/>);return ()=>{root.unmount();el.remove();};}
