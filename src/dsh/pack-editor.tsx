import React,{useEffect,useRef,useState} from 'react';
import type {Binding,ConflictGroup,Effect,Expression,ExpressionRef,Pack} from '../protocol/browser.js';
import {REGISTRY,actGloss,expressionText,localizedText} from '../protocol/browser.js';
import type {PackDraft} from '../library-store.js';
import type {DshRpc} from './contracts.js';
import {useText,useUiLocale} from './i18n.js';
import {Conflict} from './ui.js';
import {AmojiImage} from './media.js';

// Keep unsaved input across manager remounts; durable recovery uses the explicit save operation.
const inputs=new Map<string,Pack>();
const GROUPS:ConflictGroup[]=['explanation','response-organization','completion-report','handoff'];
/** Locales every expression in the pack can be read in (RFC §9.1: pack locales must be complete). */
function sharedLocales(expressions:Expression[]):string[]{
 if(!expressions.length)return[];
 return Object.keys(expressions[0]!.semantics).filter(l=>expressions.every(e=>e.semantics[l]&&e.name[l]!==undefined));
}
const fill=(value:Record<string,string>,locales:string[],seed:string)=>Object.fromEntries(locales.map(l=>[l,value[l]??seed]));
const sameRef=(a:ExpressionRef,b:ExpressionRef)=>a.asset_id===b.asset_id&&a.revision_id===b.revision_id;

