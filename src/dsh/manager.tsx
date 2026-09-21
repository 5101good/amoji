import { useText } from './i18n.js';
import React,{useEffect,useRef,useState} from 'react';
import type {Draft} from '../drafts.js';
import type {LibraryEntry} from '../library-management.js';
import type {Expression,ExpressionRef} from '../sample-catalog.js';
import type {DshRpc} from './contracts.js';
import {DraftEditor,discardEditor} from './draft-editor.js';
import {LibraryControls} from './library-controls.js';
import {Preferences} from './preferences.js';
import {PackControls} from './pack-controls.js';
import {Conflict,Styles,CloseIcon} from './ui.js';
export function Manager({rpc,sessionId,currentSessionId,open,onClose,onChanged}:{rpc:DshRpc;sessionId:string;currentSessionId:string;open:boolean;onClose:()=>void;onChanged:(e?:Expression)=>void}){
 const t=useText();
 const dialog=useRef<HTMLDialogElement>(null);const [tab,setTab]=useState('library'),[entries,setEntries]=useState<LibraryEntry[]>([]),[drafts,setDrafts]=useState<Draft[]>([]),[draft,setDraft]=useState<Draft>(),[refs,setRefs]=useState<ExpressionRef[]>([]),[error,setError]=useState<unknown>();
 const refresh=async()=>{const [e,d]=await Promise.all([rpc.management(sessionId,'listEntries',{}),rpc.management(sessionId,'listDrafts',{})]);setEntries(e);setDrafts(d);onChanged();};
 useEffect(()=>{void refresh().catch(setError);},[]);
 useEffect(()=>{const el=dialog.current;if(!el)return;if(open){if(el.showModal)el.showModal();else el.setAttribute('open','');}else el.close?.();},[open]);
 const created=(e:Expression)=>{setDraft(current=>current?{...current,confirmed:e}:current);void refresh().catch(setError);onChanged(e);};
 return <dialog ref={dialog} className="amoji amoji-dialog amoji-manager" aria-label={t("管理表情")} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===dialog.current){const r=dialog.current.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)onClose();}}}><Styles/>
 <header className="amoji-manager-head"><div><h2>{t("管理表情")}</h2><p className="muted">{t("让每一张图，都有你想表达的意思。")}</p></div><button className="icon-button" type="button" aria-label={t("返回选择器")} onClick={onClose}><CloseIcon/></button></header>
 {sessionId!==currentSessionId&&<p className="amoji-notice" role="status">{t("已切换聊天会话。草稿继续保留，返回后可在当前会话选表情。")}</p>}
 <div className="amoji-manager-layout"><nav className="amoji-manager-nav" aria-label={t("管理分类")}>{[['library',t("表情库")],['create',t("创作与草稿")],['preferences',t("AI 偏好")],['packs',t("导入与导出")]].map(([key,label])=><button key={key} type="button" aria-pressed={tab===key} onClick={()=>{setTab(key!);setError(undefined);}}>{label}</button>)}<div className="amoji-nav-bottom">{rpc.reconnect&&<button className="quiet" type="button" onClick={()=>void rpc.reconnect!(sessionId).then(refresh).then(()=>setError(undefined)).catch(setError)}>{t("重新连接共享库")}</button>}<a href="https://github.com/5101good/amoji" target="_blank" rel="noopener noreferrer" aria-label={t("在 GitHub 上查看 Amoji")} style={{display:"block",fontSize:11,color:"var(--amoji-muted)",padding:"8px 12px"}}>GitHub ↗</a></div></nav><main className="amoji-manager-content">

 <div hidden={tab!=='library'}><LibraryControls rpc={rpc} sessionId={sessionId} entries={entries} refresh={refresh} onDraft={d=>{if(draft&&!draft.confirmed&&draft.draft_id!==d.draft_id){setError(new Error('当前编辑内容已保留。请先保存并结束当前编辑，再从草稿列表打开新建的编辑草稿。'));void refresh().catch(setError);return;}setDraft(d);setTab('create');}} refs={refs} setRefs={setRefs}/></div>
 <div hidden={tab!=='create'} className="amoji-create-page"><aside className="amoji-draft-switcher"><button type="button" onClick={()=>{setError(undefined);void rpc.management(sessionId,'createDraft',{}).then(d=>{setDraft(d);setDrafts(v=>[d,...v]);}).catch(setError);}}>{t("新建表情")}</button><label><span>{t("草稿")}</span><select aria-label={t("选择草稿")} value={draft?.draft_id??''} onChange={event=>{const id=event.currentTarget.value;if(!id)return;setError(undefined);void rpc.management(sessionId,'getDraft',{draft_id:id}).then(setDraft).catch(setError);}}><option value="">{t('选择已保存草稿（{count}）',{count:drafts.length})}</option>{drafts.map(d=><option key={d.draft_id} value={d.draft_id}>{d.fields.name||t("未命名草稿")}</option>)}</select></label>{draft&&<button type="button" aria-label={t("结束当前编辑")} onClick={()=>{if(draft.confirmed||window.confirm(t('结束当前编辑？已保存草稿会保留，未保存输入将放弃。'))){discardEditor(draft.draft_id);setDraft(undefined);void refresh().catch(setError);}}}>{t("关闭编辑")}</button>}</aside>{draft?<DraftEditor key={draft.draft_id} rpc={rpc} sessionId={sessionId} initial={draft} onCreated={created} onSaved={saved=>setDrafts(rows=>rows.some(row=>row.draft_id===saved.draft_id)?rows.map(row=>row.draft_id===saved.draft_id?saved:row):[saved,...rows])}/>:<div className="amoji-create-empty"><h3>{t("把你的表达，做成表情。")}</h3><p>{t("从一句想说的话开始，让 AI 帮你整理成表情含义。")}</p><p className="muted">{t("选择上方草稿继续，或新建一个表情。")}</p></div>}</div>
 <div hidden={tab!=='preferences'}><Preferences rpc={rpc} sessionId={sessionId}/></div><div hidden={tab!=='packs'}><PackControls rpc={rpc} sessionId={sessionId} refs={refs} onImported={()=>void refresh().catch(setError)}/></div><Conflict error={error}/></main></div></dialog>;
}
