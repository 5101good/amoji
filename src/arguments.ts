import { fail } from './errors.js';

/** Strict argument shapes shared by services and browser-side clients. */
export function object(value: unknown, keys: string[], required = keys): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_ARGUMENT', '需要对象参数');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key)) || required.some(key => !(key in record))) fail('INVALID_ARGUMENT', '参数字段不合法；不接受语义覆盖或任意目标');
  return record;
}
export function nonempty(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024) fail('INVALID_ARGUMENT', '需要非空文字');
  return value;
}
