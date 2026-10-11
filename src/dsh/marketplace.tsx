import React,{useEffect,useRef,useState} from 'react';
import type { DshRpc } from './contracts.js';
import type { Expression } from '../sample-catalog.js';
import type { MarketRelease,MarketOperation } from '../local-acquisition.js';
import { useText } from './i18n.js';
const refOf=(e:Expression)=>({asset_id:e.asset_id,revision_id:e.revision_id});
function PreviewImage({rpc,sessionId,release,expression}:{rpc:DshRpc;sessionId:string;release:MarketRelease;expression:Expression}){
 const [src,setSrc]=useState('');useEffect(()=>{let live=true;setSrc('');void rpc.marketplace!(sessionId,'visual',{pack_id:release.pack_id,release_id:release.release_id,digest:expression.visual.primary.sha256}).then(v=>{if(live)setSrc(v);}).catch(()=>{});return()=>{live=false;};},[rpc,sessionId,release.release_id,expression.revision_id]);
 return src?<img src={src} alt={expression.semantics.fallback} width={96} height={96} style={{objectFit:'contain'}} onError={()=>setSrc('')}/>:<p>{expression.semantics.fallback}</p>;
}
export function Marketplace({rpc,sessionId,onChanged}:{rpc:DshRpc;sessionId:string;onChanged:()=>void}){
 const t=useText();const [query,setQuery]=useState(''),[rows,setRows]=useState<any[]>([]),[release,setRelease]=useState<MarketRelease>(),[local,setLocal]=useState<any>({installs:[],collections:[]}),[checked,setChecked]=useState(''),[stale,setStale]=useState(false),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[diff,setDiff]=useState<any>(),[pending,setPending]=useState<string>(()=>sessionStorage.getItem('amoji-market-operation')??'');
 const sendKey='amoji-market-send:'+sessionId;
 const [sendPending,setSendPending]=useState<{requestId:string;ref:import('../sample-catalog.js').ExpressionRef}|undefined>(()=>{try{return JSON.parse(sessionStorage.getItem(sendKey)??'null')??undefined;}catch{return undefined;}});
 const [sent,setSent]=useState<import('./contracts.js').HistoryEntry>();
 const live=useRef(true);useEffect(()=>()=>{live.current=false;},[]);
 const call=(method:string,args:unknown)=>rpc.marketplace!(sessionId,method,args);
 const refresh=async()=>{const value=await call('local',{});if(live.current)setLocal(value);onChanged();};
 const run=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setStatus('');try{await fn();}catch(e){if(live.current)setStatus((e as {code?:string}).code??'MARKET_UNAVAILABLE');}finally{if(live.current)setBusy(false);}};
 const search=async()=>{const value=await call('search',{query});if(live.current){setRows(value.packs);setChecked(value.last_checked_at);setStale(value.stale);}};
 useEffect(()=>{void run(async()=>{await refresh();await search();});},[]);
 const show=async(pack_id:string,release_id?:string)=>{const value=await call('detail',{pack_id,...(release_id?{release_id}:{})});if(live.current){setRelease(value);setChecked(value.last_checked_at);setDiff(undefined);}};
 const settle=async(operation:MarketOperation)=>{if(operation.status==='pending'){setStatus('安装结果待核对');return;}sessionStorage.removeItem('amoji-market-operation');setPending('');setStatus(operation.status==='committed'?'已保存到本地库':operation.error??'MARKET_UNAVAILABLE');await refresh();};
 const acquire=async(expression?:Expression)=>{if(!release||pending)return;const operation_id=crypto.randomUUID();sessionStorage.setItem('amoji-market-operation',operation_id);setPending(operation_id);try{await settle(await call(expression?'collect':'install',{pack_id:release.pack_id,release_id:release.release_id,operation_id,...(expression?{ref:refOf(expression)}:{})}));}catch(error){setStatus('安装结果待核对');throw error;}};
 const delivery=(row:import('./contracts.js').HistoryEntry)=>{setSent(row);if(row.host?.status==='observed'){sessionStorage.removeItem(sendKey);setSendPending(undefined);setStatus('已发送固定语义');}else setStatus('投递结果待核对');};
 const checkSend=async()=>{if(sent){const row=(await rpc.history(sessionId)).find(r=>r.message.message_id===sent.message.message_id);if(row)delivery(row);}else if(sendPending)delivery(await rpc.submit(sessionId,sendPending.ref,sendPending.requestId));};
 useEffect(()=>{if(!sent||sent.host?.status==='observed')return;let attempts=20;const timer=setInterval(()=>{if(attempts-->0)void checkSend().catch(()=>{});else clearInterval(timer);},1500);return()=>clearInterval(timer);},[sent]);
 const send=async(expression:Expression)=>{if(sendPending)return;const identity={ref:refOf(expression),requestId:crypto.randomUUID()};sessionStorage.setItem(sendKey,JSON.stringify(identity));setSendPending(identity);delivery(await rpc.submit(sessionId,identity.ref,identity.requestId));};
 if(!rpc.marketplace)return <p>{t('市场能力不可用')}</p>;
 return <section aria-label={t('表情市场')} aria-busy={busy}>
 <h3>{t('表情市场')}</h3><p>{t('匿名获取，安装后离线可用。动作需另行启用。')}</p>
 <form onSubmit={e=>{e.preventDefault();void run(search);}}><label>{t('搜索市场')}<input value={query} onChange={e=>setQuery(e.target.value)}/></label><button disabled={busy} type="submit">{t('搜索')}</button></form>
 {checked&&<p className="muted">{t('上次核对')} {checked} {stale&&t('离线缓存，发布状态可能滞后')}</p>}
 <p role="status" aria-live="polite">{t(status)}</p>{sendPending&&<button type="button" disabled={busy} onClick={()=>void run(checkSend)}>{t('核对投递状态')}</button>}{pending&&<button disabled={busy} type="button" onClick={()=>void run(async()=>settle(await call('installStatus',{operation_id:pending})))}>{t('核对原安装操作')}</button>}
 <div className="row">{rows.map(row=><button type="button" disabled={busy} key={row.release_id} onClick={()=>void run(()=>show(row.pack_id,row.release_id))}>{row.manifest.name} · v{row.manifest.version}</button>)}</div>
 {release&&<article><h4>{release.manifest.name} · v{release.manifest.version}</h4><p>{release.manifest.scenario.join(' · ')}</p><p>{release.manifest.rights.license}</p><small>{release.release_id}</small>
 <p>{t('能力预览')}：{release.manifest.actions.length?release.manifest.actions.map(a=>a.effect_summary).join(' · '):t('仅表达')} · {t('动作默认未启用')}</p>
 {release.manifest.expressions.map(e=><div key={e.revision_id}><PreviewImage rpc={rpc} sessionId={sessionId} release={release} expression={e}/><strong>{e.name}</strong><p>{e.semantics.meaning}</p><small>{e.rights.license} · {e.revision_id}</small><div className="row"><button type="button" disabled={busy||!!pending} onClick={()=>void run(()=>acquire(e))}>{t('独立收藏')}</button>{(local.collections.some((c:any)=>c.ref.revision_id===e.revision_id)||local.installs.some((i:any)=>i.refs.some((r:any)=>r.revision_id===e.revision_id)))&&<button type="button" disabled={busy||!!sendPending} onClick={()=>void run(()=>send(e))}>{t('仅发送')}</button>}</div></div>)}
 <button type="button" disabled={busy||!!pending} onClick={()=>void run(()=>acquire())}>{t('安装此版本')}</button>
 </article>}
 {diff&&<section><h4>{t('更新差异')}</h4><p>{t('采用后旧规则停用，新动作默认未启用。')}</p><details open><summary>{t('固定语义')}</summary>{(['before','after'] as const).map(side=><section key={side}><h5>{t(side==='before'?'原版本':'新版本')}</h5>{diff.semantics[side].map((e:any,i:number)=><p key={i}><strong>{e.name}</strong>：{e.semantics.meaning}<br/>{e.semantics.fallback}</p>)}</section>)}</details><details><summary>{t('协作动作')}</summary>{(['before','after'] as const).map(side=><section key={side}><h5>{t(side==='before'?'原版本':'新版本')}</h5>{diff.actions[side].map((a:any)=><p key={a.action_revision_id}><strong>{a.effect_summary}</strong><br/>{a.instruction??JSON.stringify(a.config)} · {a.scope}<br/><small>{a.action_revision_id}</small></p>)}</section>)}</details><button type="button" disabled={busy||!!pending||!diff.changed} onClick={()=>void run(()=>acquire())}>{t('采用新版本')}</button></section>}
 <h4>{t('已安装场景包')}</h4>{local.installs.map((i:any)=><div key={i.release_id}><span>{i.manifest.name} · v{i.manifest.version}</span><div className="row"><button type="button" disabled={busy} onClick={()=>void run(async()=>{const d=await call('updateCheck',{pack_id:i.manifest.pack_id});setRelease(d.next);setDiff(d);})}>{t('检查更新')}</button><button type="button" disabled={busy} onClick={()=>void run(async()=>{await call('remove',{pack_id:i.manifest.pack_id});await refresh();})}>{t('移除包')}</button></div></div>)}
 <h4>{t('独立收藏')}</h4>{local.collections.map((c:any)=><div key={c.ref.asset_id+':'+c.ref.revision_id}><small>{c.ref.revision_id} · {c.source.rights?.license}</small><button type="button" disabled={busy} onClick={()=>void run(async()=>{await call('uncollect',{ref:c.ref});await refresh();})}>{t('取消收藏')}</button></div>)}
 </section>;
}
