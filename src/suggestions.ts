import type { DraftFields } from './drafts.js';
import { fail } from './shared-contract.js';

export interface TextSuggestion {
  method: 'local-deterministic-v1';
  notice: string;
  fields: Pick<DraftFields, 'name' | 'semantics' | 'tags'>;
}

interface Pattern {
  matches: RegExp;
  zh: { name: string; fallback: string; tone: string; tags: string[] };
  en: { name: string; fallback: string; tone: string; tags: string[] };
}

const patterns: Pattern[] = [
  { matches: /感谢|谢谢|感激|thank/i, zh: { name: '真诚感谢', fallback: '谢谢你', tone: '真诚感谢', tags: ['感谢', '认可'] }, en: { name: 'Thank you', fallback: 'Thank you', tone: 'sincere gratitude', tags: ['thanks', 'appreciation'] } },
  { matches: /鼓励|加油|支持|坚持|encourag|support|you can/i, zh: { name: '为你加油', fallback: '加油', tone: '温暖鼓励', tags: ['鼓励', '支持'] }, en: { name: 'You have got this', fallback: 'You have got this', tone: 'warm encouragement', tags: ['encouragement', 'support'] } },
  { matches: /庆祝|开心|太棒|完成|celebrat|congrat|happy/i, zh: { name: '一起庆祝', fallback: '太棒了', tone: '轻快喜悦', tags: ['庆祝', '喜悦'] }, en: { name: 'Let us celebrate', fallback: 'Great news', tone: 'joyful celebration', tags: ['celebration', 'joy'] } },
  { matches: /抱歉|对不起|道歉|sorry|apolog/i, zh: { name: '认真道歉', fallback: '对不起', tone: '诚恳歉意', tags: ['抱歉', '道歉'] }, en: { name: 'I am sorry', fallback: 'I am sorry', tone: 'sincere apology', tags: ['sorry', 'apology'] } },
  { matches: /陪伴|安慰|抱抱|难过|comfort|hug|here for/i, zh: { name: '温暖陪伴', fallback: '抱抱你', tone: '温柔陪伴', tags: ['陪伴', '安慰'] }, en: { name: 'Here with you', fallback: 'Here with you', tone: 'gentle support', tags: ['comfort', 'support'] } },
  { matches: /无奈|尴尬|自嘲|awkward|embarrass/i, zh: { name: '无奈苦笑', fallback: '苦笑一下', tone: '克制幽默', tags: ['无奈', '自嘲'] }, en: { name: 'Awkward smile', fallback: 'Awkward smile', tone: 'dry humor', tags: ['awkward', 'humor'] } },
];

function inputText(value: unknown, label: string, max: number, required: boolean): string {
  if (typeof value !== 'string') fail('SUGGESTION_INPUT_INVALID', `${label}只接受文字`);
  const result = value.trim();
  if (required && !result) fail('SUGGESTION_INPUT_INVALID', `请填写${label}`);
  if ([...result].length > max) fail('SUGGESTION_INPUT_TOO_LONG', `${label}最多 ${max} 个 Unicode 字符；不会自动截断`);
  return result;
}

/** Local text-only helper. It never receives or reads draft media. */
export function suggestText(intentValue: unknown, notesValue?: unknown): TextSuggestion {
  const intent = inputText(intentValue, '文字意图', 240, true);
  const normalizedNotes = typeof notesValue === 'string' ? notesValue.replace(/\r\n?/g, '\n') : notesValue;
  const notes = notesValue === undefined ? '' : inputText(normalizedNotes, '补充说明', 260, false);
  const contexts = notes ? notes.split('\n').map(item => item.trim()).filter(Boolean) : [];
  if (contexts.length > 4 || contexts.some(item => [...item].length > 64)) fail('SUGGESTION_INPUT_TOO_LONG', '补充说明最多 4 行，每行最多 64 个 Unicode 字符；不会自动截断');
  const chinese = /[\p{Script=Han}]/u.test(intent + notes);
  const match = patterns.find(item => item.matches.test(intent + notes));
  const wording = match?.[chinese ? 'zh' : 'en'] ?? (chinese
    ? { name: '表达心意', fallback: '表达一下心意', tone: '自然直接', tags: ['心意'] }
    : { name: 'Expressing this feeling', fallback: 'Expressing this feeling', tone: 'natural and direct', tags: ['expression'] });
  return {
    method: 'local-deterministic-v1',
    notice: '本机确定性文字规则生成；未调用模型，也不读取图像。请修改并由你确认。',
    fields: {
      name: wording.name,
      semantics: {
        locale: chinese ? 'zh-CN' : 'en',
        meaning: intent,
        fallback: wording.fallback,
        tone: wording.tone,
        ...(contexts.length ? { use_when: contexts } : {}),
        avoid_when: [chinese ? '需要具体事实、承诺或操作说明时' : 'When precise facts, commitments, or instructions are needed'],
      },
      tags: wording.tags,
    },
  };
}
