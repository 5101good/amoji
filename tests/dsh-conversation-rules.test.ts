import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers/dsh-correlated.js';
export async function hooks(c:any,ref:any){
 let d=await c.createPackDraft([ref]);const text=(v:string)=>Object.fromEntries(d.manifest.locales.map((l:string)=>[l,v]));
 const effects=[...['answer-first','concise','example-first'].map(layout=>({template:'response-organization@1',config:{layout}})),{template:'completion-self-check@1',config:{evidence:'required',unknowns:'explicit'}}].map(x=>({...x,effect_id:randomUUID(),effect_revision_id:randomUUID(),kind:'template',title:text('当前会话文字指导'),summary:text('当前会话文字指导')}));
 d=await c.savePackDraft(d.draft_id,d.version,{...d.manifest,effects});const pack=await c.confirmPackDraft(d.draft_id,d.version);
 return effects.map(a=>({release_id:pack.release_id,effect_id:a.effect_id,effect_revision_id:a.effect_revision_id}));
}
const own=(choices:any[],release:string)=>choices.filter((c:any)=>c.selection.release_id===release);
test('规则公开RPC仅显式启用，精确来源、CAS明确替换与逐条全部停用',async t=>{
 const f=await fixture(t);const choices=await hooks(f.c,f.ref);
 const read=()=>f.call('collaboration.rules',{}) as Promise<any>;
 let state=await read();assert.equal(state.generation,0);assert.equal(own(state.choices,choices[0]!.release_id).length,4);assert.equal(state.rules.length,0);
 state=await f.call('collaboration.enable',{selection:choices[0],generation:0,replace:null});
 assert.equal(state.rules[0].status,'configured');assert.equal(state.rules[0].source.release_id,choices[0]!.release_id);
 await assert.rejects(f.call('collaboration.enable',{selection:choices[1],generation:0,replace:choices[0]}),/RULE_STALE/);
 await assert.rejects(f.call('collaboration.enable',{selection:choices[1],generation:1,replace:null}),/RULE_CONFLICT/);
 state=await f.call('collaboration.enable',{selection:choices[1],generation:1,replace:choices[0]});
 state=await f.call('collaboration.enable',{selection:choices[3],generation:state.generation,replace:null});
 assert.equal(state.rules.filter((r:any)=>r.enabled).length,2);
 state=await f.call('collaboration.disable',{selection:choices[1],generation:state.generation});assert.equal(state.rules.find((r:any)=>r.selection.effect_id===choices[1]!.effect_id).status,'disabled');
 state=await f.call('collaboration.disableAll',{generation:state.generation});assert.ok(state.rules.every((r:any)=>r.status==='disabled'));assert.equal(f.host.provider.requests.length,0);
});

