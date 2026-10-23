import { Ajv2020 } from 'ajv/dist/2020.js';
import schema from '../../docs/specs/amoji-0.1.schema.json' with { type: 'json' };
import { fail } from '../shared-contract.js';
import { actAllows, findAct, backchannelEligible, interruptEligible, REGISTRY } from './registry.js';
import type { Expression, Operation, Pack, Preferences, ProtocolMessage, Sender } from './types.js';

export const LIMITS = Object.freeze({
  expressionText: 16 * 1024,
  instruction: 2 * 1024,
  summary: 4 * 1024,
  effectTitle: 60,
  expressions: 200,
  effects: 64,
});

/** Fields only the act registry may define (RFC §6, P3). */
const REGISTRY_ONLY = new Set(['authority', 'expects', 'forms', 'grounded', 'pressure_sensitive']);
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema(schema);
const compiled = (name: string) => ajv.getSchema(`urn:amoji:schema:0.1#/$defs/${name}`)!;
const structural = {
  expression: compiled('expression'),
  pack: compiled('pack'),
  message: compiled('message'),
  operation: compiled('operation'),
  preferences: compiled('preferences'),
  registry: compiled('registry'),
};

/** Collects every violation, then fails once with all of them. */
class Problems {
  readonly items: string[] = [];
  add(where: string, message: string): void { this.items.push(`${where}: ${message}`); }
  throwIfAny(code = 'INVALID_SCHEMA'): void {
    if (!this.items.length) return;
    const shown = this.items.slice(0, 12).join('; ');
    fail(code, this.items.length > 12 ? `${shown}; …(+${this.items.length - 12})` : shown);
  }
}

function checkStructure(name: keyof typeof structural, value: unknown, p: Problems, where: string): boolean {
  const validate = structural[name];
  if (validate(value)) return true;
  for (const error of validate.errors ?? []) {
    const extra = (error.params as { additionalProperty?: string }).additionalProperty;
    const message = extra === undefined ? error.message ?? 'invalid'
      : REGISTRY_ONLY.has(extra) ? `'${extra}' 只能由码位注册表定义，包和表情不得声明` : `不允许的字段 '${extra}'`;
    p.add(`${where}${error.instancePath}`, message);
  }
  return false;
}

function walkStrings(value: unknown, path: string, visit: (text: string, path: string) => void): void {
  if (typeof value === 'string') visit(value, path);
  else if (Array.isArray(value)) value.forEach((item, index) => walkStrings(item, `${path}[${index}]`, visit));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) walkStrings(item, `${path}.${key}`, visit);
}
function checkNfc(value: unknown, p: Problems, where: string): void {
  walkStrings(value, where, (text, path) => { if (text.normalize('NFC') !== text) p.add(path, '文字须为 Unicode NFC 规范化'); });
}
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value ?? null));

function checkExpressionRules(e: Expression, p: Problems, where: string, packLocales: string[] = []): void {
  const act = findAct(e.realizes);
  if (!act) p.add(`${where}.realizes`, `码位不在注册表 ${REGISTRY.revision} 中：${e.realizes}`);
  else if (act.status === 'deprecated') p.add(`${where}.realizes`, `码位已废弃：${e.realizes}`);
  if (act && e.directions && !e.directions.every(direction => act.forms[direction])) p.add(`${where}.directions`, '方向必须是码位允许方向的子集');
  for (const locale of new Set([e.original_locale, ...packLocales])) {
    if (!(locale in e.name)) p.add(`${where}.name`, `缺少语言 ${locale}`);
    if (!(locale in e.semantics)) p.add(`${where}.semantics`, `缺少语言 ${locale}`);
  }
  for (const [locale, semantics] of Object.entries(e.semantics)) {
    if (locale === e.original_locale) {
      if (semantics.translation) p.add(`${where}.semantics.${locale}`, '原始语言不能声明 translation');
    } else if (!semantics.translation) p.add(`${where}.semantics.${locale}`, '非原始语言必须声明 translation {from, method}');
    else if (semantics.translation.from === locale || !(semantics.translation.from in e.semantics)) p.add(`${where}.semantics.${locale}.translation.from`, '必须指向语义中已有的另一种语言');
  }
  if (bytes({ name: e.name, semantics: e.semantics, tags: e.tags }) > LIMITS.expressionText) p.add(where, '名称、语义与标签合计超过 16 KiB');
  if (e.visual.animated && e.visual.poster?.sha256 === e.visual.primary.sha256) p.add(`${where}.visual.poster`, '动图封面必须是独立静态素材');
  checkNfc({ name: e.name, semantics: e.semantics, tags: e.tags, rights: e.rights }, p, where);
}

export function validateExpression(value: unknown): Expression {
  const p = new Problems();
  if (checkStructure('expression', value, p, 'expression')) checkExpressionRules(value as Expression, p, 'expression');
  p.throwIfAny();
  return value as Expression;
}

