import React,{useEffect,useRef,useState} from 'react';
import type {Draft} from '../drafts.js';
import type {LibraryEntry} from '../library-management.js';
import type {Expression,ExpressionRef} from '../sample-catalog.js';
import type {DshRpc} from './contracts.js';
import {DraftEditor,discardEditor} from './draft-editor.js';
import {LibraryControls} from './library-controls.js';
import {Preferences} from './preferences.js';
import {PackControls} from './pack-controls.js';
import {Conflict,Styles} from './ui.js';
export function Manager({rpc,sessionId,currentSessionId,open,onClose,onChanged}:{rpc:DshRpc;sessionId:string;currentSessionId:string;open:boolean;onClose:()=>void;onChanged:(e?:Expression)=>void}){
 const dialog=useRef<HTMLDialogElement>(null);const [tab,setTab]=useState('library'),[entries,setEntries]=useState<LibraryEntry[]>([]),[drafts,setDrafts]=useState<Draft[]>([]),[draft,setDraft]=useState<Draft>(),[refs,setRefs]=useState<ExpressionRef[]>([]),[error,setError]=useState<unknown>();
 const refresh=async()=>{const [e,d]=await Promise.all([rpc.management(sessionId,'listEntries',{}),rpc.management(sessionId,'listDrafts',{})]);setEntries(e);setDrafts(d);onChanged();};
 useEffect(()=>{void refresh().catch(setError);},[]);
 useEffect(()=>{const el=dialog.current;if(!el)return;if(open){if(el.showModal)el.showModal();else el.setAttribute('open','');}else el.close?.();},[open]);
 const created=(e:Expression)=>{void refresh().catch(setError);onChanged(e);};
 return <dialog ref={dialog} className="amoji amoji-dialog" aria-label="管理表情" onCancel={event=>{event.preventDefault();onClose();}}><Styles/><header className="row toolbar"><div><h2>管理表情</h2><small>共享表情库</small></div><button type="button" onClick={onClose}>返回选择器</button></header>{sessionId!==currentSessionId&&<p role="status">已切换聊天会话。管理内容继续保留；返回选择器后请在当前会话重新选择发送。</p>}<nav className="row tabs" aria-label="管理分类">{[['library','表情库'],['create','创作与草稿'],['preferences','AI 偏好'],['packs','导入与导出']].map(([key,label])=><button key={key} type="button" aria-pressed={tab===key} onClick={()=>setTab(key!)}>{label}</button>)}</nav>
 <div hidden={tab!=='library'}><LibraryControls rpc={rpc} sessionId={sessionId} entries={entries} refresh={refresh} onDraft={d=>{if(draft&&draft.draft_id!==d.draft_id){setError(new Error('当前编辑内容已保留。请先保存并结束当前编辑，再从草稿列表打开新建的编辑草稿。'));void refresh().catch(setError);return;}setDraft(d);setTab('create');}} refs={refs} setRefs={setRefs}/></div>
 <div hidden={tab!=='create'} className="split"><aside className="stack draft-list"><button className="primary" type="button" onClick={()=>{if(draft){setError(new Error('当前草稿仍保留。请先保存，然后在草稿列表切换或新建。'));return;}void rpc.management(sessionId,'createDraft',{}).then(d=>{setDraft(d);setDrafts(v=>[d,...v]);}).catch(setError);}}>新建表情</button><h3>已保存草稿</h3>{drafts.map(d=><button type="button" key={d.draft_id} aria-pressed={draft?.draft_id===d.draft_id} onClick={()=>{if(draft&&draft.draft_id!==d.draft_id){setError(new Error('请先保存当前输入，再点击“结束当前编辑”切换草稿。'));return;}void rpc.management(sessionId,'getDraft',{draft_id:d.draft_id}).then(setDraft).catch(setError);}}>{d.fields.name||'未命名草稿'}</button>)}{draft&&<button type="button" onClick={()=>{if(window.confirm('结束当前编辑？已保存草稿会保留，未保存输入将放弃。')){discardEditor(draft.draft_id);setDraft(undefined);void refresh().catch(setError);}}}>结束当前编辑</button>}</aside>{draft?<DraftEditor key={draft.draft_id} rpc={rpc} sessionId={sessionId} initial={draft} onCreated={created} onSaved={saved=>setDrafts(rows=>rows.some(row=>row.draft_id===saved.draft_id)?rows.map(row=>row.draft_id===saved.draft_id?saved:row):[saved,...rows])}/>:<p>上传一张图片，为它写下固定含义。</p>}</div>
 <div hidden={tab!=='preferences'}><Preferences rpc={rpc} sessionId={sessionId}/></div><div hidden={tab!=='packs'}><PackControls rpc={rpc} sessionId={sessionId} refs={refs} onImported={()=>void refresh().catch(setError)}/></div><Conflict error={error}/></dialog>;
}
