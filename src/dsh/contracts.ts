import type { Expression, ExpressionRef } from '../sample-catalog.js';
import type { SampleMessage } from '../sample-runtime.js';

/** Structural ports: only the public d347e703 methods actually consumed, not an SDK substitute. */
export interface DshEvent { type: string; seq: number; data: unknown }
export interface DshSession {
  id: string;
  snapshotEvents(): readonly DshEvent[];
  append(type: string, data: Record<string, unknown>): DshEvent;
}
export interface DshAgent { id: string; session: DshSession }
export interface DshExecution { agent?: DshAgent; callId: string; rootCallId?: string; signal: AbortSignal }
export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; details: object } };
export interface ToolOptions {
  name: string; description: string;
  parameters: Record<string, { type: 'string' | 'integer'; required?: true; description?: string }>;
  output: { schema: { type: 'json' }; render(args: unknown, value: unknown): { type: 'text'; text: string }[]; presentationMeta?(args: unknown, value: unknown): unknown };
  execute(args: unknown, exec: DshExecution): Promise<unknown>;
}
export interface HostPort {
  tools: { register(tool: unknown): unknown };
  sessions: { get(id: string): DshSession | undefined; flush(session: DshSession): Promise<boolean> };
  sessionProjections: { stateOf(session: DshSession, key: 'turnBoundary'): { openTurnStartSeq: number | null } | undefined };
  sessionController: {
    resolveAgent(id: string): Promise<{ agent: DshAgent } | { error: Error }>;
    inspect(id: string, signal?: AbortSignal): Promise<{ events: readonly DshEvent[] }>;
    prompt(request: { sessionId: string; requestId: string; mode: 'queue'; content: readonly { type: 'text'; text: string }[] }, signal: AbortSignal): Promise<{ accepted: true }>;
  };
  connection: { rpc: { intercept(channel: '/api', matcher: (endpoint: string) => boolean, handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>): () => Promise<void> } };
  effect(factory: () => (() => void | Promise<void>), label?: string): unknown;
}
export interface VisualMeta {
  kind: 'amoji'; messageId: string; ref: ExpressionRef; visualHash: string; posterHash: string | null; alt: string;
}
export interface HistoryEntry { message: SampleMessage; meta: VisualMeta; host: { status: 'prepared' | 'accepted' | 'observed'; requestId: string; hostMessageId?: string; seq?: number; turnStartSeq?: number } | null }
export interface VisualData { expression: Expression; primary: string; poster: string | null }
export interface DshRpc {
  catalog(sessionId: string, signal?: AbortSignal): Promise<Expression[]>;
  submit(sessionId: string, ref: ExpressionRef, requestId: string, signal?: AbortSignal): Promise<HistoryEntry>;
  history(sessionId: string, signal?: AbortSignal): Promise<HistoryEntry[]>;
  visual(sessionId: string, ref: ExpressionRef, messageId?: string, signal?: AbortSignal): Promise<VisualData>;
  display(sessionId: string, messageId: string, hash: string, state: 'rendered' | 'fallback' | 'failed', signal?: AbortSignal): Promise<void>;
}
