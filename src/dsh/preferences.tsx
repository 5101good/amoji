import { useText } from './i18n.js';
import React,{useEffect,useState} from 'react';
import type {PersonalSettings} from '../library-management.js';
import type {DshRpc} from './contracts.js';
import {Conflict} from './ui.js';

export function Preferences({rpc,sessionId}:{rpc:DshRpc;sessionId:string}){
 const t=useText();
 const [value,setValue]=useState<PersonalSettings>(),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
 const load=async()=>{try{setValue(await rpc.management(sessionId,'getSettings',{}));setError(undefined);}catch(e){setError(e);}};useEffect(()=>{void load();},[]);
 const save=()=>{if(!value)return;setBusy(true);setError(undefined);void rpc.management(sessionId,'updateSettings',{version:value.version,preferences:{style:value.style,frequency:value.frequency,paused:value.paused,appearance:value.appearance}}).then(v=>{setValue(v);setStatus('偏好已保存');}).catch(setError).finally(()=>setBusy(false));};
 return <section className="stack amoji-settings"><h3>{t("让 AI 怎样使用表情")}</h3><p>{t("表情画风与 AI 语气风格是两项独立设置，在共享库的所有会话生效。")}</p>{value&&<>
  <label>{t("表情画风")}<select disabled={busy} aria-label={t("表情画风")} value={value.appearance} onChange={e=>setValue({...value,appearance:e.target.value as PersonalSettings['appearance']})}><option value="classic">{t("经典")}</option><option value="office">{t("办公")}</option></select></label>
  <label>{t("AI 语气风格")}<select disabled={busy} aria-label={t("风格")} value={value.style} onChange={e=>setValue({...value,style:e.target.value as PersonalSettings['style']})}><option value="neutral">{t("自然")}</option><option value="warm">{t("温暖")}</option><option value="playful">{t("活泼")}</option></select></label>
  <label>{t("频率")}<select disabled={busy} aria-label={t("频率")} value={value.frequency} onChange={e=>setValue({...value,frequency:e.target.value as PersonalSettings['frequency']})}><option value="restrained">{t("克制")}</option><option value="moderate">{t("适中")}</option><option value="active">{t("活跃")}</option></select></label>
  <label><span><input type="checkbox" disabled={busy} checked={value.paused} onChange={e=>setValue({...value,paused:e.target.checked})}/> {t("暂停 AI 表情")}</span></label><button className="primary" type="button" disabled={busy} onClick={save}>{t("保存偏好")}</button></>}
  <Conflict error={error}/>{(error as {current?:PersonalSettings})?.current&&<div className="row"><button type="button" onClick={()=>void load()}>{t("读取当前偏好并替换输入")}</button><button type="button" onClick={()=>{setValue(v=>v?{...v,version:(error as {current:PersonalSettings}).current.version}:v);setError(undefined);}}>{t("保留本次输入，继续编辑")}</button></div>}<p role="status">{t(status)}</p>
 </section>;
}
