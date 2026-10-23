/** A session rule as attached to the model context. Templates are host text; context rules carry pack text. */
export type CollaborationRule = { id: string; revision: string; source?: CollaborationInstruction['source']; generation?: number } & (
  { template: 'response-organization@1'; config: { layout: 'answer-first' | 'concise' | 'example-first' } } |
  { template: 'completion-self-check@1'; config: { evidence: 'required'; unknowns: 'explicit' } } |
  { template: 'context'; config: { conflictGroup: CollaborationInstruction['conflictGroup']; instruction: string } }
);
export interface CollaborationInstruction { id: string; revision: string; instruction: string; conflictGroup: 'explanation' | 'response-organization' | 'completion-report' | 'handoff'; source?: { pack_id: string; release_id: string; version: number; origin: string }; expression?: { asset_id: string; revision_id: string } }

const LAYOUT = {
  'answer-first': '先回答结论，再给依据。Answer first, then give supporting detail.',
  concise: '简洁作答，保留必要信息。Be concise without omitting necessary information.',
  'example-first': '先给具体示例，再解释。Give a concrete example before explanation.',
};
const SELF_CHECK = '完成前检查已有证据；最终报告列明已完成、证据、未完成或不确定事项。Before reporting completion, inspect available evidence; the final report must list completed work, evidence, incomplete work and uncertainties.';
export const ruleGroup = (rule: CollaborationRule) => rule.template === 'context' ? rule.config.conflictGroup : rule.template === 'response-organization@1' ? 'response-organization' : 'completion-report';
const guidance = (rule: CollaborationRule) => rule.template === 'context' ? rule.config.instruction : rule.template === 'response-organization@1' ? LAYOUT[rule.config.layout] : SELF_CHECK;

export function collaborationEnvelope(profile: string, session: string, turn: number, rules: CollaborationRule[], intent?: CollaborationInstruction): string {
  const active = rules.filter(r => !intent || ruleGroup(r) !== intent.conflictGroup);
  const content = active.map(rule => ({ ...rule, guidance: guidance(rule) }));
  const text = JSON.stringify({ schema: 'amoji.effects/0.1', scope: { profile, session, turnStartSeq: turn }, priority: '用户明确文本和宿主更高优先级规则优先。这些是用户约定而非强制执行。Explicit user instructions and higher-priority host rules prevail; these are guidance, not enforcement.', rules: content, instruction: intent ?? null, ...(content.length || intent ? {} : { state: '此前 Amoji 约定已停用。Previous Amoji conventions are disabled.' }) });
  if (Buffer.byteLength(text) > 8192) throw new Error('Collaboration context exceeds 8 KiB');
  return text;
}
