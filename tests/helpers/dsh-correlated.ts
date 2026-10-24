import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {nativeHost,input} from './dsh-native.js';
import {SharedClient,stopSharedService} from '../../src/shared-client.js';
import {ConnectedRuntime} from '../../src/adapter-runtime.js';
import {DshAdapter} from '../../src/dsh/host.js';
import {DshCollaboration} from '../../src/dsh/collaboration.js';
import type {HostPort} from '../../src/dsh/contracts.js';
import type {EffectSelection} from '../../src/effects.js';
export async function fixture(t:any,suppressed=false,existingDirectory?:string){
 const directory=existingDirectory??await mkdtemp(join(tmpdir(),'amoji-correlated-'));const host=await nativeHost(!suppressed,join(directory,'native'));const c=await SharedClient.connect({directory:join(directory,'library')});
 const runtime=new ConnectedRuntime(c);const live=(await host.create('session')).agent; const disposers:Array<()=>unknown>=[];
 const ctx={sessions:host.ctx.sessions,sessionProjections:host.ctx.sessionProjections,tools:host.ctx.tools,connection:{fetch:{register:()=>async()=>{}}},effect:(f:()=>()=>unknown)=>disposers.push(f()),sessionController:{resolveAgent:async()=>({agent:live}),inspect:async()=>({events:live.session.snapshotEvents()}),prompt:async(r:any)=>{live.followup(input(r.requestId,r.content[0].text));return{accepted:true};}}} as unknown as HostPort;
 const bridge=new DshCollaboration(host.ctx,runtime,'profile');const adapter=new DshAdapter(ctx,runtime,'profile',bridge);
 t.after(async()=>{bridge.dispose();for(const d of disposers)await d();await host.close();await c.close();await stopSharedService(join(directory,'library'),c.identity.serviceId);await rm(directory,{recursive:true,force:true});});
 const e=(await c.list())[0]!;const ref={asset_id:e.asset_id,revision_id:e.revision_id};let d=await c.createPackDraft([ref]);
 const text=(v:string)=>Object.fromEntries(d.manifest.locales.map(l=>[l,v]));
 const a={effect_id:randomUUID(),effect_revision_id:randomUUID(),kind:'context' as const,conflict_group:'explanation' as const,title:text('解释一次'),summary:text('解释一次'),instruction:text('EXACT {{literal}} ACTION')};
 d=await c.savePackDraft(d.draft_id,d.version,{...d.manifest,effects:[a],bindings:[{target:ref,effects:[a.effect_id]}]});const pack=await c.confirmPackDraft(d.draft_id,d.version);
 const effect:EffectSelection={release_id:pack.release_id,effect_id:a.effect_id,effect_revision_id:a.effect_revision_id};
 const call=(method:string,args:any)=>adapter.rpc('amoji/'+method,{sessionId:'session',...args},new AbortController().signal);
 const apply=(args:{ref:typeof ref;requestId:string;effect:EffectSelection})=>call('submit',{input:{ref:args.ref,effect:args.effect},requestId:args.requestId});
 return {apply,directory,host,c,runtime,live,ctx,bridge,adapter,ref,effect,call};
}
