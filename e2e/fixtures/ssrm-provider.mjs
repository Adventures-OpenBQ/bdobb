// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {createServer} from 'node:http';
import {pathToFileURL,URL} from 'node:url';
import process from 'node:process';
import {Buffer} from 'node:buffer';
/** Contract fixture for OpenBB ssrm_mode/main.py + query_builder.py (2026-10-14).
 * Computes only inside this test backend. The production adapter never aggregates pages.
 * No implicit pivot support: the official query builder ignores pivotCols.
 */
export async function createSsrmFixtureServer({port=0,rows=[
 {country:'US',city:'NY',amount:10},{country:'US',city:'NY',amount:20},
 {country:'US',city:'SF',amount:30},{country:'CA',city:'TO',amount:40},
 {country:'CA',city:'TO',amount:50},{country:'CA',city:'VA',amount:60},
]}={}){
 const calls=[];
 const server=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
  const url=new URL(req.url,'http://localhost');
  const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(body));};
  if(url.pathname==='/widgets.json'){
   send(200,{ssrm_table:{name:'SSRM Table',description:'Live SSRM contract fixture',type:'ssrm_table',endpoint:'data-ssrm',gridData:{w:12,h:8},params:[]}});return;
  }
  if(url.pathname!=='/data-ssrm'||req.method!=='POST'){send(404,{detail:'not found'});return;}
  try{
   const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>1048576){send(413,{detail:'too large'});return;}chunks.push(chunk);}
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));calls.push({url:req.url,body,headers:{...req.headers}});
   if(!Number.isSafeInteger(body.startRow)||!Number.isSafeInteger(body.endRow)||body.startRow<0||body.endRow<=body.startRow||body.endRow-body.startRow>500)throw new Error('invalid row bounds');
   if(body.pivotMode)throw new Error('fixture does not implement pivot');
   let result=rows.filter(row=>(body.groupKeys??[]).every((key,i)=>String(row[body.rowGroupCols[i].field])===key));
   for(const [field,filter] of Object.entries(body.filterModel??{})){
    if(filter.filterType==='text')result=result.filter(row=>String(row[field]).toLowerCase().includes(filter.filter.toLowerCase()));
    else if(filter.filterType==='number')result=result.filter(row=>filter.type==='inRange'?row[field]>=filter.filter&&row[field]<=filter.filterTo:filter.type==='greaterThanOrEqual'?row[field]>=filter.filter:filter.type==='lessThanOrEqual'?row[field]<=filter.filter:row[field]===filter.filter);
    else throw new Error('unsupported fixture filter');
   }
   const group=body.rowGroupCols?.[(body.groupKeys??[]).length]?.field;
   if(group){
    const buckets=new Map();for(const row of result){const key=row[group];if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(row);}
    result=[...buckets].map(([key,members])=>{
     const row={[group]:key};if(!body.valueCols?.length)row.count=members.length;
     for(const value of body.valueCols??[]){
      const values=members.map(member=>member[value.field]).filter(v=>v!==null&&v!==undefined),numbers=values.map(Number);
      const sum=()=>numbers.reduce((a,b)=>a+b,0);
      if(value.aggFunc==='count')row[value.field]=values.length;
      else if(value.aggFunc==='min')row[value.field]=Math.min(...numbers);
      else if(value.aggFunc==='max')row[value.field]=Math.max(...numbers);
      else if(value.aggFunc==='avg')row[value.field]=sum()/numbers.length;
      else row[value.field]=sum(); // Official fallback; adapter must prevent unsupported operators.
     }
     return row;
    });
   }
   for(const sort of [...(body.sortModel??[])].reverse())result.sort((a,b)=>{const left=a[sort.colId],right=b[sort.colId];return (left<right?-1:left>right?1:0)*(sort.sort==='desc'?-1:1);});
   const response={rowData:result.slice(body.startRow,body.endRow),rowCount:result.length};
   if(url.searchParams.get('count')==='unknown')delete response.rowCount;
   if(url.searchParams.get('count')==='estimated')response.rowCount={kind:'estimated',value:result.length};
   if(url.searchParams.get('error')==='true'){send(503,{detail:'fixture unavailable'});return;}
   send(200,response);
  }catch{send(400,{detail:'invalid SSRM request'});}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {url:`http://127.0.0.1:${server.address().port}`,calls,close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const fixture=await createSsrmFixtureServer({port:Number(process.env.SSRM_FIXTURE_PORT??4178)});
 process.stdout.write(`${fixture.url}\n`);
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void fixture.close().then(()=>process.exit(0));});
}
