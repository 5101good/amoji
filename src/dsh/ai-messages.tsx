import { useText } from './i18n.js';
import React from 'react';
import type {ConversationNodeDefinition} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {ChatConversationViewNode} from '@deepseek-ai/dsh-client-ui-chat/client';
import type {DshRpc,VisualMeta} from './contracts.js';
import {AmojiImage,parseMeta} from './media.js';
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
export function AiExpressions({rpc,sessionId,node}:{rpc:DshRpc;sessionId:string;node:{data:VisualMeta[]}}){
 const t=useText();return <>{node.data.map(meta=><div key={`${sessionId}:${meta.messageId}`} className="amoji amoji-message amoji-message-ai" aria-label={t("AI 表情")}><Styles/><AmojiImage rpc={rpc} sessionId={sessionId} refValue={meta.ref} meta={meta}/></div>)}</>;}
