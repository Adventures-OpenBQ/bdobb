// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {discoverMcpTools,callMcpTool} from '../../lib/agent/mcp';
import {executeFunction,runAgentTool} from '../../lib/agent/execute';
import {runAgentQuery} from '../../lib/agent/query';
import type {AgentMessage} from '../../lib/agent/types';

// Needs the private NAS Rita discovery file; CI has none, so it skips there unless TEMPORALDB_MCP_REQUIRED=1 makes a missing prerequisite fail.
it.skipIf(!process.env.TEMPORALDB_MCP_REQUIRED&&!process.env.TEMPORALDB_RITA_DISCOVERY)('real configured Rita uses bdobb tool dispatch and returns the installed execution receipt',async()=>{
  const discoveryPath=process.env.TEMPORALDB_RITA_DISCOVERY;
  if(!discoveryPath)throw new Error('TEMPORALDB_MCP_REQUIRED=1 but TEMPORALDB_RITA_DISCOVERY not set');
  const discovery=JSON.parse(await readFile(discoveryPath!,'utf8'));
  const ritaUrl=discovery.url.replace(/\/agents\.json\/?$/,'');
  const url=process.env.TEMPORALDB_MCP_URL!+'/mcp';
  const headers={Authorization:'Bearer '+process.env.TEMPORALDB_MCP_TOKEN,Host:'mcp.fixture.test'};
  const proof=JSON.parse(await readFile(process.env.TEMPORALDB_MCP_PROTOCOL!,'utf8'));
  const path=join(dirname(process.env.TEMPORALDB_MCP_PROTOCOL!),'rita.json');
  const calls:Array<{tool:string;args:Record<string,unknown>;result:unknown}>=[];
  let status='FAILED';let reason='';let history:AgentMessage[]=[];let chunks='';
  try {
    const tools=await discoverMcpTools('temporaldb',url,fetch,headers);
    const gen=runAgentQuery({ritaUrl,refresh:()=>({primary:[]}),tools,
      messages:[{role:'human',content:`Use execute_agent_tool on server temporaldb, tool get_query_result, parameters {"execution_id":"${proof.execution_id}"}. This is a completed synthetic fixture query. Call exactly once and report its query revision, first row close and volume exactly as strings. Do not use any other tools or data sources.`}],
      executeFunction:(payload,signal)=>executeFunction(payload,{fetchWidget:async()=>{throw new Error("widget access outside synthetic receipt scope");},
        runAgentTool:(serverId,tool,args,signal)=>runAgentTool(serverId,tool,args,[{id:'temporaldb',url,enabled:true}],[],
          async(_server,endpoint,name,parameters,abort)=>{
            // Scope the real conversation to the explicitly authorized synthetic receipt.
            expect(name).toBe('get_query_result');expect(parameters.execution_id).toBe(proof.execution_id);
            const result=await callMcpTool(endpoint,name,parameters,fetch,headers,abort);
            calls.push({tool:name,args:parameters,result});return result;
          },{signal,confirm:async()=>true})},signal),timeoutMs:90000});
    for (;;) {const next=await gen.next();if(next.done){history=next.value;break;}const event=next.value as {type?:string;delta?:string};if(event.type==='chunk')chunks+=event.delta??'';}
    expect(calls).toHaveLength(1);
    const result=calls[0].result as {content:Array<{text:string}>};
    const receipt=JSON.parse(result.content[0].text);
    expect(receipt.state).toBe('succeeded');expect(receipt.page.rows[0].volume).toBe('9007199254740993');
    expect(history.some(message=>message.role==='tool')).toBe(true);
    expect(chunks).toContain('9007199254740993');status='PASS';
  } catch(error) {reason=error instanceof Error ? error.message : String(error);throw error;}
  finally {await writeFile(path,JSON.stringify({status,reason,calls,history,chunks,scope:'synthetic completed receipt only; real runAgentQuery/executeFunction/runAgentTool/MCP'},null,2));}
},120000);