/** Edits one pack draft (RFC §9): localized name/description, optional effects and their bindings. */
export function PackEditor({rpc,sessionId,refs,refreshEpoch}:{refreshEpoch?:number;rpc:DshRpc;sessionId:string;refs:ExpressionRef[]}){
 const t=useText();const ui=useUiLocale();
 const [drafts,setDrafts]=useState<PackDraft[]>([]),[packs,setPacks]=useState<Pack[]>([]),[draft,setDraft]=useState<PackDraft>(),[value,setValue]=useState<Pack>(),[preview,setPreview]=useState<Pack>(),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[status,setStatus]=useState(''),[download,setDownload]=useState<string>();
 const link=useRef<HTMLAnchorElement>(null);
 const load=()=>Promise.all([rpc.management(sessionId,'listPackDrafts',{}),rpc.management(sessionId,'listPacks',{})]);
 const refresh=async()=>{const [d,p]=await load();setDrafts(d);setPacks(p);};
 useEffect(()=>{let live=true;load().then(([d,p])=>{if(live){setDrafts(d);setPacks(p);}}).catch(e=>{if(live)setError(e);});return()=>{live=false;};},[rpc,sessionId,refreshEpoch]);
 useEffect(()=>{if(!download)return;link.current?.click();return()=>URL.revokeObjectURL(download);},[download]);
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError(undefined);try{await fn();}catch(e){setError(e);}finally{setBusy(false);}};
 const open=(d:PackDraft)=>{setDraft(d);setValue(inputs.get(d.draft_id)??d.manifest);setPreview(undefined);setStatus('');};
 const edit=(next:Pack)=>{setValue(next);if(draft)inputs.set(draft.draft_id,next);setPreview(undefined);setStatus('');};
 const save=async()=>{if(!draft||!value)throw new Error('DRAFT_NOT_FOUND');const d=await rpc.management(sessionId,'savePackDraft',{draft_id:draft.draft_id,version:draft.version,manifest:value});setDraft(d);setValue(d.manifest);inputs.delete(d.draft_id);await refresh();setStatus('表情包草稿已保存');return d;};
 const title=(p:Pack)=>localizedText(p.name,ui,p.original_locale);
 const exportSaved=async(p:Pack,withoutEffects:boolean)=>{const blob=await rpc.exportRelease!(sessionId,p.release_id,withoutEffects);if(!blob.size)throw new Error('PACK_INVALID');setDownload(URL.createObjectURL(blob));setStatus('表情包已生成，可下载保存');};
 const available=value?sharedLocales(value.expressions):[];
 const setLocales=(locales:string[])=>{if(!value||!locales.length)return;const original=locales.includes(value.original_locale)?value.original_locale:locales[0]!;const effects=value.effects?.map(e=>({...e,title:fill(e.title,locales,''),summary:fill(e.summary,locales,''),...(e.kind==='context'?{instruction:fill(e.instruction,locales,'')}:{})}) as Effect);edit({...value,locales,original_locale:original,name:fill(value.name,locales,''),description:fill(value.description,locales,''),...(effects?{effects}:{})});};
 const addEffect=(kind:'context'|'response-organization@1'|'completion-self-check@1')=>{if(!value)return;const text=(s:string)=>Object.fromEntries(value.locales.map(l=>[l,l===value.original_locale?s:'']));const base={effect_id:crypto.randomUUID(),effect_revision_id:crypto.randomUUID(),title:text(t('协作效果')),summary:text(t('说明协作效果'))};const effect:Effect=kind==='context'?{...base,kind:'context',conflict_group:'explanation',instruction:text(t('请说明依据。'))}:kind==='response-organization@1'?{...base,kind:'template',template:kind,config:{layout:'answer-first'}}:{...base,kind:'template',template:kind,config:{evidence:'required',unknowns:'explicit'}};edit({...value,effects:[...(value.effects??[]),effect]});};
 const changeEffect=(i:number,e:Effect)=>{if(value)edit({...value,effects:value.effects!.map((old,index)=>i===index?e:old)});};
 const removeEffect=(i:number)=>{if(!value)return;const gone=value.effects![i]!.effect_id;const effects=value.effects!.filter((_,index)=>index!==i);const bindings=(value.bindings??[]).map(b=>({...b,effects:b.effects.filter(id=>id!==gone)})).filter(b=>b.effects.length);const next:Pack={...value};if(effects.length)next.effects=effects;else delete next.effects;if(bindings.length)next.bindings=bindings;else delete next.bindings;edit(next);};
 const targetKey=(b:Binding)=>'act' in b.target?`act:${b.target.act}`:`ref:${b.target.asset_id}:${b.target.revision_id}`;
 const toggleBinding=(target:Binding['target'],effectId:string)=>{if(!value)return;const key=targetKey({target,effects:[]});const bindings=[...(value.bindings??[])];const index=bindings.findIndex(b=>targetKey(b)===key);const current=index<0?undefined:bindings[index]!;const has=!!current?.effects.includes(effectId);const effects=has?current!.effects.filter(id=>id!==effectId):[...(current?.effects??[]),effectId];if(index>=0)bindings.splice(index,1);if(effects.length)bindings.push({target,effects});const next:Pack={...value};if(bindings.length)next.bindings=bindings;else delete next.bindings;edit(next);};
 const bound=(target:Binding['target'],effectId:string)=>!!value?.bindings?.find(b=>targetKey(b)===targetKey({target,effects:[]}))?.effects.includes(effectId);
 const acts=value?[...new Set(value.expressions.map(e=>e.realizes))]:[];
 const localeInputs=(label:string,map:Record<string,string>,onChange:(next:Record<string,string>)=>void,multiline=false)=>value!.locales.map(l=><label key={l}>{t(label)} · {l}{multiline?<textarea aria-label={`${t(label)} ${l}`} value={map[l]??''} onInput={e=>onChange({...map,[l]:e.currentTarget.value})}/>:<input aria-label={`${t(label)} ${l}`} value={map[l]??''} onInput={e=>onChange({...map,[l]:e.currentTarget.value})}/>}</label>);
 return <section className="stack"><h3>{t('表情包与可选效果')}</h3><p>{t('协作效果与表情语义分开保存。表情包可以不含效果；安装不会启用效果。')}</p>
 <button type="button" disabled={busy||!refs.length} onClick={()=>void run(async()=>{open(await rpc.management(sessionId,'createPackDraft',{refs:refs.map(r=>({asset_id:r.asset_id,revision_id:r.revision_id})),name:t('我的表情包')}));await refresh();})}>{t('用所选表情创建表情包')}</button>
 {drafts.filter(d=>!d.saved).map(d=><div key={d.draft_id}>{title(d.manifest)} <button type="button" disabled={busy} onClick={()=>void run(async()=>open(await rpc.management(sessionId,'getPackDraft',{draft_id:d.draft_id})))}>{t('继续编辑表情包草稿')}</button></div>)}
 {draft&&value&&!draft.saved&&<fieldset disabled={busy} className="stack"><legend>{t('编辑表情包草稿')}</legend>
  <fieldset><legend>{t('包的语言')}</legend><p className="muted">{t('只能选择包内每个表情都已提供的语言。')}</p>{available.map(l=><label key={l}><span><input type="checkbox" checked={value.locales.includes(l)} disabled={value.locales.length===1&&value.locales.includes(l)} onChange={e=>setLocales(e.currentTarget.checked?[...value.locales,l]:value.locales.filter(x=>x!==l))}/> {l}{l===value.original_locale?` · ${t('原文')}`:''}</span></label>)}</fieldset>
  {localeInputs('表情包名称',value.name,name=>edit({...value,name}))}
  {localeInputs('表情包说明',value.description,description=>edit({...value,description}),true)}
  <label>{t('包许可')}<input aria-label={t('包许可')} value={value.rights.license} onInput={e=>edit({...value,rights:{...value.rights,license:e.currentTarget.value}})}/></label>
  <label>{t('许可来源')}<input aria-label={t('许可来源')} value={value.rights.source??''} onInput={e=>{const{source,...rights}=value.rights;edit({...value,rights:e.currentTarget.value?{...rights,source:e.currentTarget.value}:rights});}}/></label>
  <div className="row"><button type="button" disabled={(value.effects?.length??0)>=16} onClick={()=>addEffect('context')}>{t('添加上下文提示')}</button><button type="button" disabled={(value.effects?.length??0)>=16} onClick={()=>addEffect('response-organization@1')}>{t('添加回答组织习惯')}</button><button type="button" disabled={(value.effects?.length??0)>=16} onClick={()=>addEffect('completion-self-check@1')}>{t('添加完成自检习惯')}</button></div>
  {value.effects?.map((e,i)=><fieldset key={e.effect_id} className="stack"><legend>{e.kind==='context'?t('上下文提示'):e.template==='response-organization@1'?t('回答组织习惯'):t('完成自检习惯')}</legend>
   {localeInputs('效果名称',e.title,title=>changeEffect(i,{...e,title}))}
   {localeInputs('效果说明',e.summary,summary=>changeEffect(i,{...e,summary}))}
   {e.kind==='context'?<>{localeInputs('提示内容',e.instruction,instruction=>changeEffect(i,{...e,instruction}),true)}<label>{t('偏好类别')}<select aria-label={t('偏好类别')} value={e.conflict_group} onChange={x=>changeEffect(i,{...e,conflict_group:x.target.value as ConflictGroup})}>{GROUPS.map(g=><option key={g} value={g}>{t(g)}</option>)}</select></label></>:e.template==='response-organization@1'?<label>{t('回答布局')}<select aria-label={t('回答布局')} value={e.config.layout} onChange={x=>changeEffect(i,{...e,config:{layout:x.target.value as typeof e.config.layout}})}>{['answer-first','concise','example-first'].map(l=><option key={l} value={l}>{t(l)}</option>)}</select></label>:<p>{t('完成时报告验证依据，并明确未知事项。')}</p>}
   <p>{t('可选绑定（不勾选则作为包级习惯）')}</p>
   <div className="row">{acts.map(act=><label key={act}><input type="checkbox" checked={bound({act},e.effect_id)} onChange={()=>toggleBinding({act},e.effect_id)}/>{t('所有“{name}”',{name:actGloss(act,REGISTRY.acts.find(a=>a.act===act)?.forms.h2a?'h2a':'a2h',ui).text})}</label>)}</div>
   <div className="row">{value.expressions.map(x=>{const target={asset_id:x.asset_id,revision_id:x.revision_id};return <label key={x.revision_id}><input type="checkbox" checked={bound(target,e.effect_id)} onChange={()=>toggleBinding(target,e.effect_id)}/>{expressionText(x,ui).name}</label>;})}</div>
   <button type="button" onClick={()=>removeEffect(i)}>{t('移除此效果')}</button></fieldset>)}
  <div className="row"><button type="button" onClick={()=>void run(async()=>{await save();})}>{t('保存表情包草稿')}</button><button type="button" onClick={()=>void run(async()=>{const d=await save();setPreview(await rpc.management(sessionId,'previewPackDraft',{draft_id:d.draft_id,version:d.version}));})}>{t('预览表情包')}</button></div>
  {preview&&<section aria-label={t('表情包预览')}><h4>{title(preview)}</h4><p>{preview.locales.join(' · ')} · {preview.rights.license}</p><p>{localizedText(preview.description,ui,preview.original_locale)}</p>{preview.expressions.map(e=>{const text=expressionText(e,ui);return <div key={e.revision_id}><AmojiImage rpc={rpc} sessionId={sessionId} refValue={e} thumbnail/><p>{text.name} · {e.realizes} · {text.meaning}</p></div>;})}{preview.effects?.map(e=><p key={e.effect_revision_id}>{localizedText(e.title,ui,preview.original_locale)} · {e.kind==='context'?localizedText(e.instruction,ui,preview.original_locale):e.template}</p>)}<p>{t('导入不会启用效果；表情可独立使用，效果需明确选择。')}</p><button type="button" onClick={()=>void run(async()=>{await rpc.management(sessionId,'confirmPackDraft',{draft_id:draft.draft_id,version:draft.version});setDraft({...draft,saved:true});inputs.delete(draft.draft_id);setPreview(undefined);await refresh();setStatus('表情包已保存');})}>{t('确认保存表情包')}</button></section>}
 </fieldset>}
 {packs.map(p=><article key={p.release_id}><h4>{title(p)}</h4><p>{p.locales.join(' · ')} · v{p.version} · {t('{count} 个表情',{count:p.expressions.length})} · {t('{count} 个可选效果',{count:p.effects?.length??0})}</p>{rpc.exportRelease&&<><button type="button" disabled={busy} onClick={()=>void run(()=>exportSaved(p,false))}>{t('完整导出')}</button>{!!p.effects?.length&&<button type="button" disabled={busy} onClick={()=>void run(()=>exportSaved(p,true))}>{t('导出（不含效果）')}</button>}</>}</article>)}
 <Conflict error={error}/>{download&&<a ref={link} href={download} download="expressions.amoji">{t('下载表情包')}</a>}<p role="status">{busy?t('正在处理完整包…'):t(status)}</p></section>;
}
