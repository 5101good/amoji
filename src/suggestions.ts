import type { DraftFields } from './drafts.js';
import { fail } from './shared-contract.js';

export interface TextSuggestion {
  method: 'local-deterministic-v1';
  notice: string;
  fields: Pick<DraftFields, 'name' | 'semantics' | 'tags'>;
}

interface Pattern {
  cooperation?: boolean;
  matches: RegExp;
  zh: { name: string; fallback: string; tone: string; tags: string[] };
  en: { name: string; fallback: string; tone: string; tags: string[] };
}

const patterns: Pattern[] = [
  { cooperation: true, matches: /进度|状态|完成多少|progress|status/i, zh: {"name": "进度如何", "fallback": "请报告真实进度", "tone": "自然直接", "tags": ["协作:进度", "进度如何"]}, en: {"name": "Progress update", "fallback": "Please report actual progress", "tone": "clear and direct", "tags": ["collaboration", "进度"]} },
  { cooperation: true, matches: /卡住|卡在|阻碍|blocked|stuck/i, zh: {"name": "卡在哪里", "fallback": "请说明具体阻碍", "tone": "自然直接", "tags": ["协作:进度", "卡在哪里"]}, en: {"name": "What is blocking us", "fallback": "Please explain the blocker", "tone": "clear and direct", "tags": ["collaboration", "进度"]} },
  { cooperation: true, matches: /举.*例|例子|example/i, zh: {"name": "举个例子", "fallback": "请举一个具体例子", "tone": "自然直接", "tags": ["协作:澄清", "举个例子"]}, en: {"name": "Show an example", "fallback": "Please give a concrete example", "tone": "clear and direct", "tags": ["collaboration", "澄清"]} },
  { cooperation: true, matches: /具体些|具体一点|没看懂|澄清|clarif|explain/i, zh: {"name": "说具体些", "fallback": "请说得更具体些", "tone": "自然直接", "tags": ["协作:澄清", "说具体些"]}, en: {"name": "Please clarify", "fallback": "Please explain more concretely", "tone": "clear and direct", "tags": ["collaboration", "澄清"]} },
  { cooperation: true, matches: /先等|暂停|等一下|pause|wait/i, zh: {"name": "先等一下", "fallback": "请先暂停，等我补充", "tone": "自然直接", "tags": ["协作:方向", "先等一下"]}, en: {"name": "Please wait", "fallback": "Please pause until I clarify", "tone": "clear and direct", "tags": ["collaboration", "方向"]} },
  { cooperation: true, matches: /方向不对|偏离|重新对齐|wrong direction/i, zh: {"name": "方向不对", "fallback": "请先重新对齐目标", "tone": "自然直接", "tags": ["协作:方向", "方向不对"]}, en: {"name": "Wrong direction", "fallback": "Please realign on the goal", "tone": "clear and direct", "tags": ["collaboration", "方向"]} },
  { cooperation: true, matches: /继续|continue|carry on/i, zh: {"name": "继续吧", "fallback": "请在已确认的范围内继续", "tone": "自然直接", "tags": ["协作:方向", "继续吧"]}, en: {"name": "Please continue", "fallback": "Please continue within the agreed scope", "tone": "clear and direct", "tags": ["collaboration", "方向"]} },
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
    ? { name: '表达意图', fallback: '我想表达这个意思', tone: '自然直接', tags: ['心意'] }
    : { name: 'Expressing an intention', fallback: 'This is what I mean', tone: 'natural and direct', tags: ['expression'] });
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
        avoid_when: [match?.cooperation
          ? (chinese ? '不要将表情当作已执行或已完成的证明，也不扩大原有授权' : 'Do not treat an expression as proof of execution or completion, or as expanded permission')
          : (chinese ? '需要具体事实、承诺或操作说明时' : 'When precise facts, commitments, or instructions are needed')],
      },
      tags: wording.tags,
    },
  };
}
