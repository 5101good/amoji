import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const API_VERSION = 2;
export const DATABASE_VERSION = 1;
export const DSH_SUBMISSION_CAPABILITY = 'dsh-idle-submission-v1';
export const CLAUDE_TICKET_CAPABILITY = 'claude-hook-tickets-v1';
export interface ApiRange { min: number; max: number }
export interface ServiceIdentity { serviceId: string; pid: number; dataRoot: string; apiVersion: number; databaseVersion: number; capabilities?: string[] }
export interface ServiceDescriptor extends ServiceIdentity { origin: string; secret: string }
export interface BindingContext { host: 'codex' | 'claude-code' | 'dsh'; hostInstanceId?: string; sessionId: string; turnId?: string }
export interface ClaudeHookInvocation { sessionId: string; promptId: string; invocationId: string; toolName: string; argumentsDigest: string }
export interface ClaudeTicketRequest { ticket: string; toolName: string; argumentsDigest: string; invocationId?: string }
export interface ClaudeTicketContext { context: BindingContext; invocationId: string }

export class ServiceError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}：${message}`); }
}
export function fail(code: string, message: string): never { throw new ServiceError(code, message); }

/** The historical macOS directory remains the default so old local image URLs survive. */
export function dataDirectory(platform = process.platform, home = homedir(), env = process.env): string {
  if (env.AMOJI_DATA_DIR) return resolve(env.AMOJI_DATA_DIR);
  if (platform === 'darwin') return resolve(home, 'Library/Application Support/Amoji/prototype');
  if (platform === 'win32') return resolve(env.LOCALAPPDATA || resolve(home, 'AppData/Local'), 'Amoji');
  return resolve(env.XDG_DATA_HOME || resolve(home, '.local/share'), 'amoji');
}
export function sessionKey(context: BindingContext): string {
  return JSON.stringify([context.host, context.hostInstanceId ?? 'local', context.sessionId]);
}
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
export function bindingContext(value: unknown): BindingContext {
  const c = object(value, ['host', 'hostInstanceId', 'sessionId', 'turnId'], ['host', 'sessionId']);
  if (!['codex', 'claude-code', 'dsh'].includes(String(c.host))) fail('INVALID_ARGUMENT', '未知宿主');
  if (c.turnId === undefined && c.host !== 'dsh') fail('INVALID_ARGUMENT', '此宿主必须提供真实回合');
  return { host: c.host as BindingContext['host'], hostInstanceId: c.hostInstanceId === undefined ? 'local' : nonempty(c.hostInstanceId), sessionId: nonempty(c.sessionId), ...(c.turnId === undefined ? {} : { turnId: nonempty(c.turnId) }) };
}
