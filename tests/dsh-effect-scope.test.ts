import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/dsh-correlated.js';
import { input } from './helpers/dsh-native.js';
function snapshots(agent:any){return agent.session.snapshotEvents().flatMap((e:any)=>e.type==='user/message'&&e.data.source.kind==='runtime-context'?(e.data.source.sections??[]).filter((s:any)=>s.name==='amoji:collaboration').map((s:any)=>JSON.parse(s.text)):[]);}
// RFC §7: an effect travels only with the expression that carries it.
test('效果只跟随本条表情：下一次输入不再附上',async t=>{
 const f=await fixture(t);
 await f.apply({ref:f.ref,requestId:'once',effect:f.effect});await f.live.whenIdle();
 assert.equal(snapshots(f.live).at(-1).instruction.instruction,'EXACT {{literal}} ACTION');assert.equal(snapshots(f.live).at(-1).rules.length,0);
 f.live.followup(input('next'));await f.live.whenIdle();assert.equal(f.host.provider.requests.length,2);
 assert.ok(snapshots(f.live).every((s:any)=>s.rules.length===0));assert.equal(snapshots(f.live).at(-1).instruction,null);
});
test('对话规则入口已移除；旧客户端存下的规则不会附上',async t=>{
 const f=await fixture(t);
 for(const method of ['collaboration.rules','collaboration.enable','collaboration.disable','collaboration.disableAll'])await assert.rejects(f.call(method,{}),/未知 Amoji RPC/);
 assert.deepEqual((await f.call('collaboration.capabilities',{}) as any).scopes,['turn']);
 const choice=(await f.runtime.rules!.choices({host:'dsh',hostInstanceId:'profile',sessionId:'session'}))[0];
 if(choice){f.bridge.context.authorize(f.live);await f.runtime.rules!.change({host:'dsh',hostInstanceId:'profile',sessionId:'session'},{kind:'enable',selection:choice.selection,generation:0,replace:null,checkpoint:f.bridge.context.checkpoint(f.live)});}
 f.live.followup(input('plain'));await f.live.whenIdle();assert.equal(f.host.provider.requests.length,1);
 assert.ok(snapshots(f.live).every((s:any)=>s.rules.length===0));
});
