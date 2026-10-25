import React,{useEffect,useState} from 'react';
import type {DshRpc} from './contracts.js';
import type {RuleChoice,RuleView} from '../conversation-rules.js';
import {ruleConflictGroup} from '../conversation-rules.js';
import {localizedText} from '../protocol/browser.js';
import {useText,useUiLocale} from './i18n.js';
import {errorText} from './media.js';
import {effectRequest} from './effect-text.js';
const ruleStatus = {disabled:'已停用',configured:'已启用，从下一条消息起附上',attached:'已附在最近一条消息上',failed:'没能附上，请刷新后重试',unsupported:'当前客户端不支持'} as const;
const LIMIT=2;
const same=(a:RuleChoice['selection'],b:RuleChoice['selection'])=>a.release_id===b.release_id&&a.effect_id===b.effect_id&&a.effect_revision_id===b.effect_revision_id;
/** Expression effects (RFC "effects"): pack-provided requests to the AI, turned on per conversation or sent once with an expression. */
export function RuleControls({rpc,sessionId}:{rpc:DshRpc;sessionId:string}){
 const t=useText();const locale=useUiLocale();const [state,setState]=useState<RuleView>();const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const refresh=async()=>{if(!rpc.rules){setError(t('当前客户端不支持表情效果'));return;}setState(await rpc.rules(sessionId));};
 useEffect(()=>{let active=true;setState(undefined);if(rpc.rules)void rpc.rules(sessionId).then(v=>{if(active)setState(v);}).catch(e=>{if(active)setError(t(errorText(e)));});return()=>{active=false;};},[sessionId,rpc]);
 const run=async(work:()=>Promise<RuleView>)=>{setBusy(true);setError('');try{setState(await work());}catch(e){setError(t(errorText(e)));await refresh().catch(()=>{});}finally{setBusy(false);}};
 const enabled=state?.rules.filter(r=>r.enabled)??[];
 const isOn=(choice:RuleChoice)=>enabled.some(r=>same(r.selection,choice.selection));
 // Turning on an effect of a kind already on replaces it; the page says so beforehand.
 const sameKind=(choice:RuleChoice)=>enabled.find(r=>ruleConflictGroup(r)===ruleConflictGroup(choice)&&!same(r.selection,choice.selection));
 const title=(choice:RuleChoice)=>localizedText(choice.effect.title,locale,choice.source.original_locale);
 const summary=(choice:RuleChoice)=>effectRequest(choice.effect,locale,choice.source.original_locale,t);
 const technical=(choice:RuleChoice)=><details><summary>{t('技术详情')}</summary><small className="amoji-mono">{choice.effect.kind==='template'?choice.effect.template:choice.effect.conflict_group} · {choice.source.origin} v{choice.source.version} · {choice.source.pack_id} · {choice.source.release_id} · {choice.selection.effect_id} · {choice.selection.effect_revision_id}</small></details>;
 const choices=state?[...state.choices].sort((a,b)=>Number(isOn(b))-Number(isOn(a))):[];
 const example=choices[0];
 const toggle=(choice:RuleChoice)=>{
  if(isOn(choice)){void run(()=>rpc.disableRule!(sessionId,choice.selection,state!.generation));return;}
  const replaced=sameKind(choice);
  void run(()=>rpc.enableRule!(sessionId,choice.selection,state!.generation,replaced?.selection??null));
 };
 return <section className="amoji-effects" aria-label={t('表情效果')}>
 <header className="amoji-section-head"><h3>{t('表情效果')}</h3><p>{t('表情效果是表情包附带的一句给 AI 的要求，用来改变它的回答方式。')}</p>
  {example&&<p className="amoji-effects-example">{t('例如启用「{title}」后，AI 会：{summary}',{title:title(example),summary:summary(example)})}</p>}</header>
 <div role="status" aria-live="polite">{state?.identity==='pending'?t('这个对话的效果状态待恢复：请先全部停用，再重新启用需要的效果。'):error}</div>
 <section className="amoji-effects-group" aria-label={t('对话中持续')}>
  <div className="amoji-effects-group-head"><h4>{t('对话中持续')}</h4><span className="amoji-count">{t('已启用 {count} / {limit}',{count:enabled.length,limit:LIMIT})}</span></div>
  <p className="muted">{t('启用后，你在这个对话里发的每条消息都会附上它。最多同时启用 2 个；同一类只能启用 1 个，启用新的会替换旧的。')}</p>
  {state&&!choices.length&&<p className="amoji-empty">{t('已安装的表情包里还没有表情效果。可以在表情市场找带效果的表情包。')}</p>}
  {choices.map(c=>{const on=isOn(c);const replaced=!on&&sameKind(c);const full=!on&&!replaced&&enabled.length>=LIMIT;const rule=enabled.find(r=>same(r.selection,c.selection));
   return <article key={`${c.selection.release_id}:${c.selection.effect_id}`} className={on?'is-active':undefined}>
    <div className="amoji-effect-row"><div className="amoji-effect-text"><h4>{title(c)}</h4>{summary(c)!==title(c)&&<p>{summary(c)}</p>}</div>
     <button type="button" className={on?'quiet':undefined} aria-pressed={on} disabled={busy||state!.identity!=='ready'||full||!(on?rpc.disableRule:rpc.enableRule)} onClick={()=>toggle(c)}>{on?t('停用'):t('启用')}</button></div>
    {rule&&<p role="status" className="amoji-effect-status">{t(ruleStatus[rule.status])}{rule.reason?` · ${rule.reason}`:''}</p>}
    {replaced&&<small className="muted">{t('会替换已启用的「{title}」',{title:title(replaced)})}</small>}
    {full&&<small className="muted">{t('已启用 2 个，先停用一个')}</small>}
    {technical(c)}
   </article>;})}
  {!!enabled.length&&<div className="row"><button type="button" className="quiet" disabled={busy||!rpc.disableAllRules} onClick={()=>void run(()=>rpc.disableAllRules!(sessionId,state!.generation))}>{t('全部停用')}</button></div>}
 </section>
 <section className="amoji-effects-group" aria-label={t('仅本次')}><h4>{t('仅本次')}</h4><p className="muted">{t('只跟随一条表情消息，对 AI 的下一次回答生效。在选择器里选中带效果的表情，点「带效果发送」。')}</p></section>
 <footer className="amoji-fineprint"><p>{t('表情效果只是给 AI 的建议：不会给它任何额外权限，也不保证每次都照做。停用后从下一条消息起不再附上，已发出的消息不受影响。换对话或重启后需要重新启用。')}</p>
  <div className="row"><button type="button" className="quiet" disabled={busy} onClick={()=>void refresh().catch(e=>setError(t(errorText(e))))}>{t('刷新状态')}</button><small className="muted amoji-mono">{t('当前对话')}: {sessionId}</small></div></footer>
 </section>;
}
