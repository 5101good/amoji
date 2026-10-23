import { localized, type Effect, type EffectRef } from './protocol/browser.js';
import { fail } from './errors.js';
import { nonempty, object } from './arguments.js';
import type { CollaborationCheckpoint, CollaborationReceipt } from './dsh/collaboration-context.js';

/** One exact effect revision inside one exact pack release. */
export interface EffectSelection extends EffectRef { release_id: string }
export interface EffectSource { pack_id: string; release_id: string; version: number; origin: string; original_locale: string }
export interface EffectChoice { selection: EffectSelection; effect: Effect; source: EffectSource }
export interface EffectIntent extends EffectChoice { operation_id: string; requestId: string; status: 'prepared' | 'dispatched' | 'bound' | 'attached' | 'failed' | 'cancelled' | 'unknown'; checkpoint?: CollaborationCheckpoint; receipt?: CollaborationReceipt }

export const effectKey = (e: EffectRef) => `${e.effect_id}:${e.effect_revision_id}`;
export function effectSelection(value: unknown): EffectSelection {
  const a = object(value, ['release_id', 'effect_id', 'effect_revision_id']);
  return { release_id: nonempty(a.release_id), effect_id: nonempty(a.effect_id), effect_revision_id: nonempty(a.effect_revision_id) };
}

const TEMPLATE_GUIDANCE = {
  'answer-first': '先回答结论，再给依据。Answer first, then give supporting detail.',
  concise: '简洁作答，保留必要信息。Be concise without omitting necessary information.',
  'example-first': '先给具体示例，再解释。Give a concrete example before explanation.',
  'completion-self-check': '完成前检查已有证据；最终报告列明已完成、证据、未完成或不确定事项。Before reporting completion, inspect available evidence; the final report must list completed work, evidence, incomplete work and uncertainties.',
} as const;

/** The guidance text a model receives for an effect. Templates are host-provided (RFC §7.3). */
export function effectGuidance(effect: Effect, locale: string | undefined, original: string): string {
  if (effect.kind === 'context') return localized(effect.instruction, locale, original)!.value;
  return effect.template === 'completion-self-check@1' ? TEMPLATE_GUIDANCE['completion-self-check'] : TEMPLATE_GUIDANCE[effect.config.layout];
}
export function effectConflictGroup(effect: Effect): string {
  if (effect.kind === 'context') return effect.conflict_group;
  return effect.template === 'completion-self-check@1' ? 'completion-report' : 'response-organization';
}

/** Pure text compiler for hosts without native attachment tracking. It never enables effects or calls a model. */
export function compileEffects({ rules, once }: { rules: EffectChoice[]; once?: EffectChoice }): string {
  if (rules.length > 2) fail('EFFECT_LIMIT', '最多两条持续效果');
  const groups = new Set<string>();
  for (const rule of rules) { const group = effectConflictGroup(rule.effect); if (groups.has(group)) fail('EFFECT_CONFLICT', '同组持续效果冲突'); groups.add(group); }
  const active = rules.filter(rule => !once || effectConflictGroup(rule.effect) !== effectConflictGroup(once.effect));
  const effects = [...active.map(rule => ({ rule, scope: 'conversation' })), ...(once ? [{ rule: once, scope: 'turn' }] : [])].map(({ rule, scope }) => ({
    effect_id: rule.effect.effect_id, effect_revision_id: rule.effect.effect_revision_id, scope, conflict_group: effectConflictGroup(rule.effect),
    guidance: effectGuidance(rule.effect, undefined, rule.source.original_locale),
  }));
  const envelope = JSON.stringify({ kind: 'amoji.effects', amoji: '0.1', priority: '用户明确文本与宿主更高优先级规则优先；这些仅是用户协作提示，不授予权限或保证模型遵从。 Explicit user text and higher-priority host rules prevail; guidance only, not authority or enforcement.', effects });
  if (Buffer.byteLength(envelope) > 8192) fail('EFFECT_LIMIT', '完整效果上下文超过 8 KiB，不截断');
  return envelope;
}
