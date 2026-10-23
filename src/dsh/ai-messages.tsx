import { useText, useUiLocale } from './i18n.js';
import React, { useEffect, useState } from 'react';
import { actGloss } from '../protocol/browser.js';
import type { StoredMessage } from '../messages.js';
import type {ConversationNodeDefinition} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {ChatConversationViewNode} from '@deepseek-ai/dsh-client-ui-chat/client';
import type {DshRpc,VisualMeta} from './contracts.js';
import {MessageMedia,parseMeta,errorText} from './media.js';
import {Styles} from './ui.js';
/** A separate public event-to-node contribution, anchored after the completed turn.
 * It neither elects a chain occupant nor replaces any host renderer/child slot.
 */
export const aiExpressionDefinition: ConversationNodeDefinition<null> = {
 kind:'amoji-expressions',target:'chat',
 match(event){if(event.type==='turn/start')return{id:String(event.data.turn),role:'start'};if(event.type==='turn/end'||event.type==='tool/result')return{id:String(event.data.turn),role:'update'};return null;},
 start(){return null;},update(){return null;},
 buildViewNode(context){
  const end=[...context.matches].reverse().find(m=>m.event.type==='turn/end');if(!end)return null;
  const found=new Map<string,VisualMeta>();
  for(const match of context.matches){const event=match.event;if(event.type!=='tool/result'||event.surfaceOp!=='append')continue;const result=event.data.message.content[0];if(result?.isError===true)continue;const meta=parseMeta(event.data.meta);if(meta)found.set(meta.messageId,meta);}
  if(!found.size)return null;
  return {key:context.key,kind:'amoji-expressions',id:context.id,target:'chat',anchorSeq:end.event.seq,location:end.location,visibility:'visible',data:[...found.values()]} as ChatConversationViewNode;
 }
};
/** One AI expression: glyph or gloss, the stated reason, and any decision options or quick replies. */
function AiExpression({rpc,sessionId,meta}:{rpc:DshRpc;sessionId:string;meta:VisualMeta}){
 const t=useText();const locale=useUiLocale();
 const [message,setMessage]=useState<StoredMessage>();const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{const abort=new AbortController();void rpc.history(sessionId,abort.signal).then(rows=>{if(!abort.signal.aborted)setMessage(rows.find(r=>r.message.message_id===meta.messageId)?.message);}).catch(()=>{});return()=>abort.abort();},[rpc,sessionId,meta.messageId]);
 const run=(work:()=>Promise<unknown>)=>{setBusy(true);setError('');void work().catch(e=>setError(t(errorText(e)))).finally(()=>setBusy(false));};
 const choose=(option:string)=>run(async()=>{const rows=await rpc.choose!(sessionId,meta.messageId,option);setMessage(rows.find(r=>r.message.message_id===meta.messageId)?.message);});
 const reply=(act:string)=>run(()=>rpc.submit(sessionId,{act,respondsTo:meta.messageId},crypto.randomUUID()));
 return <div className="amoji amoji-message amoji-message-ai" aria-label={t("AI 表情")}><Styles/><MessageMedia rpc={rpc} sessionId={sessionId} meta={meta}/>
  {message?.rationale&&<details className="amoji-message-detail"><summary>{t("AI 为什么发这个")}</summary><p>{message.rationale}</p><small>{t("AI 表示")}</small></details>}
  {message?.options&&<div className="amoji-options" role="group" aria-label={t("需要你选一下")}>{message.options.map(o=><button type="button" key={o.id} aria-pressed={message.choice?.option===o.id} disabled={busy||!!message.choice||!rpc.choose} onClick={()=>choose(o.id)}>{o.label}</button>)}<small className="muted">{message.choice?t('已选择：{label}',{label:message.choice.label}):t("选择只表达你的偏好，不是批准；也可以直接用文字回答。")}</small></div>}
  {!!message?.replies?.length&&<div className="amoji-replies" role="group" aria-label={t("快捷回复")}>{message.replies.map(act=><button className="quiet" type="button" key={act} disabled={busy} onClick={()=>reply(act)}>{actGloss(act,'h2a',locale).text}</button>)}</div>}
  {error&&<small role="alert">{error}</small>}
 </div>;
}
export function AiExpressions({rpc,sessionId,node}:{rpc:DshRpc;sessionId:string;node:{data:VisualMeta[]}}){
 return <>{node.data.map(meta=><AiExpression key={`${sessionId}:${meta.messageId}`} rpc={rpc} sessionId={sessionId} meta={meta}/>)}</>;}
