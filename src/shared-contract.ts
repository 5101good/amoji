import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fail } from './errors.js';
import { object, nonempty } from './arguments.js';

/** Amoji 0.1 protocol surface: act-based expression, notes, anchors, signals, decisions. */
export const PROTOCOL_CAPABILITY = 'amoji-0.1';
export const COLLABORATION_CAPABILITY = 'effects-v1';
export const API_VERSION = 3;
export const DATABASE_VERSION = 1;
export const VERSIONED_PACKS_CAPABILITY = 'pack-drafts-v1';
export const PACKS_CAPABILITY = 'packs-v1';
export const LIBRARY_MANAGEMENT_CAPABILITY = 'library-management-v1';
export const CREATE_DRAFT_CAPABILITY = 'create-drafts-v1';
export const TEXT_SUGGESTION_CAPABILITY = 'text-suggestions-v1';
export const DSH_RELIABILITY_CAPABILITY = 'dsh-reliable-delivery-v1';
export const DSH_NATIVE_CAPABILITY = 'dsh-native-delivery-v1';
export const DSH_SUBMISSION_CAPABILITY = 'dsh-idle-submission-v1';
export const SESSION_BINDINGS_CAPABILITY = 'session-bindings-v1';
export const CLAUDE_TICKET_CAPABILITY = 'claude-hook-tickets-v1';
export interface ApiRange { min: number; max: number }
export interface ServiceIdentity { serviceId: string; pid: number; dataRoot: string; apiVersion: number; databaseVersion: number; capabilities?: string[] }
export interface ServiceDescriptor extends ServiceIdentity { origin: string; secret: string }
export interface BindingContext { host: 'codex' | 'claude-code' | 'dsh'; hostInstanceId?: string; sessionId: string; turnId?: string; turnOrdinal?: number }
export interface ClaudeHookInvocation { sessionId: string; promptId: string; invocationId: string; toolName: string; argumentsDigest: string }
export interface ClaudeTicketRequest { ticket: string; toolName: string; argumentsDigest: string; invocationId?: string }
export interface ClaudeTicketContext { context: BindingContext; invocationId: string }

export { ServiceError, fail } from './errors.js';

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
export { object, nonempty } from './arguments.js';
export function bindingContext(value: unknown): BindingContext {
  const c = object(value, ['host', 'hostInstanceId', 'sessionId', 'turnId', 'turnOrdinal'], ['host', 'sessionId']);
  if (!['codex', 'claude-code', 'dsh'].includes(String(c.host))) fail('INVALID_ARGUMENT', '未知宿主');
  // Session-only bindings serve human input and history. AI search/express require a real turn.

  if (c.turnOrdinal !== undefined && (c.turnId === undefined || !Number.isSafeInteger(c.turnOrdinal) || (c.turnOrdinal as number) < 1)) fail('INVALID_ARGUMENT', '需要可信正整数回合序号');
  return { ...(c.turnOrdinal === undefined ? {} : { turnOrdinal: c.turnOrdinal as number }), host: c.host as BindingContext['host'], hostInstanceId: c.hostInstanceId === undefined ? 'local' : nonempty(c.hostInstanceId), sessionId: nonempty(c.sessionId), ...(c.turnId === undefined ? {} : { turnId: nonempty(c.turnId) }) };
}
