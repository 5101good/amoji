import { PROTOCOL, type Anchor, type DecisionOption, type Expression, type Intensity, type Mode, type GlyphPolicy, type ProtocolMessage, type Sender } from './protocol/index.js';
import type { EffectIntent } from './effects.js';

/** A frozen message as the service stores it (RFC §8). `revision` freezes the displayed glyph. */
export interface StoredMessage {
  message_id: string;
  binding_id: string;
  registry_revision: string;
  from: Sender;
  direction: 'human_to_ai' | 'ai_to_human';
  act: string;
  intensity: Intensity;
  note?: string;
  revision?: Expression;
  glyph_policy: GlyphPolicy;
  anchor?: Anchor;
  anchor_degraded?: boolean;
  mode: Mode;
  sent_during?: string;
  replies?: string[];
  options?: DecisionOption[];
  responds_to?: string;
  rationale?: string;
  created_at: string;
  /** Correction-signal state (RFC §8.3, §12). */
  signal?: 'queued' | 'delivered_to_model' | 'promoted';
  /** Host-observed application of a reduce act (pause / stop). */
  applied?: true;
  /** dsh native prompt accepted and flushed; not proof of a rendered user message. */
  dsh_submission?: 'attempted' | 'accepted';
  presentation: 'pending' | 'rendered' | 'fallback';
  effect_intent?: EffectIntent;
  retracted_at?: string;
  choice?: { option: string; label: string; at: string };
}

export function toProtocolMessage(m: StoredMessage): ProtocolMessage {
  return {
    kind: 'amoji.message', amoji: PROTOCOL, registry_revision: m.registry_revision, message_id: m.message_id, from: m.from, act: m.act, intensity: m.intensity,
    ...(m.note ? { note: m.note } : {}),
    ...(m.revision ? { glyph: { asset_id: m.revision.asset_id, revision_id: m.revision.revision_id, sha256: m.revision.visual.primary.sha256 } } : {}),
    glyph_policy: m.glyph_policy, ...(m.anchor ? { anchor: m.anchor } : {}), mode: m.mode, ...(m.sent_during ? { sent_during: m.sent_during } : {}),
    ...(m.replies?.length ? { replies: m.replies } : {}), ...(m.options ? { options: m.options } : {}), ...(m.responds_to ? { responds_to: m.responds_to } : {}),
    ...(m.rationale ? { rationale: m.rationale } : {}),
    ...(m.effect_intent ? { effects: [{ effect_id: m.effect_intent.selection.effect_id, effect_revision_id: m.effect_intent.selection.effect_revision_id }] } : {}),
    created_at: m.created_at,
  };
}
