import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {nativeHost,input} from './helpers/dsh-native.js';
import {SharedClient,stopSharedService} from '../src/shared-client.js';
import {ConnectedRuntime} from '../src/adapter-runtime.js';
import {DshAdapter} from '../src/dsh/host.js';
import {DshCollaboration} from '../src/dsh/collaboration.js';
import type {HostPort,HistoryEntry} from '../src/dsh/contracts.js';
import {fixture} from './helpers/dsh-correlated.js';
test('生产发送链路：真实领取、单回合literal上下文、原生日志回执、重复请求无额外推理',async t=>{
 const f=await fixture(t); const row=await f.apply({ref:f.ref,requestId:'apply',effect:f.effect}) as HistoryEntry;await f.live.whenIdle();
 const settled=(await f.call('history',{}) as HistoryEntry[])[0]!;assert.equal(settled.effect?.status,'attached');assert.ok(settled.effect?.digest);assert.ok(JSON.stringify(f.host.provider.requests[0]).includes('EXACT {{literal}} ACTION'));
 assert.ok(JSON.stringify(f.host.provider.requests[0]).includes(f.effect.release_id));assert.ok(f.host.provider.requests[0]!.messages.filter(m=>m.role==='system').every(m=>!JSON.stringify(m).includes('EXACT')));
 assert.equal((await f.apply({ref:f.ref,requestId:'apply',effect:f.effect}) as HistoryEntry).message.message_id,row.message.message_id);assert.equal(f.host.provider.requests.length,1);
 await assert.rejects(f.call('submit',{input:{ref:f.ref},requestId:'apply'}),/REQUEST_CONFLICT/);
 await f.call('submit',{input:{ref:f.ref},requestId:'plain'});await f.live.whenIdle();assert.equal(f.host.provider.requests.length,2);assert.equal((await f.call('history',{}) as HistoryEntry[])[1]!.effect,undefined);
 f.bridge.dispose();const recovered=new DshCollaboration(f.host.ctx,f.runtime,'profile');const adapter=new DshAdapter(f.ctx,f.runtime,'profile',recovered);
 assert.equal((await adapter.rpc('amoji/history',{sessionId:'session'},new AbortController().signal) as HistoryEntry[])[0]!.effect?.status,'attached');assert.equal(f.host.provider.requests.length,2);recovered.dispose();
});
test('生产链路 suppression 明确未应用，纯表达可独立发送',async t=>{const f=await fixture(t,true);await f.apply({ref:f.ref,requestId:'apply',effect:f.effect});await f.live.whenIdle();const row=(await f.call('history',{}) as HistoryEntry[])[0]!;assert.equal(row.effect?.status,'failed');assert.ok(row.effect?.reason);assert.equal(f.host.provider.requests.length,1);assert.ok(!JSON.stringify(f.host.provider.requests).includes('EXACT {{literal}} ACTION'));});
test('领取前取消持久化，重建适配器仍取消且后续输入不应用',async t=>{
 const f=await fixture(t);f.ctx.sessionController.prompt=async request=>{f.live.send(input(request.requestId),'next-turn',false);return{accepted:true};};
 await f.apply({ref:f.ref,requestId:'cancel',effect:f.effect});f.live.inbox.clear();await new Promise(r=>setTimeout(r,50));
 f.bridge.dispose();const restored=new DshCollaboration(f.host.ctx,f.runtime,'profile');const adapter=new DshAdapter(f.ctx,f.runtime,'profile',restored);
 const rows=await adapter.rpc('amoji/history',{sessionId:'session'},new AbortController().signal) as HistoryEntry[];assert.equal(rows[0]!.effect?.status,'cancelled');
 f.live.followup(input('ordinary'));await f.live.whenIdle();assert.ok(!JSON.stringify(f.host.provider.requests).includes('EXACT {{literal}} ACTION'));restored.dispose();
});
test('宿主未知结果核对原请求，不重发、不被另一输入领取',async t=>{
 const f=await fixture(t);let prompts=0;f.ctx.sessionController.prompt=async()=>{prompts++;throw Error('connection lost');};
 await assert.rejects(f.apply({ref:f.ref,requestId:'unknown',effect:f.effect}),/DSH_OUTCOME_UNKNOWN/);
 const retried=await f.apply({ref:f.ref,requestId:'unknown',effect:f.effect}) as HistoryEntry;assert.equal(retried.effect?.status,'unknown');assert.equal(prompts,1);
 f.live.followup(input('ordinary'));await f.live.whenIdle();assert.ok(!JSON.stringify(f.host.provider.requests).includes('EXACT {{literal}} ACTION'));
});
test('AI 工作时附带效果被拒绝，不留下记录也不被其他输入领取',async t=>{
 const f=await fixture(t);const {textResponse}=await import('./helpers/dsh-native.js');let release!:()=>void;const blocked=new Promise<void>(r=>release=r);let started!:()=>void;const ready=new Promise<void>(r=>started=r);
 f.host.provider.respond=async function*(_r,n){if(n===1){started();await blocked;}yield* textResponse();};
 f.live.followup(input('earlier'));await ready;
 try{await assert.rejects(f.apply({ref:f.ref,requestId:'during-work',effect:f.effect}),/EFFECT_UNAVAILABLE/);}finally{release();}
 await f.live.whenIdle();assert.equal((await f.call('history',{}) as HistoryEntry[]).length,0);assert.ok(!JSON.stringify(f.host.provider.requests).includes('EXACT {{literal}} ACTION'));
});
test('生产链路组装后移除关联输入不留下孤立动作或推理',async t=>{
 const f=await fixture(t);let first=true;f.host.ctx.on('agent/pre-step',async(_p,next)=>{const decision=await next();if(first&&decision.kind==='enter'){first=false;return{...decision,messages:decision.messages.filter(m=>m.source.kind!=='user')};}return decision;});
 await f.apply({ref:f.ref,requestId:'reject',effect:f.effect});await f.live.whenIdle();assert.equal(f.host.provider.requests.length,0);assert.equal((await f.call('history',{}) as HistoryEntry[])[0]!.effect?.status,'failed');f.live.followup(input('other'));await f.live.whenIdle();assert.ok(!JSON.stringify(f.host.provider.requests).includes('EXACT {{literal}} ACTION'));
});
test('生产链路真正进程退出后从SQLite与原生JSONL冷恢复，不自动重发',async t=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const {fileURLToPath}=await import('node:url');const {SessionId}=await import('@deepseek-ai/dsh-session/types');
 const directory=await mkdtemp(join(tmpdir(),'amoji-production-crash-'));
 await promisify(execFile)(process.execPath,['--import','tsx',fileURLToPath(new URL('./helpers/dsh-correlated-crash.ts',import.meta.url)),directory],{timeout:15000});
 const host=await nativeHost(true,join(directory,'native'));const c=await SharedClient.connect({directory:join(directory,'library')});const runtime=new ConnectedRuntime(c);const live=(await host.ctx.agents.resume({resumeSessionId:SessionId('session'),agentOptions:{provider:'amoji-recording',model:'no-network-no-cost'}})).agent;const bridge=new DshCollaboration(host.ctx,runtime,'profile');
 t.after(async()=>{bridge.dispose();await host.close();await c.close();await stopSharedService(join(directory,'library'),c.identity.serviceId);await rm(directory,{recursive:true,force:true});});
 const messages=await runtime.messages({host:'dsh',hostInstanceId:'profile',sessionId:'session'});assert.equal(messages.length,1);assert.equal((await bridge.receipt('session',messages[0]!))?.status,'unknown');assert.equal(host.provider.requests.length,0);
 live.followup(input('after-restart'));await live.whenIdle();assert.equal(host.provider.requests.length,1);assert.ok(!JSON.stringify(host.provider.requests).includes('EXACT {{literal}} ACTION'));
});
test('完整envelope超预算在持久发送前拒绝，状态核对不调用模型',async t=>{
 const f=await fixture(t);let d=await f.c.createPackDraft([f.ref]);const text=(v:string)=>Object.fromEntries(d.manifest.locales.map(l=>[l,v]));
 const a={effect_id:randomUUID(),effect_revision_id:randomUUID(),kind:'context' as const,conflict_group:'explanation' as const,title:text('控制字符预算'),summary:text('控制字符预算'),instruction:text('\u0001'.repeat(2048))};
 d=await f.c.savePackDraft(d.draft_id,d.version,{...d.manifest,effects:[a],bindings:[{target:f.ref,effects:[a.effect_id]}]});const pack=await f.c.confirmPackDraft(d.draft_id,d.version);
 await assert.rejects(f.apply({ref:f.ref,requestId:'oversize',effect:{release_id:pack.release_id,effect_id:a.effect_id,effect_revision_id:a.effect_revision_id}}),/EFFECT_LIMIT/);assert.equal((await f.call('history',{}) as HistoryEntry[]).length,0);assert.equal(f.host.provider.requests.length,0);
});
test('新profile保留原生日志证明的旧local表达读取，不迁移动作授权',async t=>{
 const f=await fixture(t);const binding=await f.c.bind({host:'dsh',hostInstanceId:'local',sessionId:'session'});const legacy=await f.c.receive(binding,{ref:f.ref},'legacy');f.live.followup(input(`amoji:${legacy.message_id}`));await f.live.whenIdle();const rows=await f.call('history',{}) as HistoryEntry[];assert.equal(rows.length,1);assert.equal(rows[0]!.message.message_id,legacy.message_id);assert.equal(rows[0]!.effect,undefined);
});
test('生产已提交回执在共享服务断连后仍可从原生日志恢复，核对不重发',async t=>{
 const f=await fixture(t);const {textResponse}=await import('./helpers/dsh-native.js');f.host.provider.respond=async function*(){await stopSharedService(join(f.directory,'library'),f.c.identity.serviceId);yield* textResponse();};
 try{await f.apply({ref:f.ref,requestId:'receipt-loss',effect:f.effect});}catch(error){assert.match(String(error),/DSH_OUTCOME_UNKNOWN|CONNECTION_CLOSED/);}
 await f.live.whenIdle();await f.c.reconnect();const rows=await f.call('history',{}) as HistoryEntry[];assert.equal(rows[0]!.effect?.status,'attached');assert.equal(f.host.provider.requests.length,1);
});
test('效果必须是所选表情的精确绑定修订，拒绝时不留下记录',async t=>{
 const f=await fixture(t);await assert.rejects(f.apply({ref:f.ref,requestId:'stale',effect:{...f.effect,effect_revision_id:randomUUID()}}),/EFFECT_UNAVAILABLE/);assert.equal((await f.call('history',{}) as HistoryEntry[]).length,0);
 const row=await f.apply({ref:f.ref,requestId:'explicit-effect',effect:f.effect}) as HistoryEntry;await f.live.whenIdle();assert.ok(row.effect);assert.equal((await f.call('history',{}) as HistoryEntry[])[0]!.effect?.status,'attached');assert.equal(f.host.provider.requests.length,1);
});
test('公开协作能力与回执接口支持重开后的独立核对',async t=>{
 const f=await fixture(t);const capabilities=await f.call('collaboration.capabilities',{}) as {supported:boolean};assert.equal(capabilities.supported,true);
 await f.apply({ref:f.ref,requestId:'receipts',effect:f.effect});await f.live.whenIdle();const rows=await f.call('collaboration.receipts',{}) as HistoryEntry[];assert.equal(rows[0]!.effect?.status,'attached');assert.equal(f.host.provider.requests.length,1);
});
