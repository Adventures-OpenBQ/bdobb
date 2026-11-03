// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest';
import {exportCompatibleApp,importApps} from '../appsJson';
import {servedTemporalApp} from './portable';
import {card,widget} from '../../test/fixtures';
import {fixed,executionId} from './fixtures';
import type {Dashboard} from '../types';
it('roundtrips fixed, opt-in latest and pinned bindings through compatible apps files with exact source identity',()=>{
 const bindings=[fixed,{kind:'query' as const,queryId:fixed.queryId,revisionPolicy:'latest' as const,params:{},context:fixed.context},{kind:'execution' as const,executionId}];
 const d:Dashboard={id:'d',name:'Queries',tabs:[{id:'tab',name:'Tab',cards:bindings.map((binding,i)=>card({id:String(i),backendId:'exact-original',queryBinding:binding}))}]};
 const exported=exportCompatibleApp(d);expect(exported.ok).toBe(true);if(!exported.ok)throw Error(exported.issue.message);
 const result=importApps(JSON.parse(JSON.stringify([exported.value])),[widget({backendId:'different-service'})]);expect(result.dashboards[0].tabs[0].cards.map(c=>c.queryBinding)).toEqual(bindings);expect(result.dashboards[0].tabs[0].cards.every(c=>c.backendId==='exact-original')).toBe(true);
});

it('preserves tab order when JSON reorders numeric tab keys and retains future binding intent',()=>{
 const future={...fixed,schemaVersion:77};const d:Dashboard={id:'d',name:'Queries',tabs:[{id:'20',name:'First',cards:[card({queryBinding:future})]},{id:'1',name:'Second',cards:[card({id:'second',queryBinding:{kind:'execution',executionId}})]}]};
 const exported=exportCompatibleApp(d);if(!exported.ok)throw Error(exported.issue.message);
 const raw=JSON.parse(JSON.stringify([exported.value]));const result=importApps(raw,[]);expect(result.dashboards[0].tabs[0].cards[0].queryBinding).toEqual(future);expect(result.dashboards[0].tabs[1].cards[0].queryBinding).toEqual({kind:'execution',executionId});
 const snapshot=JSON.stringify(raw);raw[0].extensions.bdobbV11.schemaVersion=2;expect(()=>importApps(raw,[])).toThrow(/future temporal overlay/);raw[0].extensions.bdobbV11.schemaVersion=1;expect(JSON.stringify(raw)).toBe(snapshot);
});

it('binds a TemporalDB-served example to the connection that served it, exactly as TemporalDB 0.5.0 serves it',()=>{
 const layoutCard=(i:string,x:number,y:number,title:string,params:Record<string,string>={})=>({i,x,y,w:i==='temporaldb_explorer'?40:20,h:i==='temporaldb_explorer'?10:14,state:{params,chartView:{enabled:false,chartType:'line'},extensions:{bdobb:{schemaVersion:1,profile:'v3',title}}}});
 const served={name:'Example Dashboard - Version 11.0.0 - TemporalDB',description:'Opens in BDOBB 11.0.0 or later.',img:'',img_dark:'',img_light:'',allowCustomization:true,groups:[],prompts:[],
  tabs:{temporaldb:{id:'temporaldb',name:'TemporalDB',layout:[layoutCard('temporaldb_explorer',0,0,'TemporalDB explorer',{dataset_id:'eodhd.eod',tier:'silver'}),layoutCard('temporaldb_query',0,10,'AAPL daily prices (example)'),layoutCard('temporaldb_query',20,10,'FRED series against EODHD closes (example)')]}},
  extensions:{bdobb:{schemaVersion:1,profile:'v3',tabOrder:['temporaldb']},bdobbV11:{schemaVersion:1,cards:[{tab:'temporaldb',index:1,backendId:'temporaldb',binding:{kind:'query',queryId:fixed.queryId,revisionPolicy:'fixed',revision:1,params:{},context:{schema_version:1,mode:'current_corrected'}}}]}}};
 const registry=[widget({id:'temporaldb_explorer',backendId:'tdb',type:'temporaldb_explorer'}),widget({id:'temporaldb_query',backendId:'tdb',type:'query_data'})];
 const cards=importApps(JSON.parse(JSON.stringify([servedTemporalApp(served,'tdb')])),registry).dashboards[0].tabs[0].cards;
 expect(cards.map(c=>[c.widgetId,c.backendId,c.title])).toEqual([['temporaldb_explorer','tdb','TemporalDB explorer'],['temporaldb_query','tdb','AAPL daily prices (example)'],['temporaldb_query','tdb','FRED series against EODHD closes (example)']]);
 expect(cards[0].params).toEqual({dataset_id:'eodhd.eod',tier:'silver'});
 expect(cards[1].queryBinding).toMatchObject({kind:'query',queryId:fixed.queryId,revision:1});
 expect(cards[2].queryBinding).toBeUndefined();
 expect(served.extensions.bdobbV11.cards[0].backendId).toBe('temporaldb');
 expect(servedTemporalApp({name:'plain'},'tdb')).toEqual({name:'plain'});
});