import { input, textResponse } from './helpers/dsh-native.js';
import { DshCollaboration } from '../src/dsh/collaboration.js';
import { DshAdapter } from '../src/dsh/host.js';
import { collaborationEnvelope } from '../src/dsh/collaboration-context.js';
function snapshots(agent:any){return agent.session.snapshotEvents().flatMap((e:any)=>e.type==='user/message'&&e.data.source.kind==='plugin'?(e.data.source.sections??[]).filter((s:any)=>s.name==='amoji:collaboration').map((s:any)=>JSON.parse(s.text)):[]);}
test('真实driver：三种layout、完成自检、刷新恢复、逐条停用不增加请求',async t=>{
 const f=await fixture(t);const choices=await hooks(f.c,f.ref);let generation=0;
 for(const [index,phrase] of ['先回答结论','简洁作答','先给具体示例'].entries()){
  const state:any=await f.call('collaboration.enable',{selection:choices[index],generation,replace:index?choices[index-1]:null});generation=state.generation;
  f.live.followup(input('layout-'+index));await f.live.whenIdle();assert.equal(f.host.provider.requests.length,index+1);assert.match(JSON.stringify(snapshots(f.live).at(-1)),new RegExp(phrase));
  const view:any=await f.call('collaboration.rules',{});assert.equal(view.rules[0].status,'attached');
 }
 let state:any=await f.call('collaboration.enable',{selection:choices[3],generation,replace:null});
 f.bridge.dispose();const bridge=new DshCollaboration(f.host.ctx,f.runtime,'profile');t.after(()=>bridge.dispose());const adapter=new DshAdapter(f.ctx,f.runtime,'profile',bridge);
 f.live.followup(input('refresh'));await f.live.whenIdle();assert.equal(f.host.provider.requests.length,4);assert.equal(snapshots(f.live).at(-1).rules.length,2);assert.match(JSON.stringify(snapshots(f.live).at(-1)),/完成前检查已有证据/);assert.match(JSON.stringify(snapshots(f.live).at(-1)),/最终报告列明已完成、证据、未完成或不确定事项/);assert.match(JSON.stringify(snapshots(f.live).at(-1)),/final report must list completed work, evidence, incomplete work and uncertainties/);
 state=await adapter.rpc('amoji/collaboration.disableAll',{sessionId:'session',generation:state.generation},new AbortController().signal);
 assert.equal(f.host.provider.requests.length,4);f.live.followup(input('disabled'));await f.live.whenIdle();assert.equal(f.host.provider.requests.length,5);assert.equal(snapshots(f.live).at(-1).rules.length,0);assert.match(snapshots(f.live).at(-1).state,/已停用/);
});
test('真实driver：一次性同组覆盖一回合，下一输入恢复持续偏好',async t=>{
 const f=await fixture(t);const choices=await hooks(f.c,f.ref);await f.call('collaboration.enable',{selection:choices[0],generation:0,replace:null});
 let d=await f.c.createPackDraft([f.ref]);const text=(v:string)=>Object.fromEntries(d.manifest.locales.map(l=>[l,v]));const effect={effect_id:randomUUID(),effect_revision_id:randomUUID(),kind:'context' as const,title:text('一次性简短'),summary:text('一次性简短'),conflict_group:'response-organization' as const,instruction:text('ONLY THIS TURN')};
 d=await f.c.savePackDraft(d.draft_id,d.version,{...d.manifest,effects:[effect],bindings:[{target:f.ref,effects:[effect.effect_id]}]});const pack=await f.c.confirmPackDraft(d.draft_id,d.version);
 await f.apply({ref:f.ref,requestId:'once',effect:{release_id:pack.release_id,effect_id:effect.effect_id,effect_revision_id:effect.effect_revision_id}});await f.live.whenIdle();assert.equal(snapshots(f.live).at(-1).rules.length,0);assert.equal(snapshots(f.live).at(-1).instruction.instruction,'ONLY THIS TURN');
 f.live.followup(input('next'));await f.live.whenIdle();assert.equal(f.host.provider.requests.length,2);assert.equal(snapshots(f.live).at(-1).rules.length,1);assert.equal(snapshots(f.live).at(-1).instruction,null);
});
test('真实driver：两个模板工具续答停用、自然结束不追加请求，取消不报附加',async t=>{
 for(const index of [0,3]){
  const f=await fixture(t);const choices=await hooks(f.c,f.ref);const state:any=await f.call('collaboration.enable',{selection:choices[index],generation:0,replace:null});
  f.host.ctx.tools.register({name:'stop_rule',description:'disable rule',parameters:{type:'object',properties:{}},output:{schema:{type:'string'},render:()=>[{type:'text',text:'done'}]},execute:async()=>{await f.call('collaboration.disableAll',{generation:state.generation});return 'done';}});
  f.host.provider.respond=async function*(_r,n){if(n!==1){yield* textResponse();return;}yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'tool-call-delta',index:0,id:'stop' as never,name:'stop_rule',argumentsDelta:'{}'};yield{type:'block-end',index:0,block:{type:'tool-call',id:'stop' as never,name:'stop_rule',arguments:'{}'}};yield{type:'finish',reason:{kind:'tool-calls'}};};
  f.live.followup(input('tools'));await f.live.whenIdle();assert.equal(f.host.provider.requests.length,2);assert.equal(snapshots(f.live).at(-1).rules.length,0);
 }
 for(const index of [0,3]){
  const f=await fixture(t);const choices=await hooks(f.c,f.ref);await f.call('collaboration.enable',{selection:choices[index],generation:0,replace:null});
  const cancel=f.host.ctx.on('agent/request',async(p,next)=>{const c=await next();p.agent.cancel({kind:'user'} as never);return c;});
  f.live.followup(input('cancel'));await f.live.whenIdle();assert.equal(f.host.provider.requests.length,0);const view:any=await f.call('collaboration.rules',{});assert.notEqual(view.rules[0].status,'attached');cancel();
 }
});
test('规则预算拒绝完整envelope超8KiB，读取/编译p95不超过50ms',async t=>{
 const f=await fixture(t);const choices=await hooks(f.c,f.ref);await f.call('collaboration.enable',{selection:choices[0],generation:0,replace:null});
 assert.throws(()=>collaborationEnvelope('profile','session',1,[{id:'x'.repeat(8200),revision:'r',template:'response-organization@1',config:{layout:'concise'}}]),/8 KiB/);
 const measurements:number[]=[];for(let i=0;i<120;i++){const start=performance.now();await f.call('collaboration.rules',{});measurements.push(performance.now()-start);}measurements.sort((a,b)=>a-b);const p95=measurements[Math.ceil(measurements.length*.95)-1]!;
 console.log(JSON.stringify({measurement:'public RPC rule read and compile',samples:120,p95_ms:p95,node:process.version,platform:process.platform,arch:process.arch,CPU:(await import('node:os')).cpus()[0]?.model,provider:'recording, no network'}));assert.ok(p95<=50,`p95=${p95}`);
});

