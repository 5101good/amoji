import { validateExpression, PROTOCOL, type Direction, type ExpressionRef, type Intensity, type Localized, type Rights, type Semantics, type Visual } from './protocol/index.js';
import { fail, object } from './shared-contract.js';

/** Author-editable fields of one expression; the service derives ids, visual and timestamps. */
export interface DraftFields {
  realizes: string;
  intensity: Intensity;
  directions?: Direction[];
  original_locale: string;
  name: Localized<string>;
  semantics: Localized<Semantics>;
  tags?: Localized<string[]>;
  rights: Rights;
  text_locale: string | null;
}
export interface Draft {
  draft_id: string;
  mode: 'create' | 'edit' | 'copy';
  source?: ExpressionRef;
  entry_version?: number;
  version: number;
  updated_at: string;
  fields: DraftFields;
  visual?: Omit<Visual, 'text_locale'>;
  confirmed?: ExpressionRef;
  last_save?: { base_version: number; request_hash: string };
}

export function emptyFields(locale = 'zh-CN'): DraftFields {
  return { realizes: '', intensity: 2, original_locale: locale, name: { [locale]: '' }, semantics: { [locale]: { meaning: '', fallback: '' } }, rights: { license: '仅供个人使用 / Personal use only' }, text_locale: null };
}

function boundedText(value: unknown): void {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 16384) fail('INVALID_ARGUMENT', '草稿字段需要文字，单字段最多 16 KiB');
}
function boundedList(value: unknown): void {
  if (!Array.isArray(value) || value.length > 64) fail('INVALID_ARGUMENT', '草稿列表需要有界文字数组');
  value.forEach(boundedText);
}
function localeMap(value: unknown, each: (item: unknown) => void): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 32) fail('INVALID_ARGUMENT', '需要按语言区分的字段');
  for (const [key, item] of Object.entries(value)) { if (key.length > 48) fail('INVALID_ARGUMENT', '无效语言标签'); each(item); }
}

/** Incomplete user input is durable; unknown fields and non-text values are never accepted. */
export function draftFields(value: unknown): DraftFields {
  const f = object(value, ['realizes', 'intensity', 'directions', 'original_locale', 'name', 'semantics', 'tags', 'rights', 'text_locale'], ['realizes', 'intensity', 'original_locale', 'name', 'semantics', 'rights', 'text_locale']);
  boundedText(f.realizes); boundedText(f.original_locale);
  if (f.intensity !== 1 && f.intensity !== 2 && f.intensity !== 3) fail('INVALID_ARGUMENT', '强度只能是 1、2 或 3');
  if (f.directions !== undefined && (!Array.isArray(f.directions) || f.directions.some(d => d !== 'h2a' && d !== 'a2h'))) fail('INVALID_ARGUMENT', '方向只能是 h2a 或 a2h');
  if (f.text_locale !== null) boundedText(f.text_locale);
  localeMap(f.name, boundedText);
  localeMap(f.semantics, item => {
    const s = object(item, ['meaning', 'fallback', 'use_when', 'avoid_when', 'translation'], ['meaning', 'fallback']);
    boundedText(s.meaning); boundedText(s.fallback);
    if (s.use_when !== undefined) boundedList(s.use_when);
    if (s.avoid_when !== undefined) boundedList(s.avoid_when);
    if (s.translation !== undefined) { const t = object(s.translation, ['from', 'method']); boundedText(t.from); boundedText(t.method); }
  });
  if (f.tags !== undefined) localeMap(f.tags, boundedList);
  const rights = object(f.rights, ['license', 'creator', 'source'], ['license']);
  Object.values(rights).forEach(boundedText);
  if (Buffer.byteLength(JSON.stringify(f)) > 65536) fail('INVALID_ARGUMENT', '草稿文字输入最多 64 KiB');
  return structuredClone(f) as unknown as DraftFields;
}

const PLACEHOLDER = { sha256: '0'.repeat(64), mime: 'image/png', bytes: 1, width: 1, height: 1 };
/** Full protocol validation of the text fields, using the same rules as confirmed expressions. */
export function validateDraftFields(fields: DraftFields): void {
  const { text_locale, ...rest } = fields;
  validateExpression({
    kind: 'amoji.expression', amoji: PROTOCOL, asset_id: '00000000-0000-4000-8000-000000000000', revision_id: '00000000-0000-4000-8000-000000000000',
    ...rest, visual: { primary: PLACEHOLDER, animated: false, text_locale }, created_at: '2026-01-01T00:00:00Z',
  });
}
export function draftVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail('INVALID_ARGUMENT', '需要有效草稿版本');
  return value as number;
}
