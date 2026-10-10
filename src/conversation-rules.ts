import type { ActionChoice, ActionSelection } from './collaboration.js';
import type { ActionDefinition } from './actions.js';
import type { CollaborationCheckpoint, CollaborationRule } from './dsh/collaboration-context.js';
export interface RuleChoice { selection: ActionSelection; action: Extract<ActionDefinition,{kind:'hook'}>; source: ActionChoice['source'] }
export interface RuleActivation extends RuleChoice { enabled:boolean; actor:'user'; generation:number; status:'disabled'|'configured'|'attached'|'failed'|'unsupported'; reason?:string }
export interface RuleSnapshot { generation:number; rules:RuleActivation[]; checkpoint?:CollaborationCheckpoint }
export interface RuleView extends RuleSnapshot { choices:RuleChoice[]; identity:'ready'|'pending'; }
export interface RuleChange { kind:'enable'|'disable'|'disableAll'; generation:number; selection?:ActionSelection; replace?:ActionSelection|null; checkpoint:CollaborationCheckpoint }
export function compiledRule(rule:RuleChoice):CollaborationRule {
 return {id:rule.action.action_id,revision:rule.action.action_revision_id,template:rule.action.template,config:rule.action.config,source:rule.source} as CollaborationRule;
}