test('停用后插件重载必须在下一真实输入覆盖旧快照，不唤醒额外请求',async t=>{
 const f=await fixture(t);const choices=await hooks(f.c,f.ref);let state:any=await f.call('collaboration.enable',{selection:choices[0],generation:0,replace:null});
 f.live.followup(input('active'));await f.live.whenIdle();await f.call('collaboration.disableAll',{generation:state.generation});f.bridge.dispose();
 const bridge=new DshCollaboration(f.host.ctx,f.runtime,'profile');t.after(()=>bridge.dispose());f.live.followup(input('after-reload'));await f.live.whenIdle();
 assert.equal(f.host.provider.requests.length,2);assert.equal(snapshots(f.live).at(-1).rules.length,0);assert.match(snapshots(f.live).at(-1).state,/已停用/);
});

test('公开存储更新/移除停用精确版本；浏览、AI发送和安装不授权',async t=>{
 const f=await fixture(t);const choices=await hooks(f.c,f.ref);await f.call('collaboration.enable',{selection:choices[0],generation:0,replace:null});
 const {exportManifest}=await import('../src/packs.js');const {readFile}=await import('node:fs/promises');const original=await f.c.getPack(choices[0]!.release_id);
 const pack={...original,release_id:randomUUID(),version:2,effects:original.effects!.map(a=>({...a,effect_revision_id:randomUUID()}))};
 const bytes=await exportManifest(pack,async b=>readFile(await f.c.blobPath(b.sha256)));await f.c.importPack(bytes);
 let state:any=await f.call('collaboration.rules',{});assert.equal(state.rules[0].enabled,false);assert.equal(state.rules[0].reason,'source-unavailable');assert.equal(state.rules[0].selection.release_id,original.release_id);
 const newChoice=state.choices.find((r:any)=>r.selection.release_id===pack.release_id);
 state=await f.call('collaboration.enable',{selection:newChoice.selection,generation:state.generation,replace:null});
 await f.c.removePack(pack.release_id);state=await f.call('collaboration.rules',{});assert.ok(state.rules.every((r:any)=>!r.enabled));assert.equal(own(state.choices,pack.release_id).length+own(state.choices,original.release_id).length,0);assert.equal(f.host.provider.requests.length,0);
 assert.ok((await f.c.list()).some(e=>e.asset_id===f.ref.asset_id),'removal preserves independent local expressions');
 const binding=await f.c.bind({host:'dsh',hostInstanceId:'profile',sessionId:'other',turnId:'turn:1'});assert.equal((await f.c.rules(binding)).rules.length,0);
 const candidates=await f.c.search(binding,'庆祝',1);assert.equal((await f.c.express(binding,{selection_token:candidates.candidates[0]!.selection_token})).status,'sent');
 assert.equal((await f.c.rules(binding)).rules.length,0);
});
test('真实driver：完成尾部修改两模板不延长回合；suppression如实unsupported',async t=>{
 for(const suppressed of [false,true]){
 const f=await fixture(t,suppressed);const choices=await hooks(f.c,f.ref);let state:any=await f.call('collaboration.enable',{selection:choices[0],generation:0,replace:null});state=await f.call('collaboration.enable',{selection:choices[3],generation:state.generation,replace:null});
 if(!suppressed)f.host.ctx.on('agent/turn-stopping',async()=>{const v:any=await f.call('collaboration.rules',{});await f.call('collaboration.disableAll',{generation:v.generation});});
 f.live.followup(input('finish'));await f.live.whenIdle();assert.equal(f.host.provider.requests.length,1);
 if(suppressed){const v:any=await f.call('collaboration.rules',{});assert.ok(v.rules.every((r:any)=>r.status==='unsupported'));assert.equal(snapshots(f.live).length,0);}
 else{f.live.followup(input('next'));await f.live.whenIdle();assert.equal(f.host.provider.requests.length,2);assert.equal(snapshots(f.live).at(-1).rules.length,0);}
 }
});
test('会话/profile隔离与fork/import不继承规则；超限启用被拒绝',async t=>{
 const f=await fixture(t);const choices=await hooks(f.c,f.ref);await f.call('collaboration.enable',{selection:choices[0],generation:0,replace:null});f.live.followup(input('active'));await f.live.whenIdle();
 // Snapshot persisted after a real native event anchors same-ID history replacement.
 let state:any=await f.call('collaboration.rules',{});await f.call('collaboration.enable',{selection:choices[3],generation:state.generation,replace:null});
 const {SessionId,SessionLogOffset}=await import('@deepseek-ai/dsh-session/types');const seed=f.live.session.snapshotEvents();
 const fork=(await f.host.ctx.agents.create({sessionId:SessionId('forked'),seed,meta:{parentSession:SessionId('session'),isSeeded:true},inheritedEventCount:SessionLogOffset(seed.length),agentOptions:{provider:'amoji-recording',model:'no-network-no-cost'}})).agent;
 const imported=(await f.host.ctx.agents.create({sessionId:SessionId('imported'),seed,agentOptions:{provider:'amoji-recording',model:'no-network-no-cost'}})).agent;
 const other=(await f.host.create('other')).agent;for(const a of [fork,imported,other]){assert.equal((await f.bridge.rules(a.id)).rules.length,0);a.followup(input('new'));await a.whenIdle();assert.equal(snapshots(a).filter((s:any)=>s.scope.session===a.id).length,0);}
 const foreign=new DshCollaboration(f.host.ctx,f.runtime,'other-profile');t.after(()=>foreign.dispose());assert.equal((await foreign.rules('session')).rules.length,0);
 const temp=await (await import('./helpers/dsh-native.js')).nativeHost();const br=new DshCollaboration(temp.ctx,f.runtime,'\u0001'.repeat(1024));t.after(async()=>{br.dispose();await temp.close();});const huge=(await temp.create('\u0001'.repeat(500))).agent;await assert.rejects(br.change(huge.id,{kind:'enable',selection:choices[0],generation:0,replace:null}),/EFFECT_LIMIT/);assert.equal((await br.rules(huge.id)).rules.length,0);
});
test('真实JSONL冷启动恢复UUID规则；复制profile与同ID清空历史不继承',async t=>{
 const f=await fixture(t);const choices=await hooks(f.c,f.ref);const {join}=await import('node:path');const {cp,rm}=await import('node:fs/promises');const {loadProfileIdentity}=await import('../src/dsh/profile-identity.js');const {nativeHost}=await import('./helpers/dsh-native.js');const {SessionId}=await import('@deepseek-ai/dsh-session/types');
 const path=join(f.directory,'identity');const identity=await loadProfileIdentity(path);f.bridge.dispose();const original=new DshCollaboration(f.host.ctx,f.runtime,identity.id);
 await original.change('session',{kind:'enable',selection:choices[0],generation:0,replace:null});f.live.followup(input('first'));await f.live.whenIdle();let state=await original.rules('session');await original.change('session',{kind:'enable',selection:choices[3],generation:state.generation,replace:null});await f.host.ctx.sessions.flush(f.live.session);original.dispose();await f.host.close();
 assert.equal((await loadProfileIdentity(path)).id,identity.id);await cp(path,path+'-copy',{recursive:true});const copied=await loadProfileIdentity(path+'-copy');assert.notEqual(copied.id,identity.id);
 const resumed=await nativeHost(true,join(f.directory,'native'));t.after(()=>resumed.close());const live=(await resumed.ctx.agents.resume({resumeSessionId:SessionId('session'),agentOptions:{provider:'amoji-recording',model:'no-network-no-cost'}})).agent;
 const restored=new DshCollaboration(resumed.ctx,f.runtime,identity.id);t.after(()=>restored.dispose());state=await restored.rules('session');assert.equal(state.identity,'ready');assert.equal(state.rules.filter(r=>r.enabled).length,2);live.followup(input('cold'));await live.whenIdle();assert.equal(resumed.provider.requests.length,1);assert.equal(snapshots(live).at(-1).rules.length,2);
 const foreign=new DshCollaboration(resumed.ctx,f.runtime,copied.id);assert.equal((await foreign.rules('session')).rules.length,0);foreign.dispose();
 const cleared=await nativeHost();t.after(()=>cleared.close());const empty=(await cleared.create('session')).agent;const isolated=new DshCollaboration(cleared.ctx,f.runtime,identity.id);t.after(()=>isolated.dispose());const pending=await isolated.rules('session');assert.equal(pending.identity,'pending');assert.ok(pending.rules.every(r=>r.status==='unsupported'));
 await assert.rejects(isolated.change('session',{kind:'disable',selection:choices[0],generation:pending.generation}),/RULE_IDENTITY/);empty.followup(input('empty'));await empty.whenIdle();assert.equal(snapshots(empty).length,0);
 await isolated.change('session',{kind:'disableAll',generation:pending.generation});assert.equal((await isolated.rules('session')).identity,'ready');await rm(path+'-copy',{recursive:true,force:true});
});

