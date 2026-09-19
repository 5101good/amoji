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
 const click=async(label:string)=>{const el=[...dom.window.document.querySelectorAll('button')].find(e=>e.textContent===label);assert.ok(el,label);await act(async()=>{el.click();});};
 await act(()=>root.render(React.createElement(Picker,{sessionId:'a'})));await click('表情');await click(e.name);await click('发送所选表情');
 assert.match(dom.window.document.body.textContent!,/尚未确认/);
 history=[{...row,host:{...row.host!,status:'observed',seq:2,hostMessageId:'native-id'}}];
 await click('核对投递状态');assert.match(dom.window.document.body.textContent!,/已观察到会话用户消息/);assert.equal(submissions,1);
 let finish!: (rows:HistoryEntry[])=>void;history=new Promise(r=>{finish=r;});
 await click('核对投递状态');await click(e.name);await act(()=>finish([{...row,host:{...row.host!,status:'observed'}}]));
 assert.doesNotMatch(dom.window.document.querySelector('[role=status]')!.textContent!,/已观察到/, '迟到核对不能覆盖新选择的状态');
 disconnected=true;await click('显示全部');assert.equal(dom.window.document.querySelectorAll('.tile').length,0);
 const send=[...dom.window.document.querySelectorAll('button')].find(e=>e.textContent==='发送所选表情')!;assert.equal(send.disabled,true);
 await click('重新连接并核对');assert.equal(dom.window.document.querySelectorAll('.tile').length,1);assert.equal(submissions,1);
});

test('真实 Client RPC 将传输失败与主动取消分开，提交丢失响应明确未知', async()=>{
 const rpc=createRpc({connection:{rpc:{call:async()=>{throw new TypeError('fetch failed');}}}} as any);
 await assert.rejects(rpc.catalog('a'), /连接中断.*重新连接/);
 await assert.rejects(rpc.submit('a',{asset_id:'a',revision_id:'r'},'same'), /结果尚待核对/);
 const cancelled=new AbortController();cancelled.abort(new Error('user cancelled'));
 await assert.rejects(rpc.catalog('a',cancelled.signal), /user cancelled/);
});
