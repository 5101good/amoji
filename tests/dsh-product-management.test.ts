import { test } from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { SampleCatalog } from '../src/sample-catalog.js';
import { LibraryControls } from '../src/dsh/library-controls.js';
import { Fields } from '../src/dsh/draft-editor.js';
const e=(await SampleCatalog.load(new URL('../assets/samples/',import.meta.url))).all()[0]!;
test('库条目整图选择，详情可关闭，再开仍是同一不可变版本',async t=>{
 const dom=new JSDOM('<div id="root"></div>');const old={window:globalThis.window,document:globalThis.document};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(dom.window.document.getElementById('root')!);t.after(async()=>{await act(()=>root.unmount());Object.assign(globalThis,old);dom.window.close();});
 const rpc:any={management:async(_s:string,m:string)=>m==='revisionVisual'?{expression:e,primary:'data:image/png;base64,AA',poster:null}:[e]};
 await act(async()=>root.render(React.createElement(LibraryControls,{rpc,sessionId:'s',entries:[{expression:e,version:1,archived:false,origin:'builtin'} as any],refresh:async()=>{},onDraft(){},refs:[],setRefs(){}})));
 const image=dom.window.document.querySelector<HTMLImageElement>('img')!;
 assert.ok(image.closest('button'),'点击图片即可选择');
 await act(async()=>image.click());
 const detail=()=>dom.window.document.querySelector('[aria-label="版本与条目操作"]');assert.ok(detail());
 const close=dom.window.document.querySelector<HTMLButtonElement>('[aria-label="关闭详情"]');assert.ok(close);
 assert.ok(dom.window.document.activeElement===close,'详情出现时焦点进入可关闭区域');
 await act(()=>close.click());assert.ok(!detail());assert.ok(dom.window.document.activeElement===image.closest('button'),'关闭详情返回原条目');
 await act(async()=>image.click());assert.equal(dom.window.document.querySelector<HTMLSelectElement>('[aria-label="固定版本"]')!.value,e.revision_id);
});
test('创作优先名称/含义/文字替代，可选定义折叠但仍可编辑',async t=>{
 const dom=new JSDOM('<div id="root"></div>');const old={window:globalThis.window,document:globalThis.document};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});const root=createRoot(dom.window.document.getElementById('root')!);t.after(async()=>{await act(()=>root.unmount());Object.assign(globalThis,old);dom.window.close();});
 await act(()=>root.render(React.createElement(Fields,{value:{name:e.name,semantics:e.semantics,rights:e.rights,tags:[]},onChange(){}})));
 assert.ok(!dom.window.document.querySelector('[aria-label="固定含义"]')!.closest('details'));
 const advanced=dom.window.document.querySelector('[aria-label="语气"]')!.closest('details');assert.ok(advanced,'可选语气不占据主要表单');assert.equal(advanced.open,false);
});
