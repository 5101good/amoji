import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { createComponents } from '../src/dsh/client.js';
import { createRpc } from '../src/dsh/media.js';
import { DraftEditor, Fields } from '../src/dsh/draft-editor.js';
import { management } from '../src/dsh/host-management.js';
import { DshAdapter, visualMeta } from '../src/dsh/host.js';
import { LibraryStore } from '../src/library-store.js';
import { SampleCatalog } from '../src/sample-catalog.js';
import { validateDraftFields, type Draft, type DraftFields } from '../src/drafts.js';
async function waitFor(check:()=>boolean){for(let i=0;i<100&&!check();i++)await act(async()=>{await new Promise(r=>setTimeout(r,10));});assert.ok(check(),'等待界面完成异步I/O');}
const seed=new URL('../assets/samples/',import.meta.url);
const [e,other]=(await SampleCatalog.load(seed)).all();assert.ok(e&&other);
async function fixture(t:TestContext){
 const dom=new JSDOM('<div id="root"></div>');const old={window:globalThis.window,document:globalThis.document,FileReader:globalThis.FileReader};
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,FileReader:dom.window.FileReader,IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(dom.window.document.getElementById('root')!);
 t.after(async()=>{await act(()=>root.unmount());Object.assign(globalThis,old);dom.window.close();});
 const button=(s:string)=>[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent===s)!;
 return {dom,root,button,click:async(s:string)=>{assert.ok(button(s),s);await act(async()=>button(s).click());},input:async(label:string,value:string,scope:ParentNode=dom.window.document)=>{const el=scope.querySelector<HTMLInputElement|HTMLTextAreaElement>(`[aria-label="${label}"]`)??[...scope.querySelectorAll('label')].find(v=>v.textContent?.startsWith(label))?.querySelector<HTMLInputElement|HTMLTextAreaElement>('input,textarea');assert.ok(el,label);await act(()=>{el.value=value;el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});}};
}
async function storeFixture(t:TestContext){const dir=await mkdtemp(join(tmpdir(),'amoji-final-'));const store=await LibraryStore.open(dir,seed);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return store;}
for(const timing of ['lost','inflight'] as const)test(`final I1 ${timing} A→B→A 保留原投递身份`,async t=>{
 const f=await fixture(t);const submits:any[]=[];let finish!:()=>void;let recovered=false;let observed=false;
 const message={message_id:'original',direction:'human_to_ai',revision:e,presentation:'pending'} as any;
 const row={message,meta:visualMeta(message),host:{requestId:'amoji:original',status:'unknown'}};
 const rpc=createRpc({connection:{rpc:{call:async(_c:string,endpoint:string,p:any,signal:AbortSignal)=>{
  if(endpoint==='amoji/submit'){submits.push(structuredClone(p));if(submits.length===1){if(timing==='inflight')await new Promise<void>((resolve,reject)=>{finish=resolve;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});throw new TypeError('lost');}return {ok:true,value:row};}
  if(endpoint==='amoji/reconnect'){recovered=true;return {ok:true,value:null};}
  if(endpoint==='amoji/history')return {ok:true,value:[{...row,host:{...row.host,status:observed?'observed':'unknown'}}]};
  if(endpoint==='amoji/catalog')return {ok:true,value:recovered?[other]:[e,other]};
  if(endpoint==='amoji/visual')return {ok:true,value:{expression:p.ref.asset_id===e.asset_id?e:other,primary:'data:image/png;base64,AA',poster:null}};
  throw new Error(endpoint);
 }}}} as any);
 const Picker=createComponents(rpc).Picker;const render=async(s:string)=>act(()=>f.root.render(React.createElement(Picker,{sessionId:s})));
 await render('A');await f.click('表情');await f.click(e.name);await render('B');assert.equal(!!f.button('重试原请求'),false);await render('A');await f.click('表情');
 assert.ok(f.dom.window.document.querySelector('[aria-label="固定语义与精确版本"]')?.textContent?.includes(e.revision_id),'返回必须保留原版本');
 assert.equal(f.button('重试原请求').disabled,true);assert.ok(!f.button(other.name)||f.button(other.name).disabled);
 await f.click('重新连接并核对');assert.equal(submits.length,1);assert.equal(f.button(other.name).disabled,true);
 await f.click('重试原请求');assert.equal(submits.length,2);assert.deepEqual(submits[1],submits[0]);assert.equal(submits[0].sessionId,'A');
 observed=true;await f.click('核对投递状态');assert.equal(f.button(other.name).disabled,false);finish?.();
});
test('final I2 原生Fields清空可选项后真实保存预览确认；必填仍严格',async t=>{
 const f=await fixture(t),store=await storeFixture(t);const original=store.list()[0]!;const before=structuredClone(original);
 let fields:DraftFields={name:original.name,semantics:{...original.semantics,tone:'轻快'},tags:['标签'],rights:{...original.rights,creator:'作者',source:'来源'}};
 function Form(){const [v,set]=useState(fields);return React.createElement(Fields,{value:v,onChange:value=>{fields=value;set(value);}});}
 await act(()=>f.root.render(React.createElement(Form)));
 for(const label of ['语气','作者','来源','标签（每行一项）'])await f.input(label,'');
 assert.equal('tone' in fields.semantics,false);assert.equal('creator' in fields.rights,false);assert.equal('source' in fields.rights,false);assert.deepEqual(fields.tags,[]);
 const d=store.startRevisionDraft({asset_id:original.asset_id,revision_id:original.revision_id},store.getEntry(original.asset_id).version),saved=await store.saveDraft(d.draft_id,d.version,fields);
 await store.previewDraft(saved.draft_id,saved.version);const created=await store.confirmDraft(saved.draft_id,saved.version);assert.deepEqual(created.semantics,fields.semantics);assert.deepEqual(store.resolve(original),before);
 for(const key of ['meaning','fallback'] as const)assert.throws(()=>validateDraftFields({...fields,semantics:{...fields.semantics,[key]:''}}));
 assert.throws(()=>validateDraftFields({...fields,rights:{...fields.rights,license:''}}));
});
for(const lost of ['saveDraft','confirmDraft'] as const)test(`final I3 实际RPC ${lost} 已落库丢响应冻结输入，核对不重放`,async t=>{
 const f=await fixture(t),store=await storeFixture(t);const original=store.list()[0]!;const initial=store.startRevisionDraft({asset_id:original.asset_id,revision_id:original.revision_id},store.getEntry(original.asset_id).version);
 const runtime:any={management:store,creation:store,readBlob:(hash:string)=>readFile(join(store.directory,'blobs',hash))};let dropped=false;const calls:any[]=[];
 const rpc=createRpc({connection:{rpc:{call:async(_c:string,endpoint:string,p:any)=>{
  if(endpoint==='amoji/reconnect')return {ok:true,value:null};
  if(endpoint==='amoji/visual')return {ok:true,value:{expression:store.resolve(p.ref),primary:'data:image/png;base64,AA',poster:null}};
  assert.equal(endpoint,'amoji/management');calls.push(structuredClone(p));const value=await management(runtime,p.method,p.args);if(p.method===lost&&!dropped){dropped=true;throw new TypeError('host response lost');}return {ok:true,value};
 }}}} as any);
 await act(()=>f.root.render(React.createElement(DraftEditor,{rpc,sessionId:'s',initial,onCreated(){}})));
 await f.input('名称','保留本次填写');
 const bytes=await readFile(new URL(`blobs/${other.visual.primary.sha256}`,seed));const upload=f.dom.window.document.querySelector<HTMLInputElement>('[aria-label="上传表情图片"]')!;
 Object.defineProperty(upload,'files',{value:[new f.dom.window.File([new Uint8Array(bytes)],'own.png')]});
 await act(async()=>{upload.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,100));});
 assert.equal(f.dom.window.document.querySelector('fieldset')!.disabled,false,'上传读取已完成');
 await f.click(lost==='saveDraft'?'保存草稿':'保存并预览');
 await waitFor(()=>!!f.dom.window.document.querySelector('[role=alert], [aria-label="图文确认预览"]'));
 if(lost==='confirmDraft'){await act(()=>f.dom.window.document.querySelector('[aria-label="图文确认预览"] img')!.dispatchEvent(new f.dom.window.Event('load')));await act(()=>f.dom.window.document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());await f.click('确认加入表情库');await waitFor(()=>!!f.dom.window.document.querySelector('[role=alert]'));}
 assert.equal(f.dom.window.document.querySelector('fieldset')!.disabled,true,'未知写入必须冻结');
 assert.equal(store.getDraft(initial.draft_id).fields.name,'保留本次填写');assert.equal(store.getDraft(initial.draft_id).visual!.primary.sha256,other.visual.primary.sha256);
 const count=calls.length;await rpc.reconnect!('s');assert.equal(calls.length,count);assert.equal(f.dom.window.document.querySelector('fieldset')!.disabled,true,'重连不能代替核对');
 await f.click('核对当前状态');assert.equal(calls.filter(c=>c.method===lost).length,1);assert.equal(calls.at(-1).args.draft_id,initial.draft_id);
 assert.equal(f.dom.window.document.querySelector('fieldset')!.disabled,lost==='confirmDraft');
 assert.deepEqual(store.resolve(original),original);
 if(lost==='saveDraft'){await f.click('保存草稿');await waitFor(()=>!f.dom.window.document.querySelector('fieldset')!.disabled);const retried=calls.at(-1).args;assert.equal(retried.version,initial.version+1);assert.equal(retried.upload,bytes.toString('base64'));assert.equal(retried.fields.name,'保留本次填写');}
});
test('final I3 只读/预览传输分类和结构化业务错误不混淆',async()=>{
 let business=false;const rpc=createRpc({connection:{rpc:{call:async()=>{if(business)return {ok:false,error:{code:'DRAFT_CONFLICT',message:'冲突',details:{current:{version:7}}}};throw new TypeError('lost');}}}} as any);
 for(const [method,code] of [['getDraft','CONNECTION_CLOSED'],['previewDraft','DRAFT_PREVIEW_UNAVAILABLE'],['saveDraft','DRAFT_OUTCOME_UNKNOWN'],['confirmDraft','DRAFT_OUTCOME_UNKNOWN']])await assert.rejects(rpc.management('s',method as any,{} as any),(e:any)=>e.code===code);
 business=true;await assert.rejects(rpc.management('s','saveDraft',{} as any),(e:any)=>e.code==='DRAFT_CONFLICT'&&e.current.version===7);
});
test('final M3 保存后迟到建议、核对与冲突续编后旧候选不可采用',async t=>{
 const f=await fixture(t);let draft:Draft={draft_id:'final-suggestions',version:1,updated_at:'now',fields:{name:e.name,semantics:e.semantics,rights:e.rights},visual:e.visual};let deliver!:(v:any)=>void;let deferred=true;
 const suggestion={fields:{...draft.fields,semantics:{...draft.fields.semantics,tone:'语气'},tags:['标签']},notice:'建议'};
 const rpc:any={management:async(_s:string,method:string,args:any)=>{
  if(method==='listSuggestionModels')return{models:[{provider:'p',model:'flash',name:'Flash'}],current:{provider:'p',model:'flash'}};
  if(method==='suggestAiText')return deferred?new Promise(r=>{deliver=r;}):suggestion;
  if(method==='saveDraft'){draft={...draft,version:args.version+1,fields:args.fields};return draft;}
  if(method==='getDraft')return draft;
  if(method==='previewDraft')return {draft,primary:'data:image/png;base64,AAAA',poster:null};
  if(method==='confirmDraft')throw Object.assign(new Error('冲突'),{code:'ENTRY_CONFLICT',current:{expression:other,origin:'local',version:2}});
  if(method==='startRevisionDraft')return {...draft,draft_id:'continued',version:1};
 }};
 await act(()=>f.root.render(React.createElement(DraftEditor,{rpc,sessionId:'s',initial:draft,onCreated(){}})));
 await act(async()=>{});await f.input('文字意图','感谢帮忙');
 await f.click('AI 生成文字建议');await f.click('保存草稿');await act(()=>deliver(suggestion));assert.equal(!!f.button('采用建议'),false,'保存改变版本，迟到建议不能出现');
 deferred=false;await f.click('AI 生成文字建议');const candidate=f.dom.window.document.querySelector('[aria-label="待选建议"]')!;await f.input('语气','',candidate);await f.input('标签（每行一项）','',candidate);await f.click('采用建议');
 assert.equal((f.dom.window.document.querySelector('[aria-label="语气"]') as HTMLTextAreaElement).value,'');
 const conflict=async()=>{await f.click('保存并预览');await act(()=>f.dom.window.document.querySelector('[aria-label="图文确认预览"] img')!.dispatchEvent(new f.dom.window.Event('load')));await act(()=>f.dom.window.document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());await f.click('AI 生成文字建议');await f.click('确认加入表情库');assert.ok(f.button('采用建议'));};
 await conflict();await f.click('核对当前状态');assert.equal(!!f.button('采用建议'),false,'核对版本后旧候选不能采用');
 await conflict();await f.click('基于当前版本继续，保留本次填写');assert.equal(!!f.button('采用建议'),false,'续编改变draft身份，旧候选不能采用');
});
test('final M1 实际tarball的兼容manage首页和静态资源可用',async t=>{
 const exec=promisify(execCallback),root=fileURLToPath(new URL('../',import.meta.url));await mkdir(join(root,'.cache'),{recursive:true});const dir=await mkdtemp(join(root,'.cache/dsh-final-pack-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const {stdout}=await exec('npm',['pack','./adapters/dsh','--pack-destination',dir,'--json','--ignore-scripts'],{cwd:root});const info=JSON.parse(stdout)[0];await exec('tar',['-xzf',join(dir,info.filename),'-C',dir]);
 const {PanelServer}=await import(pathToFileURL(join(dir,'package/runtime/src/panel-server.js')).href);const panel=await PanelServer.start({},async()=>{});t.after(()=>panel.close());
 const url=panel.url({host:'dsh',hostInstanceId:'isolated-test',sessionId:'test'});const page=await fetch(url);assert.equal(page.status,200);const html=await page.text();assert.match(html,/Amoji/);
 for(const match of html.matchAll(/(?:src|href)="(\/[^"#]+)"/g)){const resource=await fetch(new URL(match[1]!,url));assert.equal(resource.status,200,match[1]!);}
 assert.ok(info.files.some((v:any)=>v.path==='web/index.html'));
});
test('final 模型可见选择说明包含发送视角、无匹配文字回退和limit合同',()=>{
 const adapter=new DshAdapter({effect(){}} as any,{} as any,'tool-documentation');const search=adapter.tool('amoji_search'),emit=adapter.tool('amoji_emit');
 assert.match(search.description,/默认\s*3/);assert.match(search.description,/1[–—-]5/);assert.match(search.description,/AI.*用户/);assert.match(search.description,/主体.*对象/);assert.match(search.description,/无合适.*文字/);assert.match(emit.description,/AI.*用户/);
 assert.deepEqual(Object.keys(search.parameters!),['query','limit']);
});
