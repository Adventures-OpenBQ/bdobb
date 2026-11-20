// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {create} from "zustand";
import type {SurfaceDataset} from "../lib/linkedSurface";
export type LinkedSourcePublication = {
  status: "ready" | "loading" | "error" | "unresolved" | "incomplete";
  generation: number;
  queryKey: string;
  title: string;
  stale: boolean;
  data?: SurfaceDataset;
  error?: string;
  refresh?: () => void;
};
type Entry = {owner:symbol; publication?:LinkedSourcePublication};
export const linkedSourceKey=(dashboardId:string,cardId:string)=>JSON.stringify([dashboardId,cardId]);
export const useLinkedSourcesStore=create<{sources:ReadonlyMap<string,Entry>}>(()=>({sources:new Map()}));

/** Leases prevent a late unmount or obsolete acquisition from replacing a new owner. */
export function acquireLinkedSource(dashboardId:string,cardId:string){
  const key=linkedSourceKey(dashboardId,cardId),owner=Symbol("linked source");
  useLinkedSourcesStore.setState(state=>({sources:new Map(state.sources).set(key,{owner})}));
  return {
    read:()=>useLinkedSourcesStore.getState().sources.get(key)?.publication,
    publish:(publication:LinkedSourcePublication)=>useLinkedSourcesStore.setState(state=>{
      const current=state.sources.get(key);
      if(current?.owner!==owner || publication.generation<(current.publication?.generation??-1))return state;
      return {sources:new Map(state.sources).set(key,{owner,publication})};
    }),
    dispose:()=>useLinkedSourcesStore.setState(state=>{
      if(state.sources.get(key)?.owner!==owner)return state;
      const sources=new Map(state.sources);sources.delete(key);return {sources};
    }),
  };
}