test('fork/import不继承，但当前会话新的显式授权可用并可冷恢复',async t=>{
 const f=await fixture(t);const choices=await hooks(f.c,f.ref);const {SessionId,SessionLogOffset}=await import('@deepseek-ai/dsh-session/types');const {nativeHost}=await import('./helpers/dsh-native.js');const {join}=await import('node:path');
 f.live.followup(input('parent'));await f.live.whenIdle();const seed=f.live.session.snapshotEvents();
 const fork=(await f.host.ctx.agents.create({sessionId:SessionId('new-fork'),seed,meta:{parentSession:SessionId('session'),isSeeded:true},inheritedEventCount:SessionLogOffset(seed.length),agentOptions:{provider:'amoji-recording',model:'no-network-no-cost'}})).agent;
 const imported=(await f.host.ctx.agents.create({sessionId:SessionId('new-import'),seed,agentOptions:{provider:'amoji-recording',model:'no-network-no-cost'}})).agent;
 for(const agent of [fork,imported]){assert.equal((await f.bridge.rules(agent.id)).rules.length,0);const view=await f.bridge.change(agent.id,{kind:'enable',selection:choices[0],generation:0,replace:null});assert.equal(view.identity,'ready');assert.equal(view.rules[0]?.status,'configured');agent.followup(input('consented'));await agent.whenIdle();assert.equal(snapshots(agent).at(-1).scope.session,agent.id);assert.equal(snapshots(agent).at(-1).rules.length,1);await f.host.ctx.sessions.flush(agent.session);}
 f.bridge.dispose();await f.host.close();const host=await nativeHost(true,join(f.directory,'native'));t.after(()=>host.close());const bridge=new DshCollaboration(host.ctx,f.runtime,'profile');t.after(()=>bridge.dispose());
 for(const id of ['new-fork','new-import']){const live=(await host.ctx.agents.resume({resumeSessionId:SessionId(id),agentOptions:{provider:'amoji-recording',model:'no-network-no-cost'}})).agent;assert.equal((await bridge.rules(id)).identity,'ready');live.followup(input('after-cold'));await live.whenIdle();assert.equal(snapshots(live).at(-1).rules.length,1);}assert.equal(host.provider.requests.length,2);
});
