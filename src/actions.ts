import { Ajv2020 } from 'ajv/dist/2020.js';
import { fullFormats } from 'ajv-formats/dist/formats.js';
import schema from '../docs/specs/amoji-v0.2.schema.json' with { type: 'json' };
import type { Expression } from './sample-catalog.js';
import { fail } from './shared-contract.js';
export interface ActionRef { action_id: string; action_revision_id: string }
export type ConflictGroup = 'explanation' | 'response-organization' | 'completion-report' | 'handoff';
interface ActionBase extends ActionRef { locale: string; effect_summary: string; conflict_group: ConflictGroup; rights: Expression['rights'] }
export type ActionDefinition = ActionBase & ({kind:'instruction';scope:'turn';instruction:string} | {kind:'hook';scope:'conversation'} & ({template:'response-organization@1';config:{layout:'answer-first'|'concise'|'example-first'}} | {template:'completion-self-check@1';config:{evidence:'required';unknowns:'explicit'}}));
export const actionKey = (a: ActionRef) => `${a.action_id}:${a.action_revision_id}`;
const ajv = new Ajv2020({strict:false,formats:fullFormats});
const check = ajv.compile({$defs:schema.$defs,$ref:'#/$defs/action'});
export function validateAction(value:unknown): ActionDefinition {
 if (!check(value)) fail('INVALID_SCHEMA',ajv.errorsText(check.errors));
 const action=value as ActionDefinition;
 if(Buffer.byteLength(action.effect_summary)>4096 || (action.kind==='instruction' && Buffer.byteLength(action.instruction)>2048)) fail('ACTION_LIMIT','动作说明或指令超过 UTF-8 字节预算');
 return action;
}
/** Pure user-role text compiler. It neither enables actions nor invokes a host/model. */
export class ActionCompiler {
 compile({rules,once,semantics}:{rules:ActionDefinition[];once?:ActionDefinition;semantics:string}):string {
  if(rules.length>2)fail('ACTION_LIMIT','最多两条持续规则');
  if(Buffer.byteLength(semantics)>4096)fail('SEMANTIC_LIMIT','固定语义最多 4 KiB');
  const groups=new Set<string>();
  for(const value of rules){const a=validateAction(value);if(a.kind!=='hook')fail('INVALID_SCHEMA','持续规则必须为 hook');if(groups.has(a.conflict_group))fail('ACTION_CONFLICT','同组持续规则冲突');groups.add(a.conflict_group);}
  if(once && validateAction(once).kind!=='instruction')fail('INVALID_SCHEMA','一次性动作必须为 instruction');
  const active=rules.filter(a=>a.conflict_group!==once?.conflict_group);
  const actions=[...active,...(once?[once]:[])].map(a=>({action_id:a.action_id,action_revision_id:a.action_revision_id,scope:a.scope,conflict_group:a.conflict_group,effect:a.effect_summary,instruction:a.kind==='instruction'?a.instruction:a.template==='completion-self-check@1'?'结束时说明已完成、验证依据与尚未知事项。 / At completion report evidence and explicit unknowns.':({ 'answer-first':'先给答案，再说明依据。 / Answer first, then evidence.',concise:'简明回答，保留必要依据。 / Be concise and retain necessary evidence.','example-first':'先给例子，再解释。 / Give an example before explaining.'}[a.config.layout])}));
  const envelope=JSON.stringify({kind:'amoji.collaboration',version:1,priority:'用户明确文本与宿主更高优先级规则优先；这些仅是用户协作提示，不授予权限或保证模型遵从。 Explicit user text and higher-priority host rules prevail; guidance only, not authority or enforcement.',scope:'conversation 规则只用于当前会话；turn 动作只用于关联人类消息的回合。 Conversation rules apply only here; turn actions only to the correlated human input.',actions});
  if(Buffer.byteLength(envelope)>8192)fail('ACTION_LIMIT','完整动作上下文超过 8 KiB，不截断');
  return envelope;
 }
}
