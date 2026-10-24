import type { DraftFields } from '../../src/drafts.js';

/** A bilingual draft whose English text is a declared, reviewed translation. */
export const fields: DraftFields = {
  realizes: 'core:encourage', intensity: 2, original_locale: 'zh-CN',
  name: { 'zh-CN': '今天稳稳前进', en: 'Steady today' },
  semantics: {
    'zh-CN': { meaning: '认可你持续稳步前进', fallback: '稳稳前进', use_when: ['鼓励持续努力'], avoid_when: ['需要紧急行动'] },
    en: { meaning: 'I see you moving forward steadily', fallback: 'Steady progress', translation: { from: 'zh-CN', method: 'machine-reviewed' } },
  },
  tags: { 'zh-CN': ['鼓励'] }, rights: { license: '仅供个人使用' }, text_locale: null,
};
