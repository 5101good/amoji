/** Amoji 0.1 protocol objects (docs/specs/amoji-0.1-rfc.md). */
export const PROTOCOL = '0.1' as const;

export type Direction = 'h2a' | 'a2h';
export type Family = 'grounding' | 'steering' | 'progress' | 'epistemic' | 'social';
export type Expects = 'none' | 'rephrase' | 'detail' | 'example' | 'correct' | 'realign' | 'decompose' | 'adjust' | 'pause' | 'stop' | 'proceed' | 'report' | 'reconsider' | 'input' | 'decision' | 'review';
export type Intensity = 1 | 2 | 3;
export type Localized<T> = Record<string, T>;

export interface ActForm { expects: Expects; gloss: Localized<string> }
export interface ActEntry {
  act: string;
  family: Family;
  status: 'provisional' | 'active' | 'deprecated';
  authority: 'none' | 'reduce';
  fallback_act?: string;
  forms: Partial<Record<Direction, ActForm>>;
  grounded: boolean;
  pressure_sensitive: boolean;
}
export interface Registry { kind: 'amoji.registry'; amoji: typeof PROTOCOL; revision: string; status: 'provisional' | 'active'; acts: ActEntry[] }

export interface ExpressionRef { asset_id: string; revision_id: string }
export interface BlobRef { sha256: string; mime: string; bytes: number; width: number; height: number }
export interface Translation { from: string; method: 'human' | 'machine' | 'machine-reviewed' }
export interface Semantics { meaning: string; fallback: string; use_when?: string[]; avoid_when?: string[]; translation?: Translation }
export interface Visual { primary: BlobRef; animated: boolean; duration_ms?: number; poster?: BlobRef; text_locale: string | null }
export interface Rights { license: string; creator?: string; source?: string }

export interface Expression extends ExpressionRef {
  kind: 'amoji.expression';
  amoji: typeof PROTOCOL;
  realizes: string;
  intensity: Intensity;
  directions?: Direction[];
  original_locale: string;
  name: Localized<string>;
  semantics: Localized<Semantics>;
  tags?: Localized<string[]>;
  visual: Visual;
  rights: Rights;
  created_at: string;
}

export type ConflictGroup = 'explanation' | 'response-organization' | 'completion-report' | 'handoff';
export interface EffectRef { effect_id: string; effect_revision_id: string }
interface EffectBase extends EffectRef { title: Localized<string>; summary: Localized<string> }
export interface ContextEffect extends EffectBase { kind: 'context'; conflict_group: ConflictGroup; instruction: Localized<string> }
export type TemplateEffect = EffectBase & { kind: 'template' } & (
  { template: 'response-organization@1'; config: { layout: 'answer-first' | 'concise' | 'example-first' } } |
  { template: 'completion-self-check@1'; config: { evidence: 'required'; unknowns: 'explicit' } }
);
export type Effect = ContextEffect | TemplateEffect;
export interface Binding { target: { act: string } | ExpressionRef; effects: string[] }

export interface Pack {
  kind: 'amoji.pack';
  amoji: typeof PROTOCOL;
  pack_id: string;
  release_id: string;
  version: number;
  original_locale: string;
  locales: string[];
  name: Localized<string>;
  description: Localized<string>;
  expressions: Expression[];
  effects?: Effect[];
  bindings?: Binding[];
  rights: Rights;
  derived_from?: { pack_id: string; release_id: string };
}

export type Mode = 'turn' | 'backchannel' | 'interrupt';
export type GlyphPolicy = 'keep' | 'prefer';
export interface Anchor { message_id: string; exact?: string; prefix?: string; suffix?: string; start?: number; end?: number }
export interface DecisionOption { id: string; label: string }
export type Sender = { role: 'human'; participant_id?: string } | { role: 'ai'; agent_id?: string };

export interface ProtocolMessage {
  kind: 'amoji.message';
  amoji: typeof PROTOCOL;
  registry_revision: string;
  message_id: string;
  from: Sender;
  act: string;
  intensity?: Intensity;
  note?: string;
  glyph?: ExpressionRef & { sha256: string };
  glyph_policy: GlyphPolicy;
  anchor?: Anchor;
  mode: Mode;
  sent_during?: string;
  replies?: string[];
  options?: DecisionOption[];
  responds_to?: string;
  rationale?: string;
  effects?: EffectRef[];
  created_at: string;
}

export interface Operation {
  kind: 'amoji.operation';
  amoji: typeof PROTOCOL;
  op: 'retract' | 'choose';
  target: string;
  option?: string;
  by: Sender;
  created_at: string;
}

export interface Preferences {
  kind: 'amoji.preferences';
  amoji: typeof PROTOCOL;
  preferred_packs: string[];
  quick_entries: string[];
  ai_expressions: { enabled: boolean; max_per_window: number; families: Record<Family, boolean> };
  reduce_motion: 'system' | 'on' | 'off';
}