export function validatePack(value: unknown): Pack {
  const p = new Problems();
  if (!checkStructure('pack', value, p, 'pack')) { p.throwIfAny(); }
  const pack = value as Pack;
  if (!pack.locales.includes(pack.original_locale)) p.add('pack.locales', '必须包含 original_locale');
  for (const locale of pack.locales) {
    if (!(locale in pack.name)) p.add('pack.name', `缺少语言 ${locale}`);
    if (!(locale in pack.description)) p.add('pack.description', `缺少语言 ${locale}`);
  }
  const assets = new Set<string>();
  pack.expressions.forEach((e, index) => {
    checkExpressionRules(e, p, `pack.expressions[${index}]`, pack.locales);
    if (assets.has(e.asset_id)) p.add(`pack.expressions[${index}].asset_id`, '每个资产在一次发布中只能出现一次');
    assets.add(e.asset_id);
  });
  const effects = new Set<string>();
  (pack.effects ?? []).forEach((effect, index) => {
    const where = `pack.effects[${index}]`;
    if (effects.has(effect.effect_id)) p.add(`${where}.effect_id`, '效果重复');
    effects.add(effect.effect_id);
    for (const locale of pack.locales) {
      if (!(locale in effect.title)) p.add(`${where}.title`, `缺少语言 ${locale}`);
      if (!(locale in effect.summary)) p.add(`${where}.summary`, `缺少语言 ${locale}`);
    }
    for (const [locale, text] of Object.entries(effect.summary)) if (Buffer.byteLength(text) > LIMITS.summary) p.add(`${where}.summary.${locale}`, '超过 4 KiB');
    if (effect.kind === 'context') {
      if (!(pack.original_locale in effect.instruction)) p.add(`${where}.instruction`, `缺少原始语言 ${pack.original_locale}`);
      for (const [locale, text] of Object.entries(effect.instruction)) if (Buffer.byteLength(text) > LIMITS.instruction) p.add(`${where}.instruction.${locale}`, '超过 2 KiB');
    }
  });
  const refs = new Set(pack.expressions.map(e => `${e.asset_id}:${e.revision_id}`));
  (pack.bindings ?? []).forEach((binding, index) => {
    const where = `pack.bindings[${index}]`;
    if ('act' in binding.target) { if (!findAct(binding.target.act)) p.add(`${where}.target.act`, '码位不在注册表中'); }
    else if (!refs.has(`${binding.target.asset_id}:${binding.target.revision_id}`)) p.add(`${where}.target`, '绑定的表情不在本包内');
    for (const id of binding.effects) if (!effects.has(id)) p.add(`${where}.effects`, `效果 ${id} 不在本包内`);
  });
  checkNfc({ name: pack.name, description: pack.description, rights: pack.rights, effects: pack.effects }, p, 'pack');
  p.throwIfAny();
  return pack;
}

function senderDirection(from: Sender) { return from.role === 'human' ? 'h2a' as const : 'a2h' as const; }

export function validateMessage(value: unknown): ProtocolMessage {
  const p = new Problems();
  if (checkStructure('message', value, p, 'message')) {
    const m = value as ProtocolMessage;
    const direction = senderDirection(m.from);
    if (!findAct(m.act)) p.add('message.act', '码位不在注册表中');
    else if (!actAllows(m.act, direction)) p.add('message.act', '该码位不允许此方向');
    if (m.mode === 'backchannel' && (direction !== 'h2a' || !backchannelEligible(m.act))) p.add('message.mode', '只有人发出的非关系类码位可以作为纠偏信号');
    if (m.mode === 'interrupt' && (direction !== 'h2a' || !interruptEligible(m.act))) p.add('message.mode', '只有收紧类码位可以打断');
    for (const reply of m.replies ?? []) if (!actAllows(reply, 'h2a')) p.add('message.replies', `快捷回复必须能由人发出：${reply}`);
    if (m.options && new Set(m.options.map(o => o.id)).size !== m.options.length) p.add('message.options', '选项 id 必须唯一');
    checkNfc({ note: m.note, rationale: m.rationale, options: m.options, anchor: m.anchor?.exact }, p, 'message');
  }
  p.throwIfAny();
  return value as ProtocolMessage;
}

export function validateOperation(value: unknown): Operation {
  const p = new Problems();
  checkStructure('operation', value, p, 'operation');
  p.throwIfAny();
  return value as Operation;
}

export function validatePreferences(value: unknown): Preferences {
  const p = new Problems();
  if (checkStructure('preferences', value, p, 'preferences')) {
    const prefs = value as Preferences;
    for (const act of prefs.quick_entries) if (!actAllows(act, 'h2a')) p.add('preferences.quick_entries', `快捷入口必须能由人发出：${act}`);
  }
  p.throwIfAny();
  return value as Preferences;
}

export function validateRegistry(value: unknown): void {
  const p = new Problems();
  checkStructure('registry', value, p, 'registry');
  p.throwIfAny();
}
