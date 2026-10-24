import type { Anchor, DecisionOption, Intensity, Mode } from './protocol/index.js';
import type { ExpressInput, ReceiveInput } from './library-store.js';
import { effectSelection } from './effects.js';
import { expressionRef } from './library-management.js';
import { fail, nonempty, object } from './shared-contract.js';

const optionalText = (value: unknown, max = 1024): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) fail('INVALID_ARGUMENT', '需要有界文字');
  return value;
};
function anchor(value: unknown): Anchor | undefined {
  if (value === undefined) return undefined;
  const a = object(value, ['message_id', 'exact', 'prefix', 'suffix', 'start', 'end'], ['message_id']);
  return { message_id: nonempty(a.message_id), ...(a.exact === undefined ? {} : { exact: optionalText(a.exact)! }), ...(a.prefix === undefined ? {} : { prefix: optionalText(a.prefix)! }), ...(a.suffix === undefined ? {} : { suffix: optionalText(a.suffix)! }), ...(a.start === undefined ? {} : { start: a.start as number }), ...(a.end === undefined ? {} : { end: a.end as number }) };
}
function intensity(value: unknown): Intensity | undefined {
  if (value === undefined) return undefined;
  if (value !== 1 && value !== 2 && value !== 3) fail('INVALID_ARGUMENT', '强度只能是 1、2 或 3');
  return value;
}

/** Only the fields an AI may control. Semantics overrides and arbitrary targets are rejected. */
export function expressInput(value: unknown): ExpressInput {
  const v = object(value, ['act', 'selection_token', 'intensity', 'anchor', 'replies', 'options', 'responds_to', 'rationale', 'pending_confirmation', 'locale', 'agent_id'], []);
  if ((v.act === undefined) === (v.selection_token === undefined)) fail('INVALID_ARGUMENT', '需要 act 或 selection_token 之一');
  if (v.replies !== undefined && (!Array.isArray(v.replies) || v.replies.length > 8)) fail('INVALID_ARGUMENT', '快捷回复需要码位列表');
  if (v.options !== undefined && (!Array.isArray(v.options) || v.options.length > 8)) fail('INVALID_ARGUMENT', '选项需要列表');
  if (v.pending_confirmation !== undefined && typeof v.pending_confirmation !== 'boolean') fail('INVALID_ARGUMENT', '待决确认需要布尔值');
  return {
    ...(v.act === undefined ? {} : { act: nonempty(v.act) }), ...(v.selection_token === undefined ? {} : { selection_token: nonempty(v.selection_token) }),
    ...(v.intensity === undefined ? {} : { intensity: intensity(v.intensity) }), ...(v.anchor === undefined ? {} : { anchor: anchor(v.anchor) }),
    ...(v.replies === undefined ? {} : { replies: (v.replies as unknown[]).map(r => nonempty(r)) }),
    ...(v.options === undefined ? {} : { options: (v.options as unknown[]).map(o => { const x = object(o, ['id', 'label']); return { id: nonempty(x.id), label: nonempty(x.label) } as DecisionOption; }) }),
    ...(v.responds_to === undefined ? {} : { responds_to: nonempty(v.responds_to) }), ...(v.rationale === undefined ? {} : { rationale: optionalText(v.rationale) }),
    ...(v.pending_confirmation === undefined ? {} : { pending_confirmation: v.pending_confirmation as boolean }),
    ...(v.locale === undefined ? {} : { locale: nonempty(v.locale) }), ...(v.agent_id === undefined ? {} : { agent_id: nonempty(v.agent_id) }),
  };
}

export function receiveInput(value: unknown): ReceiveInput {
  const v = object(value, ['ref', 'act', 'intensity', 'note', 'anchor', 'anchor_degraded', 'mode', 'sent_during', 'responds_to', 'effect', 'participant_id', 'locale'], []);
  if (v.ref === undefined && v.act === undefined) fail('INVALID_ARGUMENT', '需要 ref 或 act');
  if (v.mode !== undefined && !['turn', 'backchannel', 'interrupt'].includes(String(v.mode))) fail('INVALID_ARGUMENT', '无效模式');
  if (v.anchor_degraded !== undefined && typeof v.anchor_degraded !== 'boolean') fail('INVALID_ARGUMENT', '锚定降级需要布尔值');
  return {
    ...(v.ref === undefined ? {} : { ref: expressionRef(v.ref) }), ...(v.act === undefined ? {} : { act: nonempty(v.act) }),
    ...(v.intensity === undefined ? {} : { intensity: intensity(v.intensity) }), ...(v.note === undefined ? {} : { note: optionalText(v.note) }),
    ...(v.anchor === undefined ? {} : { anchor: anchor(v.anchor) }), ...(v.anchor_degraded ? { anchor_degraded: true } : {}),
    ...(v.mode === undefined ? {} : { mode: v.mode as Mode }), ...(v.sent_during === undefined ? {} : { sent_during: nonempty(v.sent_during) }),
    ...(v.responds_to === undefined ? {} : { responds_to: nonempty(v.responds_to) }), ...(v.effect === undefined ? {} : { effect: effectSelection(v.effect) }),
    ...(v.participant_id === undefined ? {} : { participant_id: nonempty(v.participant_id) }), ...(v.locale === undefined ? {} : { locale: nonempty(v.locale) }),
  };
}
