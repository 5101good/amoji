import type { ManagementRpc } from './management-rpc.js';
import type { HostConnectionFetch } from '@deepseek-ai/dsh-client-connection';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { Expression, ExpressionRef } from '../protocol/index.js';
import type { StoredMessage } from '../messages.js';

/** Structural ports: only the public dsh 0.1.5-rc.2 methods actually consumed, not an SDK substitute. */
export interface DshEvent { type: string; seq: number; data: unknown }
export interface DshSession {
  id: string;
  snapshotEvents(): readonly DshEvent[];
}
export interface DshAgent { id: string; session: DshSession }
export interface DshExecution { agent?: DshAgent; callId: string; rootCallId?: string; signal: AbortSignal }
export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; details: object } };
export interface ToolOptions {
  name: string; description: string;
  /** dsh-tools ParameterSchemaSpec: per-property value schemas, `required: true` per property. */
  parameters: Record<string, Record<string, unknown>>;
  output: { schema: { type: 'json' }; render(args: unknown, value: unknown): { type: 'text'; text: string }[]; presentationMeta?(args: unknown, value: unknown): JsonValue };
  execute(args: unknown, exec: DshExecution): Promise<JsonValue>;
}
export interface HostPort {
  llm?: import('./ai-suggestions.js').SuggestionLlm;
  tools: { register(tool: unknown): unknown };
  sessions: { get(id: string): DshSession | undefined; flush(session: DshSession): Promise<boolean> };
  sessionProjections: { stateOf(session: DshSession, key: 'turnBoundary'): { openTurnStartSeq: number | null } | undefined };
  sessionController: {
    modelCatalog?(): Promise<import('@deepseek-ai/dsh-api-session-controller').ModelCatalog>;
    resolveAgent(id: string): Promise<{ agent: DshAgent } | { error: Error }>;
    inspect(id: string, signal?: AbortSignal): Promise<{ events: readonly DshEvent[] }>;
    prompt(request: { sessionId: string; requestId: string; mode: 'queue' | 'steer'; content: readonly { type: 'text'; text: string }[] }, signal: AbortSignal): Promise<{ accepted: true }>;
    cancel?(request: { sessionId: string }, signal?: AbortSignal): Promise<{ accepted: true }>;
  };
  connection: { fetch: HostConnectionFetch };
  effect(factory: () => (() => void | Promise<void>), label?: string): unknown;
}
/** Replayable presentation of one message. Text-only messages have no ref or hashes. */
export type VisualMeta = {
  kind: 'amoji'; messageId: string; act: string; direction: 'h2a' | 'a2h'; policy: 'keep' | 'prefer';
  ref: { asset_id: string; revision_id: string } | null; visualHash: string | null; posterHash: string | null; alt: string;
}
export interface HistoryEntry { effect?: import('./collaboration-context.js').CollaborationReceipt; message: StoredMessage; meta: VisualMeta; host: { status: 'prepared' | 'unknown' | 'accepted' | 'observed'; requestId: string; hostMessageId?: string; seq?: number; turnStartSeq?: number } | null }
export interface VisualData { expression: Expression; primary: string; poster: string | null }
/** What a person submits from the dsh UI. The host decides the mode (RFC §8.3). */
export interface SubmitInput { ref?: ExpressionRef; act?: string; note?: string; respondsTo?: string; anchor?: { message_id: string; exact?: string; prefix?: string; suffix?: string }; effect?: import('../effects.js').EffectSelection }
export interface PackSummary { pack_id: string; release_id: string; version: number; name: Record<string, string>; original_locale: string; assets: string[] }
export interface DshRpc extends ManagementRpc {
  publisher?(sessionId:string,method:string,args:unknown):Promise<any>;
  marketplace?(sessionId:string,method:string,args:unknown):Promise<any>;
  rules?(sessionId:string):Promise<import('../conversation-rules.js').RuleView>;
  enableRule?(sessionId:string,selection:import('../effects.js').EffectSelection,generation:number,replace:import('../effects.js').EffectSelection|null):Promise<import('../conversation-rules.js').RuleView>;
  disableRule?(sessionId:string,selection:import('../effects.js').EffectSelection,generation:number):Promise<import('../conversation-rules.js').RuleView>;
  disableAllRules?(sessionId:string,generation:number):Promise<import('../conversation-rules.js').RuleView>;

  reconnect?(sessionId: string, signal?: AbortSignal): Promise<void>;
  manage(sessionId: string, signal?: AbortSignal): Promise<{ url: string }>;
  catalog(sessionId: string, signal?: AbortSignal): Promise<Expression[]>;
  packs?(sessionId: string, signal?: AbortSignal): Promise<PackSummary[]>;
  search(sessionId: string, query: string, limit?: number, signal?: AbortSignal): Promise<Expression[]>;
  submit(sessionId: string, input: SubmitInput, requestId: string, signal?: AbortSignal): Promise<HistoryEntry>;
  retract?(sessionId: string, messageId: string, signal?: AbortSignal): Promise<HistoryEntry[]>;
  choose?(sessionId: string, messageId: string, option: string, signal?: AbortSignal): Promise<HistoryEntry[]>;
  receipts?(sessionId:string,signal?:AbortSignal):Promise<HistoryEntry[]>;
  capabilities?(sessionId:string,signal?:AbortSignal):Promise<{supported:boolean;scopes:string[];reason:string|null}>;
  effects?(sessionId:string,ref:ExpressionRef,signal?:AbortSignal):Promise<import('../effects.js').EffectChoice[]>;
  history(sessionId: string, signal?: AbortSignal): Promise<HistoryEntry[]>;
  visual(sessionId: string, ref: ExpressionRef, messageId?: string, signal?: AbortSignal): Promise<VisualData>;
  display(sessionId: string, messageId: string, hash: string, state: 'rendered' | 'fallback' | 'failed', signal?: AbortSignal): Promise<void>;
}
