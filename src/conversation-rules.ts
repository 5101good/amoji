import type { EffectChoice, EffectSelection } from './effects.js';
import { effectConflictGroup, effectGuidance } from './effects.js';
import type { CollaborationCheckpoint, CollaborationRule } from './dsh/collaboration-context.js';

export type RuleChoice = EffectChoice;
export interface RuleActivation extends RuleChoice { enabled: boolean; actor: 'user'; generation: number; status: 'disabled' | 'configured' | 'attached' | 'failed' | 'unsupported'; reason?: string }
export interface RuleSnapshot { generation: number; rules: RuleActivation[]; checkpoint?: CollaborationCheckpoint }
export interface RuleView extends RuleSnapshot { choices: RuleChoice[]; identity: 'ready' | 'pending' }
export interface RuleChange { kind: 'enable' | 'disable' | 'disableAll'; generation: number; selection?: EffectSelection; replace?: EffectSelection | null; checkpoint: CollaborationCheckpoint }
export const ruleConflictGroup = (rule: RuleChoice) => effectConflictGroup(rule.effect);

export function compiledRule(rule: RuleChoice): CollaborationRule {
  const base = { id: rule.effect.effect_id, revision: rule.effect.effect_revision_id, source: rule.source };
  const effect = rule.effect;
  if (effect.kind === 'context') return { ...base, template: 'context', config: { conflictGroup: effect.conflict_group, instruction: effectGuidance(effect, undefined, rule.source.original_locale) } };
  return { ...base, template: effect.template, config: effect.config } as CollaborationRule;
}
