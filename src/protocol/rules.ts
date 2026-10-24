import registryJson from '../../docs/specs/amoji-0.1.registry.json' with { type: 'json' };
import type { ActEntry, Expression, Pack, Registry } from './types.js';

/**
 * Semantic rules the JSON Schema cannot express (RFC §7, §9, §16), shared by the core
 * and the marketplace worker. Pure: no Node APIs, no schema compiler, no exceptions.
 */
export const LIMITS = Object.freeze({
  expressionText: 16 * 1024,
  instruction: 2 * 1024,
  summary: 4 * 1024,
  effectTitle: 60,
  expressions: 200,
  effects: 64,
});
const REGISTRY = registryJson as Registry;
const ACTS = new Map<string, ActEntry>(REGISTRY.acts.map(entry => [entry.act, entry]));

/** Collects every violation as `where: message`. */
export class Problems {
  readonly items: string[] = [];
  add(where: string, message: string): void { this.items.push(`${where}: ${message}`); }
}

function walkStrings(value: unknown, path: string, visit: (text: string, path: string) => void): void {
  if (typeof value === 'string') visit(value, path);
  else if (Array.isArray(value)) value.forEach((item, index) => walkStrings(item, `${path}[${index}]`, visit));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) walkStrings(item, `${path}.${key}`, visit);
}
export function checkNfc(value: unknown, p: Problems, where: string): void {
  walkStrings(value, where, (text, path) => { if (text.normalize('NFC') !== text) p.add(path, '文字须为 Unicode NFC 规范化'); });
}
const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;
const bytes = (value: unknown) => byteLength(JSON.stringify(value ?? null));

export function checkExpressionRules(e: Expression, p: Problems, where: string, packLocales: string[] = []): void {
  const act = ACTS.get(e.realizes);
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

/** Pack-level rules: locale completeness, unique assets and effects, bindings that resolve inside the pack. */
export function checkPackRules(pack: Pack, p: Problems): void {
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
    for (const [locale, text] of Object.entries(effect.summary)) if (byteLength(text) > LIMITS.summary) p.add(`${where}.summary.${locale}`, '超过 4 KiB');
    if (effect.kind === 'context') {
      if (!(pack.original_locale in effect.instruction)) p.add(`${where}.instruction`, `缺少原始语言 ${pack.original_locale}`);
      for (const [locale, text] of Object.entries(effect.instruction)) if (byteLength(text) > LIMITS.instruction) p.add(`${where}.instruction.${locale}`, '超过 2 KiB');
    }
  });
  const refs = new Set(pack.expressions.map(e => `${e.asset_id}:${e.revision_id}`));
  (pack.bindings ?? []).forEach((binding, index) => {
    const where = `pack.bindings[${index}]`;
    if ('act' in binding.target) { if (!ACTS.has(binding.target.act)) p.add(`${where}.target.act`, '码位不在注册表中'); }
    else if (!refs.has(`${binding.target.asset_id}:${binding.target.revision_id}`)) p.add(`${where}.target`, '绑定的表情不在本包内');
    for (const id of binding.effects) if (!effects.has(id)) p.add(`${where}.effects`, `效果 ${id} 不在本包内`);
  });
  checkNfc({ name: pack.name, description: pack.description, rights: pack.rights, effects: pack.effects }, p, 'pack');
}
