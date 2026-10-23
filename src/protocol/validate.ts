import { Ajv2020 } from 'ajv/dist/2020.js';
import schema from '../../docs/specs/amoji-0.1.schema.json' with { type: 'json' };
import { fail } from '../errors.js';
import { actAllows, findAct, backchannelEligible, interruptEligible, REGISTRY } from './registry.js';
import type { Expression, Operation, Pack, Preferences, ProtocolMessage, Sender } from './types.js';
import { LIMITS, Problems as RuleProblems, checkExpressionRules, checkNfc, checkPackRules } from './rules.js';

export { LIMITS };


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

/** Adds the protocol's single failure, carrying every collected violation. */
class Problems extends RuleProblems {
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
  checkPackRules(pack, p);
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
