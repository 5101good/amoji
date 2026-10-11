import React,{useEffect,useState} from 'react';
import type {DshRpc} from './contracts.js';
import type {RuleChoice,RuleView} from '../conversation-rules.js';
import {useText} from './i18n.js';
import {errorText} from './media.js';
const ruleStatus = {disabled:'已停用',configured:'已配置，等待触发',attached:'文字已附加，不代表模型遵从',failed:'应用失败',unsupported:'当前宿主不支持'} as const;
export function RuleControls({rpc,sessionId}:{rpc:DshRpc;sessionId:string}){
 const t=useText();const [state,setState]=useState<RuleView>();const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [replacement,setReplacement]=useState<RuleChoice>();
 const refresh=async()=>{if(!rpc.rules){setError(t('当前宿主不支持会话规则'));return;}setState(await rpc.rules(sessionId));};
 useEffect(()=>{let active=true;setState(undefined);setReplacement(undefined);if(rpc.rules)void rpc.rules(sessionId).then(v=>{if(active)setState(v);}).catch(e=>{if(active)setError(t(errorText(e)));});return()=>{active=false;};},[sessionId,rpc]);
 const run=async(work:()=>Promise<RuleView>)=>{setBusy(true);setError('');try{setState(await work());setReplacement(undefined);}catch(e){setError(t(errorText(e)));await refresh().catch(()=>{});}finally{setBusy(false);}};
 const conflict=(choice:RuleChoice)=>state?.rules.find(r=>r.enabled&&r.action.conflict_group===choice.action.conflict_group);
 const title=(choice:RuleChoice)=>t(choice.action.template==='response-organization@1'?'回答组织':'完成自检');
 const provenance=(choice:RuleChoice)=><><p>{t('来源版本')}: {choice.source.origin} · v{choice.source.version}</p><details><summary>{t('技术详情与精确版本')}</summary><p>{choice.action.template} · {choice.source.pack_id} · {choice.source.release_id} · {choice.selection.action_id} · {choice.selection.action_revision_id}</p><pre>{JSON.stringify(choice.action.config)}</pre></details></>;
 const enable=(choice:RuleChoice)=>{if(conflict(choice)){setReplacement(choice);return;}void run(()=>rpc.enableRule!(sessionId,choice.selection,state!.generation,null));};
 return <section aria-label={t('当前会话规则')}><h3>{t('当前会话规则')}</h3><p>{t('仅用于当前会话')}: {sessionId}</p><p>{t('规则是输入时文字指导，不是后台检查或完成认证。停用不删除历史，也不保证模型忘记。')}</p>
 <div role="status" aria-live="polite">{state?.identity==='pending'?t('会话身份待恢复，请先全部停用，再显式启用。'):error}</div>
 <button type="button" disabled={busy} onClick={()=>void refresh().catch(e=>setError(t(errorText(e))))}>{t('刷新规则状态')}</button>
 <button type="button" disabled={busy||!state||!rpc.disableAllRules} onClick={()=>void run(()=>rpc.disableAllRules!(sessionId,state!.generation))}>{t('全部停用')}</button>
 {state?.rules.map(r=><article key={r.action.conflict_group}><h4>{title(r)}</h4><p>{r.action.effect_summary}</p>{provenance(r)}<p role="status">{t(ruleStatus[r.status])}{r.reason?` · ${r.reason}`:''}</p>{r.enabled&&<button type="button" disabled={busy||!rpc.disableRule} onClick={()=>void run(()=>rpc.disableRule!(sessionId,r.selection,state.generation))}>{t('停用此规则')}</button>}</article>)}
 {state?.choices.filter(c=>!state.rules.some(r=>r.enabled&&r.selection.action_id===c.selection.action_id&&r.selection.action_revision_id===c.selection.action_revision_id&&r.selection.release_id===c.selection.release_id)).map(c=><article key={`${c.selection.release_id}:${c.selection.action_id}`}><h4>{title(c)}</h4><p>{c.action.effect_summary}</p>{provenance(c)}<button type="button" disabled={busy||state.identity!=='ready'||!rpc.enableRule} onClick={()=>enable(c)}>{t('启用此规则')}</button></article>)}
 {replacement&&<div role="group" aria-label={t('替换同组规则')}><p>{t('替换同组规则')}: {conflict(replacement)?.selection.action_revision_id} → {replacement.selection.action_revision_id}</p><button type="button" disabled={busy} onClick={()=>void run(()=>rpc.enableRule!(sessionId,replacement.selection,state!.generation,conflict(replacement)!.selection))}>{t('确认替换')}</button><button type="button" onClick={()=>setReplacement(undefined)}>{t('取消替换')}</button></div>}
 </section>;
}
