import { useText, useUiLocale } from './i18n.js';
import React,{useEffect,useState} from 'react';
import type {PersonalSettings} from '../library-management.js';
import {actGloss,humanActs,localizedText,type Family} from '../protocol/browser.js';
import type {DshRpc,PackSummary} from './contracts.js';
import {Conflict} from './ui.js';
import {FAMILY_LABELS} from './labels.js';
import {setMotionPreference} from './media.js';

const FAMILIES:Family[]=['grounding','steering','progress','epistemic','social'];
/** The amoji.preferences object (RFC §11.6), edited in place. */
export function Preferences({rpc,sessionId}:{rpc:DshRpc;sessionId:string}){
 const t=useText();const locale=useUiLocale();
 const [value,setValue]=useState<PersonalSettings>(),[packs,setPacks]=useState<PackSummary[]>([]),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
 const load=async()=>{try{const loaded=await rpc.management(sessionId,'getSettings',{});setMotionPreference(loaded.reduce_motion);setValue(loaded);if(rpc.packs)setPacks(await rpc.packs(sessionId));setError(undefined);}catch(e){setError(e);}};useEffect(()=>{void load();},[]);
 const save=()=>{if(!value)return;setBusy(true);setError(undefined);const {version,...preferences}=value;void rpc.management(sessionId,'updateSettings',{version,preferences}).then(v=>{setMotionPreference(v.reduce_motion);setValue(v);setStatus('偏好已保存');}).catch(setError).finally(()=>setBusy(false));};
 const ai=value?.ai_expressions;
 const ordered=value?[...packs].sort((a,b)=>{const i=(id:string)=>{const n=value.preferred_packs.indexOf(id);return n<0?99:n;};return i(a.pack_id)-i(b.pack_id);}):[];
 const move=(id:string,delta:number)=>{if(!value)return;const ids=ordered.map(p=>p.pack_id);const index=ids.indexOf(id);const next=index+delta;if(next<0||next>=ids.length)return;[ids[index],ids[next]]=[ids[next]!,ids[index]!];setValue({...value,preferred_packs:ids});};
 const toggleQuick=(act:string)=>{if(!value)return;const has=value.quick_entries.includes(act);const next=has?value.quick_entries.filter(a=>a!==act):[...value.quick_entries,act];if(!next.length||next.length>8)return;setValue({...value,quick_entries:next});};
 return <section className="stack amoji-settings"><h3>{t("让 AI 怎样使用表情")}</h3><p>{t("偏好在共享库的所有会话生效，只影响显示和发送规则，不改变已发送的消息。")}</p>{value&&ai&&<>
  <label><span><input type="checkbox" disabled={busy} checked={ai.enabled} onChange={e=>setValue({...value,ai_expressions:{...ai,enabled:e.target.checked}})}/> {t("允许 AI 发表情")}</span></label>
  <label>{t("每次回答最多")}<select disabled={busy||!ai.enabled} aria-label={t("每次回答最多")} value={ai.max_per_window} onChange={e=>setValue({...value,ai_expressions:{...ai,max_per_window:Number(e.target.value)}})}>{[0,1,2,3].map(n=><option key={n} value={n}>{t('{count} 条',{count:n})}</option>)}</select></label>
  <fieldset><legend>{t("AI 可以发的类别")}</legend>{FAMILIES.map(f=><label key={f}><span><input type="checkbox" disabled={busy||!ai.enabled} checked={ai.families[f]} onChange={e=>setValue({...value,ai_expressions:{...ai,families:{...ai.families,[f]:e.target.checked}}})}/> {t(FAMILY_LABELS[f])}</span></label>)}</fieldset>
  {!!ordered.length&&<fieldset><legend>{t("表情包优先顺序")}</legend><p className="muted">{t("AI 按码位表达时，优先使用排在前面的表情包。")}</p>{ordered.map((p,i)=><div className="row" key={p.pack_id}><span>{i+1}. {localizedText(p.name,locale,p.original_locale)}</span><button className="quiet" type="button" disabled={busy||i===0} aria-label={t("上移")} onClick={()=>move(p.pack_id,-1)}>↑</button><button className="quiet" type="button" disabled={busy||i===ordered.length-1} aria-label={t("下移")} onClick={()=>move(p.pack_id,1)}>↓</button></div>)}</fieldset>}
  <fieldset><legend>{t("快捷入口（最多 8 个，前 4 个默认显示）")}</legend>{humanActs().map(entry=><label key={entry.act}><span><input type="checkbox" disabled={busy} checked={value.quick_entries.includes(entry.act)} onChange={()=>toggleQuick(entry.act)}/> {actGloss(entry.act,'h2a',locale).text}</span></label>)}</fieldset>
  <label>{t("动态效果")}<select disabled={busy} aria-label={t("动态效果")} value={value.reduce_motion} onChange={e=>setValue({...value,reduce_motion:e.target.value as PersonalSettings['reduce_motion']})}><option value="system">{t("跟随系统")}</option><option value="on">{t("减少动态效果")}</option><option value="off">{t("正常播放")}</option></select></label>
  <button className="primary" type="button" disabled={busy} onClick={save}>{t("保存偏好")}</button></>}
  <Conflict error={error}/>{(error as {current?:PersonalSettings})?.current&&<div className="row"><button type="button" onClick={()=>void load()}>{t("读取当前偏好并替换输入")}</button><button type="button" onClick={()=>{setValue(v=>v?{...v,version:(error as {current:PersonalSettings}).current.version}:v);setError(undefined);}}>{t("保留本次输入，继续编辑")}</button></div>}<p role="status">{t(status)}</p>
 </section>;
}
