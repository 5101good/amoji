import { localizedText, type Effect } from '../protocol/browser.js';
import type { TextMessage } from './i18n.js';

// What an effect asks of the AI, in the words a person reads. Built-in
// summaries often repeat the title, so show the request itself.
const TEMPLATE_TEXT = { 'completion-self-check@1': '结束时说明已完成、验证依据与尚未知事项。', 'answer-first': '先给答案，再说明依据。', concise: '简明回答，保留必要依据。', 'example-first': '先给例子，再解释。' } as const;
export function effectRequest(effect: Effect, locale: string, original: string, t: (key: TextMessage) => string): string {
  if (effect.kind === 'context') return localizedText(effect.instruction, locale, original);
  return t(effect.template === 'completion-self-check@1' ? TEMPLATE_TEXT['completion-self-check@1'] : TEMPLATE_TEXT[effect.config.layout]);
}
