import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { createComponents } from '../src/dsh/client.js';
import { SampleCatalog } from '../src/sample-catalog.js';
import type { DshRpc, HistoryEntry } from '../src/dsh/contracts.js';
import { visualMeta } from '../src/dsh/host.js';
import { createRpc } from '../src/dsh/media.js';

test('Picker 连接故障清除失效候选并可恢复；核对原消息把 accepted 更新为 observed', async t => {
 const dom = new JSDOM('<div id="root"></div>'); const before = { window:globalThis.window, document:globalThis.document };
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const root = createRoot(dom.window.document.getElementById('root')!); t.after(async()=>{await act(()=>root.unmount());Object.assign(globalThis,before);dom.window.close();});
 const e=(await SampleCatalog.load(new URL('../assets/samples/',import.meta.url))).all()[0]!;
 const message={message_id:'original',direction:'human_to_ai',revision:e,presentation:'pending'} as HistoryEntry['message'];
 const row:HistoryEntry={message,meta:visualMeta(message),host:{status:'accepted',requestId:'amoji:original'}};
 let disconnected=false;let submissions=0;let history:HistoryEntry[]|Promise<HistoryEntry[]>=[];
 const rpc={catalog:async()=>{if(disconnected)throw Object.assign(new Error('共享服务连接已断开'),{code:'CONNECTION_CLOSED'});return [e];},visual:async()=>({expression:e,primary:'data:image/png;base64,AA',poster:null}),submit:async()=>{submissions++;return row;},history:async()=>history,reconnect:async()=>{disconnected=false;}} as unknown as DshRpc;
 const Picker=createComponents(rpc).Picker;
 const click=async(label:string)=>{const el=[...dom.window.document.querySelectorAll('button')].find(e=>(e.getAttribute('aria-label')??e.textContent)===label);assert.ok(el,label);await act(async()=>{el.click();});};
 await act(()=>root.render(React.createElement(Picker,{sessionId:'a'})));await click('表情');await click(e.name);
 assert.ok(!dom.window.document.querySelector('[aria-label="Amoji 表情选择"]'));
 await click('表情');assert.match(dom.window.document.body.textContent!,/尚未确认/);
 history=[{...row,host:{...row.host!,status:'observed',seq:2,hostMessageId:'native-id'}}];
 await click('核对投递状态');assert.match(dom.window.document.body.textContent!,/已观察到会话用户消息/);assert.equal(submissions,1);
 let finish!: (rows:HistoryEntry[])=>void;history=new Promise(r=>{finish=r;});
 await click('核对投递状态');await click(`查看 ${e.name} 详情`);await act(()=>finish([{...row,host:{...row.host!,status:'observed'}}]));
 assert.doesNotMatch(dom.window.document.querySelector('[role=status]')?.textContent??'',/已观察到/, '迟到核对不能覆盖新选择的状态');
 disconnected=true;await click('搜索');assert.equal(dom.window.document.querySelectorAll('.amoji-expression-tile').length,0);
 await click('重新连接并核对');assert.equal(dom.window.document.querySelectorAll('.amoji-expression-tile').length,1);assert.equal(submissions,1);
});

test('真实 Client RPC 将传输失败与主动取消分开，提交丢失响应明确未知', async()=>{
 const rpc=createRpc({connection:{rpc:{call:async()=>{throw new TypeError('fetch failed');}}}} as any);
 await assert.rejects(rpc.catalog('a'), /连接中断.*重新连接/);
 await assert.rejects(rpc.submit('a',{asset_id:'a',revision_id:'r'},'same'), /结果尚待核对/);
 const cancelled=new AbortController();cancelled.abort(new Error('user cancelled'));
 await assert.rejects(rpc.catalog('a',cancelled.signal), /user cancelled/);
});

test('实际 createRpc 提交丢响应后冻结改选，恢复仍核对原 ref/requestId', async t => {
 const dom = new JSDOM('<div id="root"></div>'); const before = { window:globalThis.window, document:globalThis.document };
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const root = createRoot(dom.window.document.getElementById('root')!);t.after(async()=>{await act(()=>root.unmount());Object.assign(globalThis,before);dom.window.close();});
 const [e,other]=(await SampleCatalog.load(new URL('../assets/samples/',import.meta.url))).all();assert.ok(e&&other);
 const submits:any[]=[];let recovered=false;let observed=false;
 const message={message_id:'original',direction:'human_to_ai',revision:e,presentation:'pending'} as HistoryEntry['message'];
 const row:HistoryEntry={message,meta:visualMeta(message),host:{status:'observed',requestId:'amoji:original'}};
 const rpc=createRpc({connection:{rpc:{call:async(_channel:string,endpoint:string,payload:any)=>{
  if(endpoint==='amoji/submit'){submits.push(structuredClone(payload));if(!recovered)throw new TypeError('response lost');return {ok:true,value:{...row,host:{...row.host,status:'unknown'}}};}
  if(endpoint==='amoji/reconnect'){recovered=true;return {ok:true,value:null};}
  if(endpoint==='amoji/catalog')return {ok:true,value:recovered?[other]:[e,other]};
  if(endpoint==='amoji/management')return {ok:true,value:payload.method==='getSettings'?{version:1,style:'neutral',frequency:'restrained',paused:false,appearance:'classic'}:{version:2,style:'neutral',frequency:'restrained',paused:false,appearance:'office'}};
  if(endpoint==='amoji/history')return {ok:true,value:[{...row,host:{...row.host,status:observed?'observed':'unknown'}}]};
  if(endpoint==='amoji/visual')return {ok:true,value:{expression:payload.ref.asset_id===e.asset_id?e:other,primary:'data:image/png;base64,AA',poster:null}};
  return {ok:true,value:[]};
 }}}} as any);
 const Picker=createComponents(rpc).Picker;const button=(label:string)=>[...dom.window.document.querySelectorAll('button')].find(el=>(el.getAttribute('aria-label')??el.textContent)===label)!;
 const click=async(label:string)=>{assert.ok(button(label),label);await act(async()=>button(label).click());};
 await act(()=>root.render(React.createElement(Picker,{sessionId:'original-session'})));await click('表情');await click(e.name);
 assert.match(dom.window.document.body.textContent!,/结果尚待核对/);assert.equal(button('重试原请求').disabled,true);
 assert.ok(!button(other.name)||button(other.name).disabled,'未知投递不能改选并生成新requestId');
 assert.equal(button('办公').disabled,true,'未知投递不能切换画风清掉原请求');
 await click('办公');
 await click('关闭');await click('表情');assert.match(dom.window.document.querySelector('[aria-label="固定语义与精确版本"]')!.textContent!,new RegExp(e.revision_id));
 assert.equal(button('重试原请求').disabled,true,'重新打开不能绕过恢复门禁');
 await click('重新连接并核对');assert.equal(submits.length,1,'重连不重放原提交');assert.equal(button(other.name).disabled,true,'已恢复但未核对原消息时仍不可改选');
 assert.equal(button(`查看 ${other.name} 详情`).disabled,true,'未知投递不能用详情替换原 ref');await click(`查看 ${other.name} 详情`);
 await click('重试原请求');assert.equal(submits.length,2);assert.deepEqual(submits[1],submits[0]);assert.equal(button(other.name).disabled,true,'宿主仍未知时不可解除冻结');
 observed=true;await click('核对投递状态');assert.equal(button(other.name).disabled,false,'原消息已核对才解除未知冻结');
 assert.match(dom.window.document.body.textContent!,/已观察到会话用户消息/);
});
