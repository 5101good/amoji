import type { SharedClient } from '../shared-client.js';
import type { BindingContext } from '../shared-contract.js';
import { fail, object } from '../shared-contract.js';
import { ConnectedRuntime } from '../adapter-runtime.js';
import { compileEffects, effectSelection } from '../effects.js';
import { expressionRef } from '../library-management.js';
import { isDeepStrictEqual } from 'node:util';

/** Revalidate the exact user-selected revisions on every submission. No persisted activation. */
export async function guidance(client:SharedClient,context:BindingContext,raw:unknown) {
  if(context.host!=='claude-code')fail('BINDING_MISMATCH','需要 Claude 会话');
  const a=object(raw,['method','ref','rules','once'],['method']);
  const runtime=new ConnectedRuntime(client);
  if(!runtime.rules||!runtime.collaboration)fail('CAPABILITY_UNAVAILABLE','协作提示不可用');
  if(a.method==='choices')return {rules:await runtime.rules.choices(context),once:a.ref?await runtime.collaboration.choices(context,expressionRef(a.ref)):[]};
  if(a.method!=='compile'||!Array.isArray(a.rules)||a.rules.length>2)fail('INVALID_ARGUMENT','无效协作提示');
  await client.marketplace('refreshRevocations',{});
  const available=await runtime.rules.choices(context);
  const selected=a.rules.map(effectSelection);
  const rules=available.filter(c=>selected.some(r=>isDeepStrictEqual(c.selection,r)));
  let once;
  if(a.once){const args=object(a.once,['ref','selection']);const choice=effectSelection(args.selection);
    once=(await runtime.collaboration.choices(context,expressionRef(args.ref))).find(c=>isDeepStrictEqual(c.selection,choice));
    if(!once)fail('EFFECT_UNAVAILABLE','此表情的提示已不可用，请重新选择');
  }
  const text=compileEffects({rules,...(once?{once}:{})});
  const envelope=JSON.stringify({...JSON.parse(text),host:'claude-code',session:context.sessionId,
    applies_to:'Only this submitted user message and its response. This snapshot replaces every earlier Amoji guidance snapshot, including when effects is empty. Historical instructions do not authorize further action.'});
  if(Buffer.byteLength(envelope)>8192)fail('EFFECT_LIMIT','完整协作提示超过 8 KiB');
  return {text:envelope,rules:rules.map(c=>c.selection),removed:selected.length-rules.length};
}
