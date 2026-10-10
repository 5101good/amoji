import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {nativeHost,input} from './dsh-native.js';
import {SharedClient,stopSharedService} from '../../src/shared-client.js';
import {ConnectedRuntime} from '../../src/adapter-runtime.js';
import {DshAdapter} from '../../src/dsh/host.js';
import {DshCollaboration} from '../../src/dsh/collaboration.js';
import type {HostPort,HistoryEntry} from '../../src/dsh/contracts.js';
export async function fixture(t:any,suppressed=false,existingDirectory?:string){
 const directory=existingDirectory??await mkdtemp(join(tmpdir(),'amoji-correlated-'));const host=await nativeHost(!suppressed,join(directory,'native'));const c=await SharedClient.connect({directory:join(directory,'library')});
 const runtime=new ConnectedRuntime(c);const live=(await host.create('session')).agent; const disposers:Array<()=>unknown>=[];
 const ctx={sessions:host.ctx.sessions,sessionProjections:host.ctx.sessionProjections,tools:host.ctx.tools,connection:{fetch:{register:()=>async()=>{}}},effect:(f:()=>()=>unknown)=>disposers.push(f()),sessionController:{resolveAgent:async()=>({agent:live}),inspect:async()=>({events:live.session.snapshotEvents()}),prompt:async(r:any)=>{live.followup(input(r.requestId,r.content[0].text));return{accepted:true};}}} as unknown as HostPort;
 const bridge=new DshCollaboration(host.ctx,runtime,'profile');const adapter=new DshAdapter(ctx,runtime,'profile',bridge);
 t.after(async()=>{bridge.dispose();for(const d of disposers)await d();await host.close();await c.close();await stopSharedService(join(directory,'library'),c.identity.serviceId);await rm(directory,{recursive:true,force:true});});
 const e=(await c.list())[0]!;const ref={asset_id:e.asset_id,revision_id:e.revision_id};let d=await c.createScenarioDraft([ref]); const a={action_id:randomUUID(),action_revision_id:randomUUID(),kind:'instruction' as const,scope:'turn' as const,locale:'zh-CN',effect_summary:'解释一次',conflict_group:'explanation' as const,instruction:'EXACT {{literal}} ACTION',rights:{license:'CC0-1.0'}};
 d=await c.saveScenarioDraft(d.draft_id,d.version,{...d.manifest,actions:[a],bindings:[{expression:ref,actions:[{action_id:a.action_id,action_revision_id:a.action_revision_id}]}]});await c.confirmScenarioDraft(d.draft_id,d.version);
 const apply=(args:any)=>adapter.rpc('amoji/submitWithAction',{sessionId:'session',ref:args.ref,requestId:args.requestId,actionRef:{action_id:args.action.action_id,action_revision_id:args.action.action_revision_id},releaseRef:{release_id:args.action.release_id}},new AbortController().signal);
 return {apply,directory,host,c,runtime,live,ctx,bridge,adapter,ref,action:{release_id:d.manifest.release_id,action_id:a.action_id,action_revision_id:a.action_revision_id},call:(method:string,args:any)=>adapter.rpc('amoji/'+method,{sessionId:'session',...args},new AbortController().signal)};
}
