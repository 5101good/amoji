import { Ajv2020 } from 'ajv/dist/2020.js';
import { fullFormats } from 'ajv-formats/dist/formats.js';
import schema from '../docs/specs/amoji-v0.1.schema.json' with { type: 'json' };
import type { Expression, ExpressionRef } from './sample-catalog.js';
import { fail, object } from './shared-contract.js';

export type DraftFields = Pick<Expression, 'name' | 'semantics' | 'rights' | 'tags'>;
export interface Draft {
  draft_id: string;
  /** Missing mode on legacy drafts means create. Only the service sets these fields. */
  mode?: 'create' | 'edit' | 'copy';
  source?: ExpressionRef;
  entry_version?: number;
  version: number;
  updated_at: string;
  fields: DraftFields;
  visual?: Expression['visual'];
  confirmed?: ExpressionRef;
  last_save?: { base_version: number; request_hash: string };
}
const ajv = new Ajv2020({ strict: false, formats: fullFormats });
const definition = ajv.compile({ $defs: schema.$defs, $ref: '#/$defs/revision' });
const fieldsSchema = ajv.compile({ $defs: schema.$defs, type: 'object', additionalProperties: false, required: ['name', 'semantics', 'rights'], properties: Object.fromEntries(['name', 'semantics', 'rights', 'tags'].map(key => [key, (schema.$defs.revision.properties as Record<string, unknown>)[key]])) });

/** Incomplete user input is durable; unknown fields and non-text values are never accepted. */
export function draftFields(value: unknown): DraftFields {
  const fields = object(value, ['name', 'semantics', 'rights', 'tags'], ['name', 'semantics', 'rights']);
  const semantics = object(fields.semantics, ['locale', 'meaning', 'fallback', 'tone', 'use_when', 'avoid_when'], ['locale', 'meaning', 'fallback']);
  const rights = object(fields.rights, ['license', 'creator', 'source'], ['license']);
  for (const item of [fields.name, ...Object.entries(semantics).filter(([key]) => !['use_when', 'avoid_when'].includes(key)).map(([, value]) => value), ...Object.values(rights)]) {
    if (typeof item !== 'string' || Buffer.byteLength(item) > 16384) fail('INVALID_ARGUMENT', '草稿字段需要文字，单字段最多 16 KiB');
  }
  for (const items of [fields.tags, semantics.use_when, semantics.avoid_when]) {
    if (items !== undefined && (!Array.isArray(items) || items.length > 64 || items.some(item => typeof item !== 'string' || Buffer.byteLength(item) > 16384))) fail('INVALID_ARGUMENT', '草稿列表需要有界文字数组');
  }
  if (Buffer.byteLength(JSON.stringify(fields)) > 65536) fail('INVALID_ARGUMENT', '草稿文字输入最多 64 KiB');
  return structuredClone(fields) as unknown as DraftFields;
}
function budget(value: DraftFields): void {
  if (Buffer.byteLength(JSON.stringify({ name: value.name, semantics: value.semantics })) > 4096) fail('SEMANTICS_BUDGET_EXCEEDED', '名称和固定语义超过 4 KiB，请缩短后重试');
}
export function validateDraftFields(value: DraftFields): void {
  if (!fieldsSchema(value)) fail('INVALID_SCHEMA', ajv.errorsText(fieldsSchema.errors));
  budget(value);
}
export function validateExpressionDefinition(value: Expression): void {
  if (value.schema_version !== '0.1') fail('UNSUPPORTED_SCHEMA', '不支持此资产协议版本');
  if (!definition(value)) fail('INVALID_SCHEMA', ajv.errorsText(definition.errors));
  budget(value);
}
export function draftVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail('INVALID_ARGUMENT', '需要有效草稿版本');
  return value as number;
}
