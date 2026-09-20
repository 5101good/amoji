import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import { createComponents, type ClientPort } from '../src/dsh/client.js';
import { mountUserMessages } from '../src/dsh/messages.js';
import { expressionMessageText } from '../src/dsh/expression-message.js';
import { SampleCatalog } from '../src/sample-catalog.js';
import { visualMeta } from '../src/dsh/host.js';
import type { DshRpc } from '../src/dsh/contracts.js';
const expressions = (await SampleCatalog.load(new URL('../assets/samples/', import.meta.url))).all();
const expression = expressions[0]!;
async function fixture(t: TestContext) {
 const dom = new JSDOM('<div id="root"></div><button id="outside">外部控件</button>');
 const old = {window:globalThis.window, document:globalThis.document};
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const root = createRoot(dom.window.document.getElementById('root')!);
 t.after(async()=>{await act(()=>root.unmount());Object.assign(globalThis,old);dom.window.close();});
 const button=(name:string)=>[...dom.window.document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===name || b.textContent===name)!;
 const click=async(name:string)=>{assert.ok(button(name),name);await act(async()=>button(name).click());};
 const rpc={catalog:async()=>expressions,visual:async(_s:string,ref:any)=>({expression:expressions.find(e=>e.asset_id===ref.asset_id)!,primary:'data:image/png;base64,AAAA',poster:null})} as unknown as DshRpc;
 return {dom,root,button,click,rpc,panel:()=>dom.window.document.querySelector('[aria-label="Amoji 表情选择"]')};
}
for(const mode of ['toggle','escape','outside','outsideClick','focusOutside','close'] as const)test(`选择器可通过${mode}关闭并重新打开`,async t=>{
 const f=await fixture(t);const Picker=createComponents(f.rpc).Picker;
 await act(()=>f.root.render(React.createElement(Picker,{sessionId:'s'})));
 await f.click('表情');assert.ok(f.panel());
 if(mode==='toggle')await f.click('表情');
 if(mode==='escape')await act(()=>f.dom.window.document.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 if(mode==='outside')await act(()=>f.dom.window.document.getElementById('outside')!.dispatchEvent(new f.dom.window.Event('pointerdown',{bubbles:true})));
 if(mode==='outsideClick')await act(()=>f.dom.window.document.getElementById('outside')!.click());
 if(mode==='focusOutside')await act(()=>f.dom.window.document.getElementById('outside')!.focus());
 if(mode==='close')await f.click('关闭');
 assert.ok(!f.panel(),'关闭操作必须移除弹层');
 if(mode==='escape'||mode==='close')assert.ok(f.dom.window.document.activeElement===f.button('表情'),'键盘焦点回到入口');
 await f.click('表情');assert.ok(f.panel(),'可以再次打开');
});
test('列表图片和名称属于同一个可选择按钮且不嵌套播放按钮',async t=>{
 const f=await fixture(t);const Picker=createComponents(f.rpc).Picker;
 await act(()=>f.root.render(React.createElement(Picker,{sessionId:'s'})));await f.click('表情');
 const image=f.panel()!.querySelector('img')!;const tile=image.closest('button');
 assert.ok(tile,'图片整体可点击');assert.equal(tile.getAttribute('aria-label'),expression.name);
 assert.equal(tile.querySelector('button'),null);
 await act(()=>image.click());assert.equal(tile.getAttribute('aria-pressed'),'true');assert.equal(f.button('发送所选表情').disabled,false);
});
test('宿主接纳发送后收起弹层，重开不能重复上次发送',async t=>{
 const f=await fixture(t);let count=0;
 f.rpc.submit=async()=>{count++;return {meta:{messageId:'sent'},host:{status:'accepted'}} as any;};
 const Picker=createComponents(f.rpc).Picker;await act(()=>f.root.render(React.createElement(Picker,{sessionId:'s'})));
 await f.click('表情');await f.click(expression.name);await f.click('发送所选表情');assert.ok(!f.panel(),'发送后关闭');
 await f.click('表情');assert.equal(f.button('发送所选表情').disabled,true);assert.equal(count,1);
});
for(const mixed of [false,true])test(`可信历史以图片呈现，${mixed?'保留额外文字与附件':'没有重复语义气泡'}`,async t=>{
 const f=await fixture(t);const meta=visualMeta({message_id:'m',revision:expression} as any);
 f.rpc.history=async()=>[{message:{message_id:'m',direction:'human_to_ai',revision:expression},meta,host:{status:'observed',requestId:'amoji:m',seq:1}}] as any;
 const core=new SlotCore();core.register({name:'root',children:{'conversation.chat.node':{kind:'keyed',scope:'session'}}} as any,()=>null);
 const Original=(p:any)=>React.createElement('div',{'data-original':true},JSON.stringify(p.node.data.content));
 core.register({name:'conversation.chat.node',key:'user'} as any,Original);
 const release=mountUserMessages(core as unknown as ClientPort['slots'],f.rpc);t.after(release);
 const View=core.entriesOfSlot('conversation.chat.node')[0]!.component as React.ComponentType<any>;
 const content=[{type:'text',text:expressionMessageText(expression)},...(mixed?[{type:'text',text:'普通文字不能丢失'},{type:'image',url:'attachment.png'}]:[])];
 await act(async()=>f.root.render(React.createElement(View,{sessionId:'s',node:{data:{content,seq:1,source:{kind:'user',rpcId:'amoji:m'}}}})));
 assert.equal(f.dom.window.document.querySelectorAll('img').length,1);
 const native=f.dom.window.document.querySelector('[data-original]');
 if(mixed){assert.ok(native);assert.match(native.textContent!,/普通文字不能丢失/);assert.match(native.textContent!,/attachment.png/);assert.ok(!native.textContent!.includes(expression.semantics.meaning));}
 else assert.ok(!native,'纯表情无需额外宿主文字气泡');
 assert.ok(f.dom.window.document.querySelector('details'),'语义仍可主动查看');
});
test('协作类别只过滤当前列表，切换后不会发送隐藏的旧选择',async t=>{
 const f=await fixture(t);const progress={...expressions[0]!,tags:['协作:进度']};const feedback={...expressions[1]!,tags:['协作:反馈']};
 f.rpc.catalog=async()=>[progress,feedback];const Picker=createComponents(f.rpc).Picker;await act(()=>f.root.render(React.createElement(Picker,{sessionId:'s'})));await f.click('表情');
 await f.click('进度');assert.ok(f.button(progress.name));assert.ok(!f.button(feedback.name));await f.click(progress.name);assert.equal(f.button('发送所选表情').disabled,false);
 await f.click('反馈');assert.ok(f.button(feedback.name));assert.ok(!f.button(progress.name));assert.equal(f.button('发送所选表情').disabled,true);
});

test('纯表情仍保留宿主引用标签和技能信息',async t=>{
 const f=await fixture(t);const meta=visualMeta({message_id:'m',revision:expression} as any);
 f.rpc.history=async()=>[{message:{message_id:'m',direction:'human_to_ai',revision:expression},meta,host:{status:'observed',requestId:'amoji:m',seq:1}}] as any;
 const core=new SlotCore();core.register({name:'root',children:{'conversation.chat.node':{kind:'keyed',scope:'session'}}} as any,()=>null);
 const Original=(p:any)=>React.createElement('div',{'data-original':true},JSON.stringify(p.node.data));
 core.register({name:'conversation.chat.node',key:'user'} as any,Original);
 const release=mountUserMessages(core as unknown as ClientPort['slots'],f.rpc);t.after(release);
 const View=core.entriesOfSlot('conversation.chat.node')[0]!.component as React.ComponentType<any>;
 await act(async()=>f.root.render(React.createElement(View,{sessionId:'s',node:{data:{content:[{type:'text',text:expressionMessageText(expression)}],referenceLabels:['引用的对话'],skillNames:['project-skill'],seq:1,source:{kind:'user',rpcId:'amoji:m'}}}})));
 const native=f.dom.window.document.querySelector('[data-original]');assert.ok(native);assert.match(native.textContent!,/引用的对话/);assert.match(native.textContent!,/project-skill/);assert.ok(!native.textContent!.includes(expression.semantics.meaning));
});

test('低高度选择器使用完整视口并让发送操作独立于可滚动详情',async t=>{
 const f=await fixture(t);Object.defineProperty(f.dom.window,'innerHeight',{value:320,configurable:true});Object.defineProperty(f.dom.window,'innerWidth',{value:568,configurable:true});
 const Picker=createComponents(f.rpc).Picker;await act(()=>f.root.render(React.createElement(Picker,{sessionId:'s'})));await f.click('表情');
 const panel=f.panel() as HTMLElement;assert.equal(panel.style.height,'296px');assert.equal(panel.style.top,'12px');
 await f.click(expression.name);assert.equal(f.button('发送所选表情').closest('footer'),null,'发送操作必须独立于可能很长的语义和恢复内容');
 assert.equal(f.button('发送所选表情').parentElement?.parentElement,panel);
});
