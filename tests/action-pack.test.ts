import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SampleCatalog } from '../src/sample-catalog.js';
import { validatePackManifest } from '../src/packs.js';
import { ActionCompiler } from '../src/actions.js';
const e = (await SampleCatalog.load(new URL('../assets/samples/', import.meta.url))).all()[0]!;
const ref = { asset_id: e.asset_id, revision_id: e.revision_id };
export const instruction = () => ({ action_id: randomUUID(), action_revision_id: randomUUID(), kind: 'instruction' as const, scope: 'turn' as const, locale: 'zh-CN', effect_summary: '解释原因', conflict_group: 'explanation' as const, instruction: '请说明依据，保留 {{literal}}。', rights: { license: 'CC0-1.0' } });
export const hook = () => ({ action_id: randomUUID(), action_revision_id: randomUUID(), kind: 'hook' as const, scope: 'conversation' as const, locale: 'zh-CN', effect_summary: '先给答案', conflict_group: 'response-organization' as const, template: 'response-organization@1' as const, config: { layout: 'answer-first' as const }, rights: { license: 'CC0-1.0' } });
export function manifest() { const action = instruction(); return {kind:'amoji.pack',schema_version:'0.2',pack_id:randomUUID(),release_id:randomUUID(),version:1,name:'协作',created_at:'2026-10-10T00:00:00Z',scenario:['解释'],expressions:[e],defaults:[ref],actions:[action],bindings:[{expression:ref,actions:[{action_id:action.action_id,action_revision_id:action.action_revision_id}]}],rights:{license:'CC0-1.0'}}; }
test('0.2严格身份、必填字段、引用与UTF8预算；0.1表达仍不可夹带动作',()=>{
 const good=manifest(); assert.deepEqual(validatePackManifest(good),good);
 for(const field of ['release_id','version','scenario','rights','actions','bindings']) { const bad:any=structuredClone(good); delete bad[field]; assert.throws(()=>validatePackManifest(bad),/INVALID_SCHEMA/); }
 for(const mutate of [(p:any)=>p.owner='attacker',(p:any)=>p.actions[0].script='run()',(p:any)=>p.expressions[0].semantics.action='run',(p:any)=>p.actions[0].instruction='字'.repeat(683),(p:any)=>p.description='字'.repeat(1366),(p:any)=>p.actions=Array.from({length:65},instruction),(p:any)=>p.bindings[0].actions=Array.from({length:4},()=>p.bindings[0].actions[0]),(p:any)=>p.bindings[0].actions[0].action_revision_id=randomUUID()]) { const bad=structuredClone(good); mutate(bad); assert.throws(()=>validatePackManifest(bad)); }
 const bad=structuredClone(good); bad.schema_version='0.3'; assert.throws(()=>validatePackManifest(bad),/UNSUPPORTED_SCHEMA/);
});

test('ActionCompiler稳定、明文优先级、同组一次覆盖、独立语义及8KiB预算',()=>{
 const compiler=new ActionCompiler(); const rule=hook(); const once={...instruction(),conflict_group:'response-organization' as const};
 const input={rules:[rule],once,semantics:'固定语义'}; const output=compiler.compile(input);
 assert.equal(output,compiler.compile(input)); assert.match(output,/请说明依据/); assert.match(output,/{{literal}}/); assert.doesNotMatch(output,/先给答案/); assert.match(output,/用户明确文本/); assert.match(output,/宿主/);
 assert.throws(()=>compiler.compile({rules:[rule,rule],semantics:''}),/ACTION_CONFLICT/);
 assert.throws(()=>compiler.compile({rules:[rule,rule,rule],semantics:''}),/ACTION_LIMIT/);
 assert.throws(()=>compiler.compile({rules:[{...rule,effect_summary:'x'.repeat(4096)}],once:{...instruction(),effect_summary:'y'.repeat(4096)},semantics:''}),/ACTION_LIMIT/);
 assert.throws(()=>compiler.compile({...input,semantics:'字'.repeat(1366)}),/SEMANTIC_LIMIT/);
 assert.throws(()=>compiler.compile({rules:[],once:{...once,instruction:'字'.repeat(683)},semantics:''}),/ACTION_LIMIT/);
});

test('只接受两个内建hook及精确配置；禁止任意模板和执行字段',()=>{
 for(const a of [hook(),{...hook(),template:'completion-self-check@1',conflict_group:'completion-report',config:{evidence:'required',unknowns:'explicit'}}]){const p=manifest();p.actions=[a] as any;p.bindings=[];assert.doesNotThrow(()=>validatePackManifest(p));}
 for(const change of [{template:'other@1'},{scope:'turn'},{config:{layout:'answer-first',url:'https://invalid.example'}},{config:{layout:'other'}},{event:'turn/start'},{model:'any'}]){const p=manifest();p.actions=[{...hook(),...change}] as any;p.bindings=[];assert.throws(()=>validatePackManifest(p),/INVALID_SCHEMA/);}
});
