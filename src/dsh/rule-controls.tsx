import React,{useEffect,useState} from 'react';
import type {DshRpc} from './contracts.js';
import type {RuleChoice,RuleView} from '../conversation-rules.js';
import {ruleConflictGroup} from '../conversation-rules.js';
import {localizedText} from '../protocol/browser.js';
import {useText,useUiLocale} from './i18n.js';
import {errorText} from './media.js';
const ruleStatus = {disabled:'已停用',configured:'已配置，等待触发',attached:'文字已附加，不代表模型遵从',failed:'应用失败',unsupported:'当前宿主不支持'} as const;
const same=(a:RuleChoice['selection'],b:RuleChoice['selection'])=>a.release_id===b.release_id&&a.effect_id===b.effect_id&&a.effect_revision_id===b.effect_revision_id;
export function RuleControls({rpc,sessionId}:{rpc:DshRpc;sessionId:string}){
 const t=useText();const locale=useUiLocale();const [state,setState]=useState<RuleView>();const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [replacement,setReplacement]=useState<RuleChoice>();
 const refresh=async()=>{if(!rpc.rules){setError(t('当前宿主不支持会话规则'));return;}setState(await rpc.rules(sessionId));};
 useEffect(()=>{let active=true;setState(undefined);setReplacement(undefined);if(rpc.rules)void rpc.rules(sessionId).then(v=>{if(active)setState(v);}).catch(e=>{if(active)setError(t(errorText(e)));});return()=>{active=false;};},[sessionId,rpc]);
 const run=async(work:()=>Promise<RuleView>)=>{setBusy(true);setError('');try{setState(await work());setReplacement(undefined);}catch(e){setError(t(errorText(e)));await refresh().catch(()=>{});}finally{setBusy(false);}};
 const conflict=(choice:RuleChoice)=>state?.rules.find(r=>r.enabled&&ruleConflictGroup(r)===ruleConflictGroup(choice));
 const title=(choice:RuleChoice)=>localizedText(choice.effect.title,locale,choice.source.original_locale);
 const summary=(choice:RuleChoice)=>localizedText(choice.effect.summary,locale,choice.source.original_locale);
 const provenance=(choice:RuleChoice)=><><p>{t('来源版本')}: {choice.source.origin} · v{choice.source.version}</p><details><summary>{t('技术详情与精确版本')}</summary><p>{choice.effect.kind==='template'?choice.effect.template:choice.effect.conflict_group} · {choice.source.pack_id} · {choice.source.release_id} · {choice.selection.effect_id} · {choice.selection.effect_revision_id}</p></details></>;
 const enable=(choice:RuleChoice)=>{if(conflict(choice)){setReplacement(choice);return;}void run(()=>rpc.enableRule!(sessionId,choice.selection,state!.generation,null));};
 return <section aria-label={t('当前会话规则')}><h3>{t('当前会话规则')}</h3><p>{t('仅用于当前会话')}: {sessionId}</p><p>{t('规则是输入时文字指导，不是后台检查或完成认证。停用不删除历史，也不保证模型忘记。')}</p>
 <div role="status" aria-live="polite">{state?.identity==='pending'?t('会话身份待恢复，请先全部停用，再显式启用。'):error}</div>
 <button type="button" disabled={busy} onClick={()=>void refresh().catch(e=>setError(t(errorText(e))))}>{t('刷新规则状态')}</button>
 <button type="button" disabled={busy||!state||!rpc.disableAllRules} onClick={()=>void run(()=>rpc.disableAllRules!(sessionId,state!.generation))}>{t('全部停用')}</button>
 {state?.rules.map(r=><article key={ruleConflictGroup(r)}><h4>{title(r)}</h4><p>{summary(r)}</p>{provenance(r)}<p role="status">{t(ruleStatus[r.status])}{r.reason?` · ${r.reason}`:''}</p>{r.enabled&&<button type="button" disabled={busy||!rpc.disableRule} onClick={()=>void run(()=>rpc.disableRule!(sessionId,r.selection,state.generation))}>{t('停用此规则')}</button>}</article>)}
 {state?.choices.filter(c=>!state.rules.some(r=>r.enabled&&same(r.selection,c.selection))).map(c=><article key={`${c.selection.release_id}:${c.selection.effect_id}`}><h4>{title(c)}</h4><p>{summary(c)}</p>{provenance(c)}<button type="button" disabled={busy||state.identity!=='ready'||!rpc.enableRule} onClick={()=>enable(c)}>{t('启用此规则')}</button></article>)}
 {replacement&&<div role="group" aria-label={t('替换同组规则')}><p>{t('替换同组规则')}: {conflict(replacement)&&title(conflict(replacement)!)} → {title(replacement)}</p><button type="button" disabled={busy} onClick={()=>void run(()=>rpc.enableRule!(sessionId,replacement.selection,state!.generation,conflict(replacement)!.selection))}>{t('确认替换')}</button><button type="button" onClick={()=>setReplacement(undefined)}>{t('取消替换')}</button></div>}
 </section>;
}
