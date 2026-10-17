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
 const f=await fixture(t); const row=await f.apply({ref:f.ref,requestId:'apply',action:f.action}) as HistoryEntry;await f.live.whenIdle();
 const settled=(await f.call('history',{}) as HistoryEntry[])[0]!;assert.equal(settled.action?.status,'attached');assert.ok(settled.action?.digest);assert.ok(JSON.stringify(f.host.provider.requests[0]).includes('EXACT {{literal}} ACTION'));
 assert.ok(JSON.stringify(f.host.provider.requests[0]).includes(f.action.release_id));assert.ok(f.host.provider.requests[0]!.messages.filter(m=>m.role==='system').every(m=>!JSON.stringify(m).includes('EXACT')));
 assert.equal((await f.apply({ref:f.ref,requestId:'apply',action:f.action}) as HistoryEntry).message.message_id,row.message.message_id);assert.equal(f.host.provider.requests.length,1);
 await assert.rejects(f.call('submit',{ref:f.ref,requestId:'apply'}),/REQUEST_CONFLICT/);
 await f.call('submit',{ref:f.ref,requestId:'plain'});await f.live.whenIdle();assert.equal(f.host.provider.requests.length,2);assert.equal((await f.call('history',{}) as HistoryEntry[])[1]!.action,undefined);
 f.bridge.dispose();const recovered=new DshCollaboration(f.host.ctx,f.runtime,'profile');const adapter=new DshAdapter(f.ctx,f.runtime,'profile',recovered);
 assert.equal((await adapter.rpc('amoji/history',{sessionId:'session'},new AbortController().signal) as HistoryEntry[])[0]!.action?.status,'attached');assert.equal(f.host.provider.requests.length,2);recovered.dispose();
});
test('生产链路 suppression 明确未应用，纯表达可独立发送',async t=>{const f=await fixture(t,true);await f.apply({ref:f.ref,requestId:'apply',action:f.action});await f.live.whenIdle();const row=(await f.call('history',{}) as HistoryEntry[])[0]!;assert.equal(row.action?.status,'failed');assert.ok(row.action?.reason);assert.equal(f.host.provider.requests.length,1);assert.ok(!JSON.stringify(f.host.provider.requests).includes('EXACT {{literal}} ACTION'));});
test('领取前取消持久化，重建适配器仍取消且后续输入不应用',async t=>{
 const f=await fixture(t);f.ctx.sessionController.prompt=async request=>{f.live.send(input(request.requestId),'next-turn',false);return{accepted:true};};
 await f.apply({ref:f.ref,requestId:'cancel',action:f.action});f.live.inbox.clear();await new Promise(r=>setTimeout(r,50));
 f.bridge.dispose();const restored=new DshCollaboration(f.host.ctx,f.runtime,'profile');const adapter=new DshAdapter(f.ctx,f.runtime,'profile',restored);
 const rows=await adapter.rpc('amoji/history',{sessionId:'session'},new AbortController().signal) as HistoryEntry[];assert.equal(rows[0]!.action?.status,'cancelled');
 f.live.followup(input('ordinary'));await f.live.whenIdle();assert.ok(!JSON.stringify(f.host.provider.requests).includes('EXACT {{literal}} ACTION'));restored.dispose();
});
test('宿主未知结果核对原请求，不重发、不被另一输入领取',async t=>{
 const f=await fixture(t);let prompts=0;f.ctx.sessionController.prompt=async()=>{prompts++;throw Error('connection lost');};
 await assert.rejects(f.apply({ref:f.ref,requestId:'unknown',action:f.action}),/DSH_OUTCOME_UNKNOWN/);
 const retried=await f.apply({ref:f.ref,requestId:'unknown',action:f.action}) as HistoryEntry;assert.equal(retried.action?.status,'unknown');assert.equal(prompts,1);
 f.live.followup(input('ordinary'));await f.live.whenIdle();assert.ok(!JSON.stringify(f.host.provider.requests).includes('EXACT {{literal}} ACTION'));
});
test('生产链路运行中排队，其他rpcId先领取不会消费动作',async t=>{
 const f=await fixture(t);const {textResponse}=await import('./helpers/dsh-native.js');let release!:()=>void;const blocked=new Promise<void>(r=>release=r);let started!:()=>void;const ready=new Promise<void>(r=>started=r);
 f.host.provider.respond=async function*(_r,n){if(n===1){started();await blocked;}yield* textResponse();};
 f.live.followup(input('earlier'));await ready;const queued=await f.apply({ref:f.ref,requestId:'queued',action:f.action}) as HistoryEntry;assert.equal(queued.action?.status,'dispatched');assert.ok(!JSON.stringify(f.host.provider.requests[0]).includes('EXACT'));
 release();await f.live.whenIdle();assert.equal(f.host.provider.requests.length,2);assert.ok(JSON.stringify(f.host.provider.requests[1]).includes('EXACT {{literal}} ACTION'));assert.equal((await f.call('history',{}) as HistoryEntry[])[0]!.action?.status,'attached');
});
test('生产链路组装后移除关联输入不留下孤立动作或推理',async t=>{
 const f=await fixture(t);let first=true;f.host.ctx.on('agent/pre-step',async(_p,next)=>{const decision=await next();if(first&&decision.kind==='enter'){first=false;return{...decision,messages:decision.messages.filter(m=>m.source.kind!=='user')};}return decision;});
 await f.apply({ref:f.ref,requestId:'reject',action:f.action});await f.live.whenIdle();assert.equal(f.host.provider.requests.length,0);assert.equal((await f.call('history',{}) as HistoryEntry[])[0]!.action?.status,'failed');f.live.followup(input('other'));await f.live.whenIdle();assert.ok(!JSON.stringify(f.host.provider.requests).includes('EXACT {{literal}} ACTION'));
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
 const f=await fixture(t);let d=await f.c.createScenarioDraft([f.ref]);const a={action_id:randomUUID(),action_revision_id:randomUUID(),kind:'instruction' as const,scope:'turn' as const,locale:'zh-CN',effect_summary:'控制字符预算',conflict_group:'explanation' as const,instruction:'\u0001'.repeat(2048),rights:{license:'CC0-1.0'}};
 d=await f.c.saveScenarioDraft(d.draft_id,d.version,{...d.manifest,actions:[a],bindings:[{expression:f.ref,actions:[{action_id:a.action_id,action_revision_id:a.action_revision_id}]}]});await f.c.confirmScenarioDraft(d.draft_id,d.version);
 await assert.rejects(f.apply({ref:f.ref,requestId:'oversize',action:{release_id:d.manifest.release_id,action_id:a.action_id,action_revision_id:a.action_revision_id}}),/ACTION_LIMIT/);assert.equal((await f.call('history',{}) as HistoryEntry[]).length,0);assert.equal(f.host.provider.requests.length,0);
});
test('新profile保留原生日志证明的旧local表达读取，不迁移动作授权',async t=>{
 const f=await fixture(t);const binding=await f.c.bind({host:'dsh',hostInstanceId:'local',sessionId:'session'});const legacy=await f.c.receive(binding,f.ref,'legacy');f.live.followup(input(`amoji:${legacy.message_id}`));await f.live.whenIdle();const rows=await f.call('history',{}) as HistoryEntry[];assert.equal(rows.length,1);assert.equal(rows[0]!.message.message_id,legacy.message_id);assert.equal(rows[0]!.action,undefined);
});
test('生产已提交回执在共享服务断连后仍可从原生日志恢复，核对不重发',async t=>{
 const f=await fixture(t);const {textResponse}=await import('./helpers/dsh-native.js');f.host.provider.respond=async function*(){await stopSharedService(join(f.directory,'library'),f.c.identity.serviceId);yield* textResponse();};
 try{await f.apply({ref:f.ref,requestId:'receipt-loss',action:f.action});}catch(error){assert.match(String(error),/DSH_OUTCOME_UNKNOWN|CONNECTION_CLOSED/);}
 await f.live.whenIdle();await f.c.reconnect();const rows=await f.call('history',{}) as HistoryEntry[];assert.equal(rows[0]!.action?.status,'attached');assert.equal(f.host.provider.requests.length,1);
});
test('明确动作端点与纯表达端点严格分离',async t=>{
 const f=await fixture(t);await assert.rejects(f.call('submit',{ref:f.ref,requestId:'forbidden',action:f.action}),/INVALID_ARGUMENT/);
 const row=await f.call('submitWithAction',{ref:f.ref,actionRef:{action_id:f.action.action_id,action_revision_id:f.action.action_revision_id},releaseRef:{release_id:f.action.release_id},requestId:'explicit-action'}) as HistoryEntry;await f.live.whenIdle();assert.ok(row.action);assert.equal((await f.call('history',{}) as HistoryEntry[])[0]!.action?.status,'attached');assert.equal(f.host.provider.requests.length,1);
});
test('公开协作能力与回执接口支持重开后的独立核对',async t=>{
 const f=await fixture(t);const capabilities=await f.call('collaboration.capabilities',{}) as {supported:boolean};assert.equal(capabilities.supported,true);
 await f.apply({ref:f.ref,requestId:'receipts',action:f.action});await f.live.whenIdle();const rows=await f.call('collaboration.receipts',{}) as HistoryEntry[];assert.equal(rows[0]!.action?.status,'attached');assert.equal(f.host.provider.requests.length,1);
});
