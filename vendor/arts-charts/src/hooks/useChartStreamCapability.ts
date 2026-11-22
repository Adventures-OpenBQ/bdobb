// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under BUSL-1.1.
// SPDX-License-Identifier: BUSL-1.1
import { useEffect, useRef, useState } from 'react';
import { getHost } from '../host';
import type { BackendConfig } from '../lib/types';

type Capability = 'pending' | 'accepted' | 'legacy' | 'error';
/** Discover before connecting. Once a source qualifies, failures cannot downgrade it. */
export function useChartStreamCapability(backend: BackendConfig, enabled: boolean): Capability {
  const key=JSON.stringify([backend.id,backend.baseUrl]);
  const qualified=useRef(new Set<string>());
  const [state,setState]=useState<{key:string;value:Capability}>({key:'',value:'pending'});
  useEffect(()=>{
    let cancelled=false;
    if (!enabled) return;
    if (qualified.current.has(key)) { setState({key,value:'accepted'}); return; }
    setState({key,value:'pending'});
    void getHost().fetchWidgetPath(backend,'widgets.json',{}).then(payload=>{
      if(cancelled) return;
      const manifest=payload as {live_chart?:{extra_metadata?:{chart_stream_v1?:unknown}}}|null;
      const accepted=manifest?.live_chart?.extra_metadata?.chart_stream_v1===true;
      if(accepted) qualified.current.add(key);
      setState({key,value:accepted?'accepted':'legacy'});
    },()=>{if(!cancelled) setState({key,value:qualified.current.has(key)?'accepted':'error'});});
    return ()=>{cancelled=true;};
  },[key,backend,enabled]);
  return !enabled?'legacy':qualified.current.has(key)?'accepted':state.key===key?state.value:'pending';
}
