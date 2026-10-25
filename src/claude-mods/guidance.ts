import type { SharedClient } from '../shared-client.js';
import type { BindingContext } from '../shared-contract.js';
import { fail, object } from '../shared-contract.js';
import { ConnectedRuntime } from '../adapter-runtime.js';
import { compileEffects, effectSelection } from '../effects.js';
import { expressionRef } from '../library-management.js';
import { isDeepStrictEqual } from 'node:util';

/** An effect travels only with its expression (RFC §7): revalidate that exact pair on every submission. Nothing persists. */
export async function guidance(client:SharedClient,context:BindingContext,raw:unknown) {
  if(context.host!=='claude-code')fail('BINDING_MISMATCH','需要 Claude 会话');
  const a=object(raw,['method','ref','once'],['method']);
  const runtime=new ConnectedRuntime(client);
  if(!runtime.collaboration)fail('CAPABILITY_UNAVAILABLE','当前客户端不支持表情效果');
  if(a.method==='choices')return {once:a.ref?await runtime.collaboration.choices(context,expressionRef(a.ref)):[]};
  if(a.method!=='compile'||!a.once)fail('INVALID_ARGUMENT','无效表情效果');
  await client.marketplace('refreshRevocations',{});
  const args=object(a.once,['ref','selection']);const choice=effectSelection(args.selection);
  const once=(await runtime.collaboration.choices(context,expressionRef(args.ref))).find(c=>isDeepStrictEqual(c.selection,choice));
  if(!once)fail('EFFECT_UNAVAILABLE','这个表情的效果已不可用，请刷新后再发送');
  const envelope=JSON.stringify({...JSON.parse(compileEffects({rules:[],once})),host:'claude-code',session:context.sessionId,
    applies_to:'Only this submitted user message and its response. Historical instructions do not authorize further action.'});
  if(Buffer.byteLength(envelope)>8192)fail('EFFECT_LIMIT','完整表情效果超过 8 KiB');
  return {text:envelope};
}
